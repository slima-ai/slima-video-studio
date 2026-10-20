import { createProject } from '@svs/db'
import type { JobDriver } from '@svs/engine'
import { detectContentBox, probe, resolveTools, runTool } from '@svs/media'
import { GenerationOutputSchema, type Job } from '@svs/schema'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { withLetterboxTrim } from './letterbox-driver'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const tools = resolveTools()
const ctx = () => ({ signal: new AbortController().signal })

/** 1376×768 的藍灰底圖（加一塊白色方塊），boxes 是再畫上去的黑邊。 */
async function setup(boxes: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'svs-lb-driver-'))
  dirs.push(root)
  const handle = createProject(
    { dir: join(root, '貓.svsproj'), name: '貓' },
    { appVersion: 'test' },
  )
  const file = join(root, 'frame.png')
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    [
      'color=c=0x5a7aa0:s=1376x768:r=1:d=1',
      'drawbox=x=300:y=200:w=400:h=300:color=white:t=fill',
      ...boxes,
    ].join(','),
    '-frames:v',
    '1',
    file,
  ])
  const stored = await handle.assets.put(new Uint8Array(readFileSync(file)), 'image/png', {
    width: 1376,
    height: 768,
  })
  const ref = {
    hash: stored.hash,
    kind: 'image' as const,
    mime: 'image/png',
    bytes: stored.bytes,
    width: 1376,
    height: 768,
  }
  return { handle, ref }
}

const bar = (y: number): string => `drawbox=x=0:y=${String(y)}:w=1376:h=97:color=black:t=fill`

const job = (input: object): Job => ({
  id: 'j1',
  provider: 'mock',
  modelId: 'mock/image',
  kind: 'image',
  status: 'running',
  attempt: 0,
  maxAttempts: 1,
  createdAt: '2026-10-12T07:36:49.000Z',
  updatedAt: '2026-10-12T07:36:49.000Z',
  input,
})

const request = (extra: object = {}) => ({
  capability: 't2i',
  modelId: 'mock/image',
  prompt: '一隻貓',
  aspectRatio: '16:9',
  referenceAssets: [],
  count: 1,
  ...extra,
})

/** 同步完成的假供應商：回傳指定的素材。 */
const fakeDriver = (output: unknown): Required<JobDriver> => ({
  submit: () => Promise.resolve({ status: 'done', output, costUsd: 0.14 }),
  poll: () => Promise.resolve({ status: 'done', output, costUsd: 0.14 }),
  cancel: () => Promise.resolve(),
})

const outputOf = (result: { status: string; output?: unknown }) => {
  const parsed = GenerationOutputSchema.parse(result.output)
  if (parsed.kind !== 'assets') throw new Error('不是素材')
  return parsed.assets
}

describe('withLetterboxTrim（任務完成時輸出的就是裁好的圖）', () => {
  it('首幀圖（trimLetterbox）帶上下 97 像素黑邊：輸出換成裁好的新素材、標 letterboxTrimmed、尺寸不變、沒有黑邊；原圖還在；花費照舊', async () => {
    const { handle, ref } = await setup([bar(0), bar(671)])
    const driver = withLetterboxTrim(fakeDriver({ kind: 'assets', assets: [ref] }), {
      handle,
      tools,
    })
    const result = await driver.submit(job(request({ trimLetterbox: true })), ctx())
    expect(result).toMatchObject({ status: 'done', costUsd: 0.14 })
    const [asset] = outputOf(result)
    expect(asset?.hash).not.toBe(ref.hash)
    expect(asset).toMatchObject({ kind: 'image', width: 1376, height: 768, letterboxTrimmed: true })
    const stored = handle.assets.find(asset?.hash ?? '')
    expect(stored).toBeDefined()
    if (!stored) return
    expect(await probe(tools, stored.path)).toMatchObject({ width: 1376, height: 768 })
    const content = (await detectContentBox(tools, stored.path)).content
    expect(content.y).toBeLessThanOrEqual(1)
    expect(content.height).toBeGreaterThanOrEqual(766)
    expect(handle.assets.find(ref.hash)).toBeDefined()
  })

  it('長任務（submit 先回 submitted、poll 才完成）也一樣在 poll 完成時裁', async () => {
    const { handle, ref } = await setup([bar(0), bar(671)])
    const output = { kind: 'assets', assets: [ref] }
    const base = fakeDriver(output)
    const slow: Required<JobDriver> = {
      ...base,
      submit: () => Promise.resolve({ status: 'submitted', providerJobId: 'p1' }),
    }
    const driver = withLetterboxTrim(slow, { handle, tools })
    const submitted = await driver.submit(job(request({ trimLetterbox: true })), ctx())
    expect(submitted).toEqual({ status: 'submitted', providerJobId: 'p1' })
    const polled = await driver.poll(job(request({ trimLetterbox: true })), ctx())
    expect(outputOf(polled)[0]).toMatchObject({ letterboxTrimmed: true })
  })

  it('沒有帶 trimLetterbox（角色概念圖、三視圖、編輯器素材…）、不是圖片請求、圖沒有黑邊：原樣回傳，不動素材庫', async () => {
    const withBars = await setup([bar(0), bar(671)])
    const out = { kind: 'assets', assets: [withBars.ref] }
    const driver = withLetterboxTrim(fakeDriver(out), { handle: withBars.handle, tools })
    expect((await driver.submit(job(request()), ctx())).status).toBe('done')
    expect(outputOf(await driver.submit(job(request()), ctx()))[0]?.hash).toBe(withBars.ref.hash)
    const video = job({ ...request({ trimLetterbox: true }), capability: 'i2v' })
    expect(outputOf(await driver.submit(video, ctx()))[0]?.hash).toBe(withBars.ref.hash)

    const clean = await setup([])
    const cleanDriver = withLetterboxTrim(fakeDriver({ kind: 'assets', assets: [clean.ref] }), {
      handle: clean.handle,
      tools,
    })
    const result = await cleanDriver.submit(job(request({ trimLetterbox: true })), ctx())
    expect(outputOf(result)[0]).toEqual(clean.ref)
    // 只有上面黑一大塊（夜景的黑天空）也不動
    const sky = await setup([bar(0)])
    const skyDriver = withLetterboxTrim(fakeDriver({ kind: 'assets', assets: [sky.ref] }), {
      handle: sky.handle,
      tools,
    })
    expect(
      outputOf(await skyDriver.submit(job(request({ trimLetterbox: true })), ctx()))[0],
    ).toEqual(sky.ref)
  })

  it('裁圖失敗（找不到 FFmpeg）用原圖，不讓花掉的生成作廢；取消照樣丟出；沒有媒體工具就不包', async () => {
    const { handle, ref } = await setup([bar(0), bar(671)])
    const out = { kind: 'assets', assets: [ref] }
    const broken = withLetterboxTrim(fakeDriver(out), {
      handle,
      tools: { ffmpegPath: '/不存在/ffmpeg', ffprobePath: null },
    })
    const result = await broken.submit(job(request({ trimLetterbox: true })), ctx())
    expect(outputOf(result)[0]).toEqual(ref)

    const controller = new AbortController()
    controller.abort()
    const real = withLetterboxTrim(fakeDriver(out), { handle, tools })
    await expect(
      real.submit(job(request({ trimLetterbox: true })), { signal: controller.signal }),
    ).rejects.toThrow()

    const plain = fakeDriver(out)
    expect(withLetterboxTrim(plain, { handle, tools: undefined })).toBe(plain)
  })
})
