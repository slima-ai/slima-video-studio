import type { LlmRequest } from '@svs/schema'
import { FAKE_OPENROUTER_KEY, startFakeOpenRouter } from '@svs/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
  for (const c of closers.splice(0)) await c()
})

const shot = (description: string, durationSec = 5) => ({
  description,
  size: 'wide',
  angle: 'eye_level',
  cameraMove: null,
  durationSec,
  characters: [],
  dialogue: '',
  lighting: null,
  mood: null,
})
const SPLIT = {
  acts: [
    { title: '一', summary: '', scenes: [{ title: '追逐', summary: '追種子', location: '' }] },
  ],
  characters: [],
  locations: [],
}
const SHOTS = { shots: [shot('裂谷全景'), shot('小饅頭彈起'), shot('種子長出樹苗')] }
const mockLlm = (r: LlmRequest): object | undefined => {
  if (r.system?.includes('編劇助手')) return SPLIT
  if (r.system?.includes('分鏡助手')) return SHOTS
  return undefined
}

const Take = z.looseObject({ id: z.string(), version: z.number(), adopted: z.boolean() })
const ShotDetail = z.looseObject({
  id: z.string(),
  number: z.number(),
  firstFrame: z.object({ versions: z.number(), adoptedVersion: z.number().nullable() }),
  video: z.object({ versions: z.number(), adoptedVersion: z.number().nullable() }),
  takes: z.object({ firstFrames: z.array(Take), videos: z.array(Take) }),
})
const ShotList = z.object({
  shots: z.array(z.looseObject({ id: z.string() })),
  hasFinalCut: z.boolean(),
})
const Batch = z.looseObject({
  started: z.number(),
  skippedAlreadyDone: z.number(),
  skippedNoFirstFrame: z.number(),
  demoMode: z.boolean(),
  spending: z.looseObject({ estimatedUsd: z.number() }),
})
const Waited = z.looseObject({ finished: z.boolean() })

const imageBlocks = (result: unknown): { data: string; mimeType: string }[] =>
  ((result as { content?: { type: string; data?: string; mimeType?: string }[] }).content ?? [])
    .filter((c) => c.type === 'image')
    .map((c) => ({ data: c.data ?? '', mimeType: c.mimeType ?? '' }))

async function start(options: Parameters<typeof startRealMcp>[0] = {}): Promise<Running> {
  const r = await startRealMcp({ mockLlm, ...options })
  running.push(r)
  return r
}

/** 建專案、貼故事、拆出 3 個鏡頭。 */
async function withShots(r: Running): Promise<string[]> {
  await r.call('create_project', { name: 'x' })
  await r.call('split_story_into_scenes', { story: '故事' })
  const outline = JSON.parse(textOf(await r.call('get_outline'))) as {
    acts: { scenes: { id: string }[] }[]
  }
  await r.call('split_scene_into_shots', { sceneId: outline.acts[0]?.scenes[0]?.id ?? '' })
  return dataOf(ShotList, await r.call('list_shots')).shots.map((s) => s.id)
}

async function waitDone(r: Running): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 30 })).finished) return
  }
  throw new Error('生成一直沒結束')
}

const detail = async (r: Running, shotId: string) =>
  dataOf(ShotDetail, await r.call('get_shot', { shotId }))

describe('影片線：首幀圖 → 看 → 影片 → 接片 → 匯出（示範模式）', () => {
  it('先只做首幀圖（沒有影片），看圖，再做影片，重做會多一個版本、可換回舊版，最後接片匯出', async () => {
    const r = await start()
    const ids = await withShots(r)
    expect(ids).toHaveLength(3)

    // 影片要有首幀才能做：白話說明先做首幀圖，沒有任何生成任務
    const early = await r.call('generate_videos')
    expect(early.isError).toBe(true)
    expect(textOf(early)).toContain('請先生成首幀圖')
    expect(
      dataOf(z.looseObject({ busy: z.boolean() }), await r.call('get_generation_status')),
    ).toMatchObject({
      busy: false,
    })

    const frames = dataOf(Batch, await r.call('generate_first_frames'))
    expect(frames).toMatchObject({ started: 3, demoMode: true })
    await waitDone(r)
    for (const id of ids) {
      const d = await detail(r, id)
      expect(d.firstFrame.versions).toBe(1)
      expect(d.video.versions).toBe(0) // 只做首幀圖，沒有偷偷做影片
    }

    // 看首幀圖：真的 JPEG
    const viewed = await r.call('view_first_frames')
    const images = imageBlocks(viewed)
    expect(images).toHaveLength(3)
    for (const image of images) {
      expect(image.mimeType).toBe('image/jpeg')
      expect(Buffer.from(image.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
    }
    const order = JSON.parse(textOf(viewed)) as { imagesInOrder: { shotId: string }[] }
    expect(order.imagesInOrder.map((o) => o.shotId)).toEqual(ids)

    // 已經有首幀：預設不重做，白話說明怎麼再做一版
    const again = await r.call('generate_first_frames')
    expect(again.isError).toBe(true)
    expect(textOf(again)).toContain('redo')

    const videos = dataOf(Batch, await r.call('generate_videos'))
    expect(videos).toMatchObject({ started: 3, skippedNoFirstFrame: 0 })
    await waitDone(r)
    for (const id of ids) {
      const d = await detail(r, id)
      expect(d.firstFrame.versions).toBe(1) // 做影片沒有動首幀圖
      expect(d.video.versions).toBe(1)
    }

    // 從影片抽幾格來看（示範影片也是真的 MP4）
    const stills = await r.call('view_video_stills', { shotId: ids[0], count: 3 })
    expect(stills.isError).not.toBe(true)
    const frames3 = imageBlocks(stills)
    expect(frames3).toHaveLength(3)
    expect(
      Buffer.from(frames3[0]?.data ?? '', 'base64')
        .subarray(0, 2)
        .toString('hex'),
    ).toBe('ffd8')

    // 只重做一個鏡頭的影片：多一個版本、新的被採用；換回舊版
    const target = ids[1] ?? ''
    const before = await detail(r, target)
    const redo = dataOf(Batch, await r.call('regenerate_shot', { shotId: target, what: 'video' }))
    expect(redo.started).toBe(1)
    await waitDone(r)
    const after = await detail(r, target)
    expect(after.video.versions).toBe(2)
    expect(after.video.adoptedVersion).toBe(2)
    expect(after.firstFrame.versions).toBe(before.firstFrame.versions)
    const old = after.takes.videos.find((t) => t.version === 1)
    const adopted = dataOf(
      z.looseObject({ video: z.object({ adoptedVersion: z.number().nullable() }) }),
      await r.call('adopt_version', { takeId: old?.id ?? '' }),
    )
    expect(adopted.video.adoptedVersion).toBe(1)

    // 接片 → 匯出：只回檔名，不回資料夾路徑
    const assembled = JSON.parse(textOf(await r.call('assemble_film'))) as {
      shotsInFilm: number[]
      totalSeconds: number
    }
    expect(assembled.shotsInFilm).toEqual([1, 2, 3])
    expect(assembled.totalSeconds).toBe(15)
    expect(
      imageBlocks(await r.call('view_video_stills', { finalCut: true, count: 2 })),
    ).toHaveLength(2)
    expect(dataOf(ShotList, await r.call('list_shots')).hasFinalCut).toBe(true)
    const exported = JSON.parse(textOf(await r.call('export_film'))) as { fileName: string }
    expect(exported.fileName).toMatch(/\.mp4$/)
    expect(exported.fileName).not.toContain('/')
    expect(textOf(await r.call('export_film'))).not.toContain(r.h.root)
    // 片尾字卡：預設加（回報有沒有加成功）；credits=false 就不加
    const withCard = JSON.parse(textOf(await r.call('export_film', { credits: true }))) as {
      fileName: string
      creditsAdded: boolean
    }
    expect(typeof withCard.creditsAdded).toBe('boolean')
    const noCard = JSON.parse(textOf(await r.call('export_film', { credits: false }))) as {
      fileName: string
      creditsAdded: boolean
    }
    expect(noCard).toMatchObject({ creditsAdded: false })
    expect(noCard.fileName).toMatch(/\.mp4$/)
  })

  it('沒有鏡頭、沒有影片、找不到鏡頭：白話錯誤，不是例外', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    for (const [tool, args] of [
      ['generate_first_frames', {}],
      ['generate_videos', {}],
      ['assemble_film', {}],
      ['view_video_stills', { shotId: 'nope' }],
      ['view_video_stills', { finalCut: true }],
      ['adopt_version', { takeId: 'nope' }],
    ] as const) {
      const out = await r.call(tool, args)
      expect(out.isError, tool).toBe(true)
      expect(textOf(out), tool).not.toMatch(/undefined|\.ts:|at .*\(/)
    }
    expect((await r.call('cancel_generation', { shotId: 'nope' })).isError ?? false).toBeTypeOf(
      'boolean',
    )
  })
})

describe('影片線的花錢步驟（真實模式、假的 OpenRouter）', () => {
  const startReal = async () => {
    const fake = await startFakeOpenRouter()
    closers.push(() => fake.close())
    const r = await start({ demoMode: false, openrouterBaseUrl: fake.url })
    r.h.keys.set('openrouter', FAKE_OPENROUTER_KEY)
    return { r, fake }
  }
  const noJobs = (fake: Awaited<ReturnType<typeof startFakeOpenRouter>>) =>
    fake.requests.filter((q) => q.path !== '/models')

  it('額度 0：首幀圖、影片、重做都被擋下；被擋下之後沒有任何請求送出、沒有預留', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    // 先（有額度時）做出一個鏡頭的首幀圖，這樣「影片」這一步才不是因為沒首幀被擋
    await r.call('generate_first_frames', { shotIds: [ids[0]] })
    await waitDone(r)
    r.h.settings.update({ mcp: { allowanceUsd: 0 } })
    const requestsBefore = noJobs(fake).length
    const committedBefore = r.controller.allowance.status().committedUsd
    for (const [tool, args] of [
      ['generate_first_frames', { shotIds: [ids[0]], redo: true }],
      ['generate_videos', { shotIds: [ids[0]] }],
      ['regenerate_shot', { shotId: ids[0], what: 'both' }],
    ] as const) {
      const out = await r.call(tool, args)
      expect(out.isError, tool).toBe(true)
      expect(textOf(out), tool).toContain('額度只剩 US$0.00')
    }
    expect(noJobs(fake)).toHaveLength(requestsBefore)
    expect(r.controller.allowance.status().committedUsd).toBe(committedBefore)
  })

  it('人調高額度後開始做首幀圖：預留的是預估 × 1.25；回傳不含金鑰與 token', async () => {
    const { r } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    const committedBefore = r.controller.allowance.status().committedUsd
    const out = await r.call('generate_first_frames', { shotIds: [ids[0]] })
    const parsed = dataOf(
      z.looseObject({
        spending: z.looseObject({ estimatedUsd: z.number(), reservedUsd: z.number() }),
      }),
      out,
    )
    expect(parsed.spending.reservedUsd).toBeCloseTo(parsed.spending.estimatedUsd * 1.25)
    expect(r.controller.allowance.status().committedUsd - committedBefore).toBeCloseTo(
      parsed.spending.reservedUsd,
    )
    for (const result of [out, await r.call('get_generation_status'), await r.call('list_shots')]) {
      expect(textOf(result)).not.toContain(FAKE_OPENROUTER_KEY)
      expect(textOf(result)).not.toContain(r.token)
    }
  })
})
