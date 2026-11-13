import { TRAILER_TEMPLATES, TrailerKindSchema } from '@svs/schema'
import { FAKE_OPENROUTER_KEY, startFakeOpenRouter } from '@svs/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MCP_CHANNELS } from './bridge'
import { dataOf, startRealMcp, textOf } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
  for (const c of closers.splice(0)) await c()
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

const Beat = z.looseObject({
  id: z.string(),
  number: z.number(),
  beatKind: z.enum(['video', 'still', 'card', 'title']),
  durationSec: z.number(),
  card: z.object({ text: z.string(), subtext: z.string() }).nullable(),
})
const Trailer = z.looseObject({
  exists: z.boolean(),
  kind: z.string(),
  targetSec: z.number(),
  scriptSec: z.number(),
  differenceSec: z.number(),
  matches: z.boolean(),
  beatCount: z.number(),
  beats: z.array(Beat),
  errors: z.array(z.looseObject({ code: z.string() })),
  next: z.string().optional(),
})
const Planned = Trailer.extend({
  wroteAgain: z.boolean(),
  fixedByTheApp: z.array(z.string()),
  spending: z.looseObject({ estimatedUsd: z.number(), reservedUsd: z.number() }),
})
const Waited = z.looseObject({ finished: z.boolean() })
const Sound = z.looseObject({ totalSec: z.number() })

async function start(options: Parameters<typeof startRealMcp>[0] = {}): Promise<Running> {
  const r = await startRealMcp(options)
  running.push(r)
  return r
}

async function waitDone(r: Running): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 30 })).finished) return
  }
  throw new Error('生成一直沒結束')
}

const FPS = 24
const oneFrame = 1 / FPS

describe('預告片工具（示範模式，走完整條路）', () => {
  it('寫腳本 → 看 → 改一格秒數會回「差幾秒」→ 重排後又等於目標 → 生成、接片、get_sound 的 totalSec 等於目標', async () => {
    const r = await start()
    await r.call('create_project', { name: '預告片' })
    const planned = dataOf(
      Planned,
      await r.call('plan_trailer', { text: STORY, targetSec: 30, title: '黑藤之夜' }),
    )
    // 示範模式不花錢也不預留
    expect(planned.spending.reservedUsd).toBe(0)
    expect(planned.exists).toBe(true)
    expect(planned.targetSec).toBe(30)
    expect(planned.matches).toBe(true)
    expect(Math.abs(planned.scriptSec - 30)).toBeLessThanOrEqual(0.05)
    expect(planned.errors).toEqual([])
    // 加總等於目標：自己用各格秒數加一次
    const sum = planned.beats.reduce((acc, b) => acc + b.durationSec, 0)
    expect(Math.abs(sum - 30)).toBeLessThanOrEqual(0.05)
    expect(planned.beats[0]?.beatKind === 'card' || planned.beats[0]?.beatKind === 'title').toBe(
      false,
    )
    expect(planned.beats.at(-1)?.beatKind).toBe('title')

    // get_trailer 跟 plan_trailer 回的是同一份
    const looked = dataOf(Trailer, await r.call('get_trailer'))
    expect(looked.beats.map((b) => b.id)).toEqual(planned.beats.map((b) => b.id))
    expect(looked.next).toBeUndefined()

    // 改一格：多 2 秒 → 差 +2 秒、matches 變 false、說明怎麼辦
    const moving = looked.beats.find((b) => b.beatKind === 'video')
    if (!moving) throw new Error('沒有會動的格子')
    await r.call('update_shot', { shotId: moving.id, durationSec: moving.durationSec + 2 })
    const off = dataOf(Trailer, await r.call('get_trailer'))
    expect(off.matches).toBe(false)
    expect(off.differenceSec).toBeCloseTo(2, 3)
    expect(off.next).toContain('too long')
    expect(off.next).toContain('refit')

    // 重排：回到目標
    const fitted = dataOf(Trailer, await r.call('update_trailer', { targetSec: 30, refit: true }))
    expect(fitted.matches).toBe(true)
    expect(Math.abs(fitted.differenceSec)).toBeLessThanOrEqual(0.05)

    // 生成 → 接片 → 聲音總長（App 的做法：每格都有裁切，總長是整數格加總）
    await r.call('generate_first_frames')
    await waitDone(r)
    await r.call('generate_videos')
    await waitDone(r)
    const assembled = JSON.parse(textOf(await r.call('assemble_film'))) as { totalSeconds: number }
    const sound = dataOf(Sound, await r.call('get_sound'))
    expect(Math.abs(sound.totalSec - 30)).toBeLessThanOrEqual(oneFrame + 1e-6)
    expect(Math.abs(assembled.totalSeconds - 30)).toBeLessThanOrEqual(oneFrame + 1e-6)
  }, 120_000)

  it('add_card：字卡加在指定格後面（種類 card、停留時間照字數）、總長變長、復原就回來；不是預告片的格子被擋下', async () => {
    const r = await start()
    await r.call('create_project', { name: '預告片' })
    const before = dataOf(Planned, await r.call('plan_trailer', { text: STORY }))
    const after = before.beats[1]
    if (!after) throw new Error('格子不夠')

    const added = dataOf(
      Trailer,
      await r.call('add_card', { afterShotId: after.id, text: '她守著最後一盞燈', subtext: '' }),
    )
    expect(added.beatCount).toBe(before.beatCount + 1)
    const card = added.beats[2]
    expect(card?.beatKind).toBe('card')
    expect(card?.card).toEqual({ text: '她守著最後一盞燈', subtext: '' })
    // 8 個字：0.8 + 8 × 0.2
    expect(card?.durationSec).toBeCloseTo(2.4, 3)
    expect(added.matches).toBe(false)
    // 腳本加總每格先對齊整數格（2.4 秒 = 57.6 格，進位到 58 格），所以差在一格以內
    expect(Math.abs(added.differenceSec - 2.4)).toBeLessThanOrEqual(oneFrame)

    // 復原：回到加之前
    await r.call('undo')
    expect(dataOf(Trailer, await r.call('get_trailer')).beatCount).toBe(before.beatCount)

    // 不是預告片裡的格子：不屬於預告片那個場的鏡頭
    const outsider = await r.call('create_shot', {})
    const outsiderId = dataOf(z.looseObject({ id: z.string() }), outsider).id
    await r.call('update_shot', { shotId: outsiderId, sceneId: null })
    const refused = await r.call('add_card', { afterShotId: outsiderId, text: '字卡' })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('不在預告片腳本')
  })

  it('set_shot_motion：影片格 ⇄ 靜態格；字卡與片名卡沒有動作，被擋下並說明', async () => {
    const r = await start()
    await r.call('create_project', { name: '預告片' })
    const planned = dataOf(Planned, await r.call('plan_trailer', { text: STORY }))
    const video = planned.beats.find((b) => b.beatKind === 'video')
    const title = planned.beats.find((b) => b.beatKind === 'title')
    if (!video || !title) throw new Error('缺格子')

    const still = dataOf(
      z.looseObject({ beatKind: z.string() }),
      await r.call('set_shot_motion', { shotId: video.id, motion: 'still' }),
    )
    expect(still.beatKind).toBe('still')
    // list_shots 也看得到種類（影片格不寫這個欄位）
    const listed = dataOf(
      z.object({
        shots: z.array(z.looseObject({ id: z.string(), beatKind: z.string().optional() })),
      }),
      await r.call('list_shots'),
    )
    expect(listed.shots.find((s) => s.id === video.id)?.beatKind).toBe('still')
    expect(listed.shots.find((s) => s.id === title.id)?.beatKind).toBe('title')

    const back = dataOf(
      z.looseObject({ beatKind: z.string() }),
      await r.call('set_shot_motion', { shotId: video.id, motion: 'moving' }),
    )
    expect(back.beatKind).toBe('video')

    const refused = await r.call('set_shot_motion', { shotId: title.id, motion: 'still' })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('no motion')
  })

  it('一般專案（沒寫過腳本）：get_trailer 說沒有；update_trailer、add_card 被擋下並指向 plan_trailer', async () => {
    const r = await start()
    await r.call('create_project', { name: '一般' })
    expect(dataOf(Trailer, await r.call('get_trailer')).exists).toBe(false)
    for (const [name, args] of [
      ['update_trailer', { targetSec: 20 }],
      ['add_card', { afterShotId: 'x', text: '字卡' }],
    ] as const) {
      const out = await r.call(name, args)
      expect(out.isError, name).toBe(true)
      expect(textOf(out), name).toContain('plan_trailer')
    }
  })

  it('重寫腳本：已經生成過畫面的要明確同意（replaceGenerated）；同意之後整份換掉', async () => {
    const r = await start()
    await r.call('create_project', { name: '預告片' })
    const first = dataOf(Planned, await r.call('plan_trailer', { text: STORY }))
    const video = first.beats.find((b) => b.beatKind === 'video')
    await r.call('generate_first_frames', { shotIds: [video?.id ?? ''] })
    await waitDone(r)

    const refused = await r.call('plan_trailer', { text: STORY })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('replaceGenerated')
    // 沒被改：舊腳本還在
    expect(dataOf(Trailer, await r.call('get_trailer')).beats.map((b) => b.id)).toEqual(
      first.beats.map((b) => b.id),
    )

    const again = dataOf(
      Planned,
      await r.call('plan_trailer', { text: STORY, replaceGenerated: true }),
    )
    expect(again.beats.map((b) => b.id)).not.toContain(video?.id)
    expect(again.matches).toBe(true)
  })

  it('estimate_cost 認得 plan_trailer：示範模式 0 元放得下；超過 60,000 字被擋下', async () => {
    const r = await start()
    await r.call('create_project', { name: '預告片' })
    const est = dataOf(
      z.looseObject({ possible: z.boolean(), demoMode: z.boolean(), fits: z.boolean() }),
      await r.call('estimate_cost', { action: 'plan_trailer', story: STORY }),
    )
    expect(est).toMatchObject({ possible: true, demoMode: true, fits: true })
    const tooLong = await r.call('estimate_cost', {
      action: 'plan_trailer',
      story: '字'.repeat(60_001),
    })
    expect(tooLong.isError).toBe(true)
    expect(textOf(tooLong)).toContain('60000')
  })
})

describe('預告片工具：花錢與額度（真實模式、假的 OpenRouter 伺服器）', () => {
  const startReal = async () => {
    const fake = await startFakeOpenRouter()
    closers.push(() => fake.close())
    const r = await start({ demoMode: false, openrouterBaseUrl: fake.url })
    r.h.keys.set('openrouter', FAKE_OPENROUTER_KEY)
    return { r, fake }
  }

  it('額度 0：plan_trailer 被擋下、白話說明誰能調；沒有任何請求送出、沒有預留；人調高之後預留預估 × 2，下一次碰到工具時改成實際花的', async () => {
    const { r, fake } = await startReal()
    await r.call('create_project', { name: '預告片' })
    const refused = await r.call('plan_trailer', { text: STORY })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('is left of the AI tools allowance')
    expect(textOf(refused)).toContain('Only a person can change that allowance')
    expect(fake.requests.filter((q) => q.path === '/chat/completions')).toHaveLength(0)
    expect(r.controller.allowance.status().committedUsd).toBe(0)

    const est = dataOf(
      z.looseObject({ estimatedUsd: z.number(), wouldReserveUsd: z.number(), fits: z.boolean() }),
      await r.call('estimate_cost', { action: 'plan_trailer', story: STORY }),
    )
    expect(est.fits).toBe(false)
    expect(est.estimatedUsd).toBeGreaterThan(0)
    expect(est.wouldReserveUsd).toBeCloseTo(est.estimatedUsd * 2)

    r.h.settings.update({ mcp: { allowanceUsd: est.wouldReserveUsd * 1.5 } })
    // 假伺服器的回應不是腳本，所以寫不成：要驗的是預留與模型真的被呼叫
    await r.call('plan_trailer', { text: STORY })
    expect(fake.requests.filter((q) => q.path === '/chat/completions').length).toBeGreaterThan(0)
    expect(r.controller.allowance.status().committedUsd).toBeCloseTo(est.wouldReserveUsd)
    await r.call('get_generation_status')
    const spentUsd = r.h.projects.status()?.spentUsd ?? 0
    expect(spentUsd).toBeGreaterThan(0)
    expect(spentUsd).toBeLessThan(est.wouldReserveUsd)
    expect(r.controller.allowance.status().committedUsd).toBeCloseTo(spentUsd)
  })
})

describe('預告片類型從資料取（之後加新類型不用回頭改這些檔）', () => {
  it('指南與工具說明列出 TrailerKindSchema 的每一種類型與模板的每一段；工具輸入的 kind 選項就是同一份', async () => {
    const r = await start()
    const { text } = dataOf(
      z.object({ text: z.string() }),
      await r.call('load_guide', { topic: 'trailer' }),
    )
    for (const kind of TrailerKindSchema.options) {
      expect(text, kind).toContain(`- ${kind}: `)
      for (const segment of TRAILER_TEMPLATES[kind].segments) {
        expect(text, `${kind}/${segment.key}`).toContain(segment.key)
      }
    }
    const { tools } = await r.client.listTools()
    for (const name of ['plan_trailer', 'update_trailer']) {
      const kind = (
        tools.find((tool) => tool.name === name)?.inputSchema.properties as
          Record<string, { enum?: string[]; description?: string }> | undefined
      )?.kind
      expect(kind?.enum, name).toEqual([...TrailerKindSchema.options])
      for (const option of TrailerKindSchema.options)
        expect(kind?.description, name).toContain(option)
    }
  })
})

describe('預告片工具：白名單與指南', () => {
  it('白名單有預告片通道；選檔、讀任意檔案的通道仍然不在', () => {
    for (const channel of [
      'trailer.get',
      'trailer.check',
      'trailer.plan',
      'trailer.update',
      'trailer.status',
    ]) {
      expect(MCP_CHANNELS as readonly string[], channel).toContain(channel)
    }
    for (const channel of ['sound.importMusic', 'canvas.importFiles', 'canvas.importBytes']) {
      expect(MCP_CHANNELS as readonly string[], channel).not.toContain(channel)
    }
  })

  it('load_guide("trailer")：寫了順序、規則（跟 App 內建準則同一份）、量長度的三個地方；getting-started 指向它', async () => {
    const r = await start()
    const { text } = dataOf(
      z.object({ topic: z.string(), text: z.string() }),
      await r.call('load_guide', { topic: 'trailer' }),
    )
    for (const needle of [
      'plan_trailer',
      'get_trailer',
      'add_card',
      'set_shot_motion',
      'update_trailer',
      'get_sound',
      'totalSec',
      'within 0.05 seconds',
      'generate_music',
      'bottom of the title card',
      'never invent',
    ]) {
      expect(text.toLowerCase(), needle).toContain(needle.toLowerCase())
    }
    const started = dataOf(
      z.object({ text: z.string() }),
      await r.call('load_guide', { topic: 'getting-started' }),
    )
    expect(started.text).toContain('load_guide("trailer")')
    const caps = JSON.parse(textOf(await r.call('get_capabilities'))) as {
      guides: string[]
      tools: string[]
    }
    expect(caps.guides).toContain('trailer')
    for (const tool of [
      'plan_trailer',
      'get_trailer',
      'update_trailer',
      'add_card',
      'set_shot_motion',
    ]) {
      expect(caps.tools, tool).toContain(tool)
    }
  })
})
