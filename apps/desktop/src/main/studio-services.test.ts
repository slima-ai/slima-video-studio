import { createProject } from '@svs/db'
import type { JobQueue } from '@svs/engine'
import { detectContentBox, probe, resolveTools, runTool } from '@svs/media'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioServices } from './studio-services'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const tools = resolveTools()

/** 1376×768 的藍灰底圖（加一塊白色方塊），boxes 是再畫上去的黑邊。 */
async function makeAsset(boxes: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'svs-trim-'))
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
  const services = createStudioServices({ queue: {} as unknown as JobQueue, handle, tools })
  return { handle, ref, services }
}

const bar = (y: number): string => `drawbox=x=0:y=${String(y)}:w=1376:h=97:color=black:t=fill`
const ctx = { signal: new AbortController().signal }

describe('studio.trimLetterbox（首幀帶電影黑邊就裁掉）', () => {
  it('上下各 97 像素黑邊：存成新的素材、尺寸不變、新的圖沒有黑邊；原圖還在素材庫', async () => {
    const { handle, ref, services } = await makeAsset([bar(0), bar(671)])
    const trimmed = await services.trimLetterbox?.(ref, '16:9', ctx)
    expect(trimmed).toBeDefined()
    if (!trimmed) return
    expect(trimmed.hash).not.toBe(ref.hash)
    expect(trimmed).toMatchObject({ kind: 'image', mime: 'image/png', width: 1376, height: 768 })
    const stored = handle.assets.find(trimmed.hash)
    expect(stored).toBeDefined()
    if (!stored) return
    expect(await probe(tools, stored.path)).toMatchObject({ width: 1376, height: 768 })
    const content = (await detectContentBox(tools, stored.path)).content
    expect(content.y).toBeLessThanOrEqual(1)
    expect(content.height).toBeGreaterThanOrEqual(766)
    expect(handle.assets.find(ref.hash)).toBeDefined()
  })

  it('沒有黑邊、只有上面黑一大塊（夜景的黑天空）：原樣回傳同一個素材，不產生新檔', async () => {
    for (const boxes of [[], [bar(0)]]) {
      const { ref, services } = await makeAsset(boxes)
      expect(await services.trimLetterbox?.(ref, '16:9', ctx)).toEqual(ref)
    }
  })

  it('找不到素材（已被刪除）：原樣回傳，不丟錯', async () => {
    const { ref, services } = await makeAsset([])
    const missing = { ...ref, hash: 'f'.repeat(64) }
    expect(await services.trimLetterbox?.(missing, '16:9', ctx)).toEqual(missing)
  })
})
