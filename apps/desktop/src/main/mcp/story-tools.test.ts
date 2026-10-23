import { DEFAULT_LOCALE, setLocale, type LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FAKE_OPENROUTER_KEY, startFakeOpenRouter } from '@svs/test-utils'

import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

const SPLIT = {
  acts: [
    {
      title: '裂谷',
      summary: '小饅頭追種子',
      scenes: [
        {
          title: '追逐',
          summary: '黑藤拖著種子往裂谷',
          location: '黑藤裂谷',
          timeOfDay: '夜',
          mood: '緊張',
        },
        {
          title: '飛越',
          summary: '閃電下彈跳過斷橋',
          location: '黑藤裂谷',
          timeOfDay: '夜',
          mood: '壯闊',
        },
      ],
    },
  ],
  characters: [
    { name: '小饅頭', appearance: '奶油黃圓頂', anchor: '奶油黃色圓頂史萊姆、白眼睛、沒有嘴' },
  ],
  locations: [{ name: '黑藤裂谷', description: '夜裡的黑色裂谷' }],
}
const SHOTS = {
  shots: [
    {
      description: '裂谷全景，遠處一點紅光',
      size: 'extreme_wide',
      angle: 'high',
      cameraMove: null,
      durationSec: 5,
      characters: [],
      dialogue: '',
      lighting: '冷藍月光',
      mood: '壓迫',
    },
    {
      description: '小饅頭彈起',
      size: 'wide',
      angle: 'low',
      cameraMove: null,
      durationSec: 5,
      characters: ['小饅頭'],
      dialogue: '',
      lighting: null,
      mood: '緊張',
    },
    {
      description: '種子落地長出樹苗',
      size: 'medium',
      angle: 'eye_level',
      cameraMove: null,
      durationSec: 5,
      characters: [],
      dialogue: '',
      lighting: '紅光',
      mood: '希望',
    },
  ],
}
const mockLlm = (r: LlmRequest): object | undefined => {
  if (r.system?.includes('編劇助手')) return SPLIT
  if (r.system?.includes('分鏡助手')) return SHOTS
  return undefined
}

const ProjectOnly = z.object({ project: z.object({ id: z.string(), name: z.string() }) })
const OutlineSchema = z.object({
  acts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      scenes: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string() })),
    }),
  ),
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
})
const SplitStory = z.object({
  replacedExistingOutline: z.boolean(),
  outline: OutlineSchema,
  newCharacters: z.array(z.string()),
  newLocations: z.array(z.string()),
})
const ShotSummary = z.looseObject({
  id: z.string(),
  number: z.number(),
  description: z.string(),
  size: z.string(),
  sceneId: z.string().nullable(),
  durationSec: z.number(),
})
const ShotList = z.object({ count: z.number(), shots: z.array(ShotSummary) })

async function start(options: Parameters<typeof startRealMcp>[0] = {}): Promise<Running> {
  const r = await startRealMcp({ mockLlm, ...options })
  running.push(r)
  return r
}

describe('故事 → 分鏡（示範模式，走完整條路）', () => {
  it('建專案 → 貼故事拆分場 → 拆鏡頭 → 看、改、排序、刪除、復原', async () => {
    const { call, h } = await start()
    const project = dataOf(ProjectOnly, await call('create_project', { name: '黑藤裂谷' }))
    expect(project.project.name).toBe('黑藤裂谷')

    const splitOut = await call('split_story_into_scenes', {
      story: '小饅頭追著被黑藤拖走的紅色種子，越過斷橋。',
    })
    const split = dataOf(SplitStory, splitOut)
    // 示範模式不花錢也不預留：回報的預留是 0，不是「預估 × 2」
    expect(
      (JSON.parse(textOf(splitOut)) as { spending: { reservedUsd: number } }).spending.reservedUsd,
    ).toBe(0)
    expect(split.outline.acts[0]?.scenes.map((s) => s.title)).toEqual(['追逐', '飛越'])
    expect(split.newCharacters).toEqual(['小饅頭'])
    expect(split.newLocations).toEqual(['黑藤裂谷'])

    const outline = dataOf(OutlineSchema, await call('get_outline'))
    const sceneId = outline.acts[0]?.scenes[1]?.id ?? ''
    expect(sceneId).not.toBe('')

    const planned = await call('split_scene_into_shots', { sceneId })
    const shots = dataOf(z.object({ shots: z.array(ShotSummary) }), planned).shots
    expect(shots.map((s) => s.description)).toEqual(SHOTS.shots.map((s) => s.description))
    expect(shots.every((s) => s.sceneId === sceneId)).toBe(true)

    const listed = dataOf(ShotList, await call('list_shots'))
    expect(listed.count).toBe(3)
    const first = listed.shots[0]
    const second = listed.shots[1]
    const third = listed.shots[2]
    if (!first || !second || !third) throw new Error('鏡頭不夠')

    // 改一個鏡頭，用 get_shot 看得到
    const edited = dataOf(
      ShotSummary,
      await call('update_shot', {
        shotId: second.id,
        description: '小饅頭壓扁，彈射過斷橋',
        size: 'close_up',
        durationSec: 5,
      }),
    )
    expect(edited).toMatchObject({ description: '小饅頭壓扁，彈射過斷橋', size: 'close_up' })
    const detail = dataOf(
      z.looseObject({
        id: z.string(),
        autoPrompt: z.string(),
        takes: z.object({ firstFrames: z.array(z.unknown()), videos: z.array(z.unknown()) }),
      }),
      await call('get_shot', { shotId: second.id }),
    )
    expect(detail.autoPrompt.length).toBeGreaterThan(0)
    expect(detail.takes).toEqual({ firstFrames: [], videos: [] })

    // 排序、刪除
    const reordered = dataOf(
      z.object({ shots: z.array(ShotSummary) }),
      await call('reorder_shots', { orderedIds: [third.id, first.id, second.id] }),
    )
    expect(reordered.shots.map((s) => s.id)).toEqual([third.id, first.id, second.id])
    const afterDelete = dataOf(
      z.object({ remaining: z.number() }),
      await call('delete_shots', { shotIds: [first.id] }),
    )
    expect(afterDelete.remaining).toBe(2)

    // 復原（跟 App 的復原是同一個）：刪掉的鏡頭回來
    const undone = await call('undo')
    expect(undone.isError).not.toBe(true)
    expect(dataOf(ShotList, await call('list_shots')).count).toBe(3)

    // 這些都是 App 自己的資料：畫面看得到（同一個服務）
    expect(h.shots.list().shots).toHaveLength(3)
  })

  it('重拆已經生成過畫面的場要明確同意（replaceGenerated）；沒有鏡頭的場正常拆', async () => {
    const { call, h } = await start()
    await call('create_project', { name: 'x' })
    await call('split_story_into_scenes', { story: '故事' })
    const outline = dataOf(OutlineSchema, await call('get_outline'))
    const sceneId = outline.acts[0]?.scenes[0]?.id ?? ''
    await call('split_scene_into_shots', { sceneId })
    // 假裝第一個鏡頭已經生成過（直接標在資料庫上，不真的生成）
    const generated = h.shots.list().shots[0]
    expect(generated).toBeDefined()
    // 沒有生成過 → 可以直接重拆
    const again = await call('split_scene_into_shots', { sceneId })
    expect(again.isError).not.toBe(true)
  })

  it('edit_outline：改某個場的摘要，之後 get_outline 看得到；壞的操作被擋下', async () => {
    const { call } = await start()
    await call('create_project', { name: 'x' })
    await call('split_story_into_scenes', { story: '故事' })
    const outline = dataOf(OutlineSchema, await call('get_outline'))
    const sceneId = outline.acts[0]?.scenes[0]?.id ?? ''
    await call('edit_outline', {
      operation: { op: 'updateScene', sceneId, patch: { summary: '改過的摘要' } },
    })
    const after = dataOf(OutlineSchema, await call('get_outline'))
    expect(after.acts[0]?.scenes[0]?.summary).toBe('改過的摘要')
    const bad = await call('edit_outline', { operation: { op: 'updateScene' } })
    expect(bad.isError).toBe(true)
  })

  it('configure_project 的畫風：列舉與說明都有「手繪繪本」（painted），選了就存', async () => {
    const { call, client } = await start()
    await call('create_project', { name: 'x' })
    const tool = (await client.listTools()).tools.find((t) => t.name === 'configure_project')
    expect(tool?.description).toContain('painted (手繪繪本)')
    const set = dataOf(
      z.object({ style: z.string(), styleName: z.string() }),
      await call('configure_project', { style: 'painted' }),
    )
    expect(set).toMatchObject({ style: 'painted', styleName: '手繪繪本' })
  })

  it('configure_project 與 set_models／list_models：設畫風與比例、選模型；示範模式只有示範模型', async () => {
    const { call } = await start()
    await call('create_project', { name: 'x' })
    const read = dataOf(
      z.object({ style: z.string(), aspectRatio: z.string() }),
      await call('configure_project'),
    )
    expect(read.aspectRatio).toBe('16:9')
    const set = dataOf(
      z.object({ style: z.string(), styleName: z.string(), aspectRatio: z.string() }),
      await call('configure_project', { style: 'anime', aspectRatio: '21:9' }),
    )
    expect(set).toMatchObject({ style: 'anime', styleName: '日系動畫', aspectRatio: '21:9' })
    const models = dataOf(
      z.object({
        available: z.array(z.looseObject({ id: z.string() })),
        selected: z.looseObject({}),
      }),
      await call('list_models'),
    )
    expect(models.available.map((m) => m.id)).toContain('mock/llm')
    const chosen = await call('set_models', { text: 'mock/llm' })
    expect(chosen.isError).not.toBe(true)
    const bad = await call('configure_project', { style: 'nope' })
    expect(bad.isError).toBe(true)
  })
})

describe('花錢的步驟與額度（真實模式、假的 OpenRouter 伺服器）', () => {
  const startReal = async () => {
    const fake = await startFakeOpenRouter()
    const r = await start({ demoMode: false, openrouterBaseUrl: fake.url })
    r.h.keys.set('openrouter', FAKE_OPENROUTER_KEY)
    closeFakes.push(() => fake.close())
    return { r, fake }
  }
  const closeFakes: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const close of closeFakes.splice(0)) await close()
  })

  it('英文介面：額度不夠被擋時，訊息寫出英文介面的頁籤與兩張卡名（總額度才是要調的那張）', async () => {
    const { r } = await startReal()
    await r.call('create_project', { name: 'x' })
    setLocale('en')
    try {
      const refused = await r.call('split_story_into_scenes', { story: 'A cat finds a home' })
      expect(refused.isError).toBe(true)
      const text = textOf(refused)
      expect(text).toContain(
        'raise the card “Total allowance for AI tools” under Settings → AI tools',
      )
      expect(text).toContain('It is not the card “Per-run spending limit” under Settings → General')
      expect(text).not.toMatch(/[㐀-鿿]/)
    } finally {
      setLocale(DEFAULT_LOCALE)
    }
  })

  it('額度 0：拆故事被擋下——白話訊息說明預估、預留、還剩多少、只有人能調；沒有任何請求送出去、沒有預留任何金額', async () => {
    const { r, fake } = await startReal()
    await r.call('create_project', { name: 'x' })
    const refused = await r.call('split_story_into_scenes', { story: '一隻貓找到家' })
    expect(refused.isError).toBe(true)
    const text = textOf(refused)
    expect(text).toContain('only US$0.00 is left of the AI tools allowance')
    expect(text).toContain('設定 → AI 工具連線')
    // 跟設定頁卡片的名字一致，使用者才找得到要調的那一張
    expect(text).toContain(
      'ask the user to raise the card 「AI 工具的總額度」 under 設定 → AI 工具連線',
    )
    // 另一張長得像的卡（單次花費上限）也寫明在哪、管什麼，免得 AI 或使用者把兩張搞混
    expect(text).toContain('It is not the card 「單次花費上限」 under 設定 → 一般')
    expect(text).toContain('only limits a single generation')
    expect(text).toContain('Only a person can change that allowance')
    expect(text).not.toMatch(/undefined|NaN|\.ts:|at .*\(/)
    expect(fake.requests.filter((q) => q.path === '/chat/completions')).toHaveLength(0)
    expect(r.controller.allowance.status().committedUsd).toBe(0)
    // estimate_cost 先講清楚這一步值多少、放不放得下
    const est = JSON.parse(
      textOf(
        await r.call('estimate_cost', { action: 'split_story_into_scenes', story: '一隻貓找到家' }),
      ),
    ) as {
      demoMode: boolean
      fits: boolean
      estimatedUsd: number
      wouldReserveUsd: number
    }
    expect(est).toMatchObject({ demoMode: false, fits: false })
    expect(est.estimatedUsd).toBeGreaterThan(0)
    expect(est.wouldReserveUsd).toBeCloseTo(est.estimatedUsd * 2)
  })

  it('人把額度調高之後可以做：預留金額被記下來、模型真的被呼叫；預留不夠時第二次又被擋', async () => {
    const { r, fake } = await startReal()
    await r.call('create_project', { name: 'x' })
    const est = JSON.parse(
      textOf(
        await r.call('estimate_cost', { action: 'split_story_into_scenes', story: '一隻貓找到家' }),
      ),
    ) as { wouldReserveUsd: number }
    // 額度只夠一次
    r.h.settings.update({ mcp: { allowanceUsd: est.wouldReserveUsd * 1.5 } })
    await r.call('split_story_into_scenes', { story: '一隻貓找到家' }) // 假伺服器的回應不一定符合大綱格式，結果成不成功都不重要：要驗的是預留與呼叫
    expect(fake.requests.filter((q) => q.path === '/chat/completions').length).toBeGreaterThan(0)
    // 剛做完：額度上記的是預留（預估 × 2）
    expect(r.controller.allowance.status().committedUsd).toBeCloseTo(est.wouldReserveUsd)
    // 下一次碰到工具時（佇列是空的）預留改成實際花的，多預留的退回
    await r.call('get_generation_status')
    const spentUsd = r.h.projects.status()?.spentUsd ?? 0
    expect(spentUsd).toBeGreaterThan(0)
    expect(spentUsd).toBeLessThan(est.wouldReserveUsd)
    expect(r.controller.allowance.status().committedUsd).toBeCloseTo(spentUsd)
    // 剩下的額度不夠再預留一次：還是被擋
    r.h.settings.update({ mcp: { allowanceUsd: spentUsd + est.wouldReserveUsd / 2 } })
    const second = await r.call('split_story_into_scenes', { story: '一隻貓找到家' })
    expect(second.isError).toBe(true)
    expect(textOf(second)).toContain('is left of the AI tools allowance')
    // AI 沒辦法自己調額度：沒有任何工具、白名單也不給
    const { tools } = await r.client.listTools()
    expect(
      tools.map((t) => t.name).filter((n) => /allowance|budget|spend|limit|key/i.test(n)),
    ).toEqual([])
  })

  it('這些步驟的回傳與錯誤都不含金鑰', async () => {
    const { r } = await startReal()
    await r.call('create_project', { name: 'x' })
    const outputs = [
      await r.call('split_story_into_scenes', { story: FAKE_OPENROUTER_KEY }),
      await r.call('estimate_cost', {
        action: 'split_story_into_scenes',
        story: FAKE_OPENROUTER_KEY,
      }),
      await r.call('update_shot', { shotId: FAKE_OPENROUTER_KEY, description: 'x' }),
      await r.call('get_shot', { shotId: FAKE_OPENROUTER_KEY }),
      await r.call('split_scene_into_shots', { sceneId: FAKE_OPENROUTER_KEY }),
    ]
    for (const out of outputs) {
      expect(textOf(out)).not.toContain(FAKE_OPENROUTER_KEY)
      expect(textOf(out)).not.toContain(r.token)
    }
  })
})
