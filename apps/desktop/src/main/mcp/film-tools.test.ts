import { CAMERA_MOVES, type LlmRequest } from '@svs/schema'
import { FAKE_OPENROUTER_KEY, makePng, startFakeOpenRouter } from '@svs/test-utils'
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
  cameraMove: z.string().nullable(),
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
    // 假的字卡畫家：記下被叫了幾次（真的畫字卡要 Electron 視窗，單元測試沒有）
    let cardsRendered = 0
    const r = await start({
      renderCreditsCard: ({ width, height }) => {
        cardsRendered += 1
        return Promise.resolve(makePng({ width, height, color: [20, 20, 20] }))
      },
    })
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
    // 片尾字卡：不帶參數＝加；credits:true＝加；credits:false＝不加（而且根本不去畫字卡）。
    // 用假字卡畫家，回報的 creditsAdded 才真的反映 credits 有沒有傳到匯出那一層。
    // 每次匯出都要重新編碼整支影片（CI 上一次要好幾秒），所以第一次匯出（不帶參數）一併檢查檔名與路徑。
    interface Exported {
      fileName: string
      creditsAdded: boolean
    }
    const firstText = textOf(await r.call('export_film'))
    const byDefault = JSON.parse(firstText) as Exported
    expect(byDefault.fileName).toMatch(/\.mp4$/)
    expect(byDefault.fileName).not.toContain('/')
    expect(firstText).not.toContain(r.h.root)
    expect(byDefault.creditsAdded).toBe(true)
    expect(cardsRendered).toBe(1)
    const withCard = JSON.parse(textOf(await r.call('export_film', { credits: true }))) as Exported
    expect(withCard.creditsAdded).toBe(true)
    expect(cardsRendered).toBe(2)
    const noCard = JSON.parse(textOf(await r.call('export_film', { credits: false }))) as Exported
    expect(noCard.creditsAdded).toBe(false)
    expect(cardsRendered).toBe(2)
    expect(noCard.fileName).toMatch(/\.mp4$/)
  })

  it('運鏡：說明列出所有預設 id、也說自由文字會原樣進影片的 Prompt；自由文字真的被接受並存起來', async () => {
    const r = await start()
    const { tools } = await r.client.listTools()
    const description = tools.find((t) => t.name === 'update_shot')?.description ?? ''
    for (const move of CAMERA_MOVES) expect(description).toContain(move.id)
    expect(description).toContain('exactly as written')
    const [shotId] = await withShots(r)
    await r.call('update_shot', { shotId: shotId ?? '', cameraMove: 'slow push in' })
    expect((await detail(r, shotId ?? '')).cameraMove).toBe('slow push in')
    await r.call('update_shot', { shotId: shotId ?? '', cameraMove: 'push_in' })
    expect((await detail(r, shotId ?? '')).cameraMove).toBe('push_in')
  })

  it('動作欄：說明講清楚畫面描述與動作是分開的；寫進去、list_shots 與 get_shot 看得到、清得掉；autoPrompt 以動作開頭', async () => {
    const r = await start()
    const { tools } = await r.client.listTools()
    const update = tools.find((t) => t.name === 'update_shot')?.description ?? ''
    expect(update).toContain('action (what happens during')
    expect(update).toContain('description (ONLY the still picture')
    expect(update).toContain('no camera move')
    const list = tools.find((t) => t.name === 'list_shots')?.description ?? ''
    expect(list).toContain('action (what happens during the seconds')
    const [shotId] = await withShots(r)
    expect((await detail(r, shotId ?? '')).action).toBe('')

    await r.call('update_shot', { shotId: shotId ?? '', action: '貓向右跳一步' })
    const after = await detail(r, shotId ?? '')
    expect(after.action).toBe('貓向右跳一步')
    expect(String(after.autoPrompt).startsWith('貓向右跳一步')).toBe(true)
    const listed = JSON.parse(textOf(await r.call('list_shots', {}))) as {
      shots: { id: string; action: string }[]
    }
    expect(listed.shots.find((s) => s.id === shotId)?.action).toBe('貓向右跳一步')

    await r.call('update_shot', { shotId: shotId ?? '', action: '' })
    expect((await detail(r, shotId ?? '')).action).toBe('')
  })

  it('尾幀：說明講清楚何時會送；指定、讀得到、拿掉；不是圖片或找不到的圖會說明原因', async () => {
    const r = await start()
    const { tools } = await r.client.listTools()
    const setDescription = tools.find((t) => t.name === 'set_shot_end_frame')?.description ?? ''
    expect(setDescription).toContain('LAST frame')
    expect(setDescription).toContain('usedByCurrentVideoModel')
    expect(setDescription).toContain('costs money')
    const clearDescription = tools.find((t) => t.name === 'clear_shot_end_frame')?.description ?? ''
    expect(clearDescription).toContain('set_shot_end_frame')

    const [shotId, otherId] = await withShots(r)
    await r.call('generate_first_frames')
    await waitDone(r)
    const images = dataOf(
      z.looseObject({ images: z.array(z.looseObject({ assetHash: z.string() })) }),
      await r.call('list_project_images'),
    ).images
    const hash = images[0]?.assetHash ?? ''
    expect(hash).not.toBe('')
    expect((await detail(r, shotId ?? '')).endFrame).toBeNull()

    const set = await r.call('set_shot_end_frame', { shotId: shotId ?? '', assetHash: hash })
    expect(set.isError).not.toBe(true)
    const after = await detail(r, shotId ?? '')
    expect(after.endFrame).toMatchObject({ assetHash: hash, usedByCurrentVideoModel: false })
    const listed = dataOf(ShotList, await r.call('list_shots'))
    expect(listed.shots.find((s) => s.id === shotId)?.hasEndFrame).toBe(true)
    expect(listed.shots.find((s) => s.id === otherId)?.hasEndFrame).toBe(false)
    // 尾幀不算首幀版本
    expect(after.firstFrame.versions).toBe(1)

    const missing = await r.call('set_shot_end_frame', {
      shotId: shotId ?? '',
      assetHash: 'f'.repeat(64),
    })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('專案裡找不到這張圖')

    await r.call('clear_shot_end_frame', { shotId: shotId ?? '' })
    expect((await detail(r, shotId ?? '')).endFrame).toBeNull()
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
      // 拒絕的訊息要說出估價（工具說明承諾的）
      expect(textOf(out), tool).toMatch(/預估要花 US\$\d/)
    }
    expect(noJobs(fake)).toHaveLength(requestsBefore)
    expect(r.controller.allowance.status().committedUsd).toBe(committedBefore)
  })

  it('尾幀（用首幀改圖）：沒寫尾幀描述會被擋；估價列出參考圖；額度 0 被擋下（說出估價、不送請求）；有額度就生成，存成尾幀，view_first_frames frame=end 看得到', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    const shotId = ids[0] ?? ''
    await r.call('generate_first_frames', { shotIds: [shotId] })
    await waitDone(r)

    const none = await r.call('view_first_frames', { frame: 'end' })
    expect(imageBlocks(none)).toHaveLength(0)
    expect(textOf(none)).toContain('No end frames yet')

    const noDescription = await r.call('generate_end_frame', { shotId })
    expect(noDescription.isError).toBe(true)
    expect(textOf(noDescription)).toContain('尾幀描述')

    await r.call('update_shot', { shotId, endDescription: 'the cat now sits on the far side' })
    const estimate = dataOf(
      z.looseObject({
        possible: z.boolean(),
        estimatedUsd: z.number(),
        fits: z.boolean(),
        references: z.array(z.string()),
      }),
      await r.call('estimate_cost', { action: 'generate_end_frame', shotId }),
    )
    expect(estimate).toMatchObject({ possible: true, fits: true, references: ['first frame'] })
    expect(estimate.estimatedUsd).toBeGreaterThan(0)

    r.h.settings.update({ mcp: { allowanceUsd: 0 } })
    const requestsBefore = noJobs(fake).length
    const committedBefore = r.controller.allowance.status().committedUsd
    const refused = await r.call('generate_end_frame', { shotId })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('額度只剩 US$0.00')
    expect(textOf(refused)).toMatch(/預估要花 US\$\d/)
    expect(noJobs(fake)).toHaveLength(requestsBefore)
    expect(r.controller.allowance.status().committedUsd).toBe(committedBefore)

    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const started = dataOf(
      z.looseObject({
        started: z.boolean(),
        spending: z.looseObject({ estimatedUsd: z.number() }),
      }),
      await r.call('generate_end_frame', { shotId }),
    )
    expect(started.started).toBe(true)
    await waitDone(r)
    const detail1 = await detail(r, shotId)
    expect(detail1.hasEndFrame).toBe(true)
    expect(detail1.endFrame).toHaveProperty('usedByCurrentVideoModel')
    const seen = await r.call('view_first_frames', { frame: 'end' })
    expect(imageBlocks(seen)).toHaveLength(1)
  })

  it('generate_videos 只做影片：首幀過期也不發圖片請求（錢只花在影片），回應說明首幀是舊描述畫的', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const ids = await withShots(r)
    const shotId = ids[0] ?? ''
    await r.call('generate_first_frames', { shotIds: [shotId] })
    await waitDone(r)
    await r.call('update_shot', { shotId, description: '改過的畫面描述，首幀就過期了' })
    // 這個假的服務裡，文字與圖片都走 /chat/completions，影片走 /videos
    const pictureRequests = () => noJobs(fake).filter((q) => q.path === '/chat/completions').length
    const before = pictureRequests()

    const out = dataOf(
      z.looseObject({
        started: z.number(),
        staleFirstFrames: z.looseObject({ shots: z.array(z.number()), note: z.string() }),
      }),
      await r.call('generate_videos', { shotIds: [shotId] }),
    )
    await waitDone(r)
    expect(out.started).toBe(1)
    expect(out.staleFirstFrames.shots).toHaveLength(1)
    expect(out.staleFirstFrames.note).toContain('OLDER description')
    // 沒有新的圖片請求；只有影片請求
    expect(pictureRequests()).toBe(before)
    expect(noJobs(fake).some((q) => q.path === '/videos')).toBe(true)
    const detail1 = await detail(r, shotId)
    expect(detail1.firstFrame.versions).toBe(1)
    expect(detail1.video.versions).toBe(1)
  })

  const Estimate = z.looseObject({
    possible: z.boolean(),
    issue: z.string().optional(),
    demoMode: z.boolean(),
    estimatedUsd: z.number(),
    wouldReserveUsd: z.number(),
    fits: z.boolean(),
    shotCount: z.number(),
    allowance: z.looseObject({ remainingUsd: z.number() }),
  })

  it('estimate_cost 估首幀圖：跟開始做的時候回報的預估一樣；什麼都不預留、不送請求；額度不夠 fits=false', async () => {
    const { r, fake } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 5 } }) // 先要有額度才拆得出鏡頭（文字步驟也算錢）
    await withShots(r)
    // 再加兩個鏡頭，才分得出「全部」跟「只問其中幾個」
    await r.call('create_shot')
    await r.call('create_shot')
    const ids = dataOf(ShotList, await r.call('list_shots')).shots.map((s) => s.id)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const requestsBefore = noJobs(fake).length
    const committedBefore = r.controller.allowance.status().committedUsd
    r.h.settings.update({ mcp: { allowanceUsd: 0 } })
    const poor = dataOf(
      Estimate,
      await r.call('estimate_cost', { action: 'generate_first_frames' }),
    )
    expect(poor).toMatchObject({
      possible: true,
      demoMode: false,
      shotCount: ids.length,
      fits: false,
    })
    expect(poor.estimatedUsd).toBeGreaterThan(0)
    expect(poor.wouldReserveUsd).toBeCloseTo(poor.estimatedUsd * 1.25)
    // 只問不做：沒有預留、沒有任何請求送出
    expect(r.controller.allowance.status().committedUsd).toBe(committedBefore)
    expect(noJobs(fake)).toHaveLength(requestsBefore)

    r.h.settings.update({ mcp: { allowanceUsd: 5 } })
    const rich = dataOf(
      Estimate,
      await r.call('estimate_cost', { action: 'generate_first_frames' }),
    )
    expect(rich.fits).toBe(true)
    expect(rich.estimatedUsd).toBeCloseTo(poor.estimatedUsd)
    // 只問兩個鏡頭就是兩個鏡頭的價錢
    const two = dataOf(
      Estimate,
      await r.call('estimate_cost', { action: 'generate_first_frames', shotIds: ids.slice(0, 2) }),
    )
    expect(two.shotCount).toBe(2)
    expect(two.estimatedUsd).toBeCloseTo((poor.estimatedUsd * 2) / ids.length)
    // 真的開始做：App 回報的預估就是剛才問到的
    const started = dataOf(
      z.looseObject({ spending: z.looseObject({ estimatedUsd: z.number() }) }),
      await r.call('generate_first_frames'),
    )
    expect(started.spending.estimatedUsd).toBeCloseTo(poor.estimatedUsd)
  })

  it('estimate_cost 估影片：還沒有首幀就說不能做；首幀好了之後，價錢等於 App 畫面「全部生成」的預估', async () => {
    const { r } = await startReal()
    r.h.settings.update({ mcp: { allowanceUsd: 20 } })
    const ids = await withShots(r)
    const early = dataOf(Estimate, await r.call('estimate_cost', { action: 'generate_videos' }))
    expect(early.possible).toBe(false)
    expect(early.issue).toContain('請先生成首幀圖')
    expect(early.fits).toBe(true) // 說不能做是 possible=false 的事，不是額度的事

    await r.call('generate_first_frames')
    await waitDone(r)
    const videos = dataOf(Estimate, await r.call('estimate_cost', { action: 'generate_videos' }))
    expect(videos).toMatchObject({ possible: true, shotCount: ids.length })
    expect(videos.estimatedUsd).toBeGreaterThan(0)
    expect(videos.wouldReserveUsd).toBeCloseTo(videos.estimatedUsd * 1.25)
    // 首幀都好了，「全部生成」剩下的就是影片：畫面上確認視窗寫的金額（約 US$…）跟 AI 問到的一樣
    const plan = r.h.canvas.runPlan({ keys: [], all: true })
    expect(plan.estimatedUsd).toBeCloseTo(videos.estimatedUsd)
    // 已經有影片的預設不重做；redo 才算新版本的價錢
    const redoFrames = dataOf(
      Estimate,
      await r.call('estimate_cost', { action: 'generate_first_frames', redo: true }),
    )
    expect(redoFrames).toMatchObject({ possible: true, shotCount: ids.length })
    const again = dataOf(
      Estimate,
      await r.call('estimate_cost', { action: 'generate_first_frames' }),
    )
    expect(again.possible).toBe(false)
    expect(again.issue).toContain('redo')
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
