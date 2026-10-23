import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/**
 * 三種鏡頭各有：定稿的（第 2、3 鏡）、空的（新增的第 4 鏡）、標了需要重跑的（第 1 鏡，改了描述）。
 * 「全部生成」預設只補空的，標了需要重跑的、定稿的都不動。
 */
async function setup() {
  // 實際花費照「送出去的請求」算（圖 0.01、影片每秒 0.05），不抄預估的算式：跟預估對得上才算數
  const harness = createStudioHarness({
    mockCostUsd: (request) =>
      request.capability === 't2i' || request.capability === 'edit'
        ? 0.01
        : request.capability === 'i2v' ||
            request.capability === 't2v' ||
            request.capability === 'r2v'
          ? 0.05 * request.durationSec
          : 0,
  })
  harnesses.push(harness)
  await harness.runQuickStart()
  const [stale, done1, done2] = harness.shots.list().shots
  if (!stale || !done1 || !done2) throw new Error('鏡頭不夠')
  harness.shots.update(stale.id, { description: '貓抬頭看著月亮' })
  const empty = harness.shots.create({})
  expect(harness.shots.staleness().has(stale.id)).toBe(true)
  return { ...harness, stale, done: [done1, done2], empty }
}
type Harness = Awaited<ReturnType<typeof setup>>

const takesOf = (h: Harness, id: string) => {
  const shot = h.shots.list().shots.find((s) => s.id === id)
  return { frames: shot?.firstFrames.length ?? 0, videos: shot?.videos.length ?? 0 }
}
const recordCount = (h: Harness): number => h.records.list({}).total
const costSoFar = (h: Harness): number => h.records.list({}).totalCostUsd
const settle = (h: Harness) =>
  vi.waitFor(
    () => {
      expect(h.shots.list().shots.every((s) => s.activity === undefined)).toBe(true)
    },
    { timeout: 30_000, interval: 20 },
  )

describe('全部生成：只補空的（預設）／重跑需要重跑的／全部重新生成', () => {
  it('預設：只有空的那一鏡（首幀＋影片），標了需要重跑的與定稿的都不動；金額只算空的', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.ok).toBe(true)
    expect(plan.shotCount).toBe(1)
    expect(plan.staleKept).toBe(1)
    expect(plan.steps.filter((s) => s.kind !== 'cut').map((s) => [s.key, s.redo])).toEqual([
      [`shot:${h.empty.id}:image`, false],
      [`shot:${h.empty.id}:video`, false],
    ])
    expect(plan.estimatedUsd).toBeGreaterThan(0)
    // 金額只算空的那一鏡：「重新生成全部」那一種比它貴
    const all = h.canvas.runPlan({ keys: [], all: true, batch: 'regenerate' })
    expect(all.estimatedUsd).toBeGreaterThan(plan.estimatedUsd)
  })

  it('預設執行：只多空的那一鏡的 2 筆生成紀錄；實際花的就是預估的；其他鏡頭的版本都沒變', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: [], all: true })
    const before = { records: recordCount(h), cost: costSoFar(h) }
    const staleBefore = takesOf(h, h.stale.id)
    const doneBefore = h.done.map((s) => takesOf(h, s.id))
    await h.canvas.run({ keys: [], all: true })
    await settle(h)
    expect(takesOf(h, h.empty.id)).toEqual({ frames: 1, videos: 1 })
    expect(takesOf(h, h.stale.id)).toEqual(staleBefore)
    expect(h.done.map((s) => takesOf(h, s.id))).toEqual(doneBefore)
    // 標了需要重跑的還是需要重跑（沒有被順便更新）
    expect(h.shots.staleness().has(h.stale.id)).toBe(true)
    expect(recordCount(h) - before.records).toBe(2)
    expect(costSoFar(h) - before.cost).toBeCloseTo(plan.estimatedUsd, 6)
  })

  it('重跑需要重跑的：只動標了需要重跑的那一鏡（新版本、舊的留著），金額等於實際花的', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: [], all: true, batch: 'stale' })
    expect(plan.shotCount).toBe(1)
    expect(plan.steps.filter((s) => s.kind !== 'cut').map((s) => [s.key, s.redo])).toEqual([
      [`shot:${h.stale.id}:image`, true],
      [`shot:${h.stale.id}:video`, true],
    ])
    const before = { records: recordCount(h), cost: costSoFar(h) }
    const emptyBefore = takesOf(h, h.empty.id)
    const doneBefore = h.done.map((s) => takesOf(h, s.id))
    await h.canvas.run({ keys: [], all: true, batch: 'stale' })
    await settle(h)
    expect(takesOf(h, h.stale.id)).toEqual({ frames: 2, videos: 2 })
    expect(h.shots.staleness().has(h.stale.id)).toBe(false)
    expect(takesOf(h, h.empty.id)).toEqual(emptyBefore)
    expect(h.done.map((s) => takesOf(h, s.id))).toEqual(doneBefore)
    expect(recordCount(h) - before.records).toBe(2)
    expect(costSoFar(h) - before.cost).toBeCloseTo(plan.estimatedUsd, 6)
  })

  it('全部重新生成：每一鏡都動（有結果的產生新版本、舊的留著；空的補上），金額等於實際花的', async () => {
    const h = await setup()
    const plan = h.canvas.runPlan({ keys: [], all: true, batch: 'regenerate' })
    expect(plan.shotCount).toBe(4)
    const byKey = new Map(plan.steps.map((s) => [s.key, s.redo]))
    expect(byKey.get(`shot:${h.empty.id}:video`)).toBe(false)
    expect(byKey.get(`shot:${h.stale.id}:video`)).toBe(true)
    for (const shot of h.done) expect(byKey.get(`shot:${shot.id}:image`)).toBe(true)
    const before = { records: recordCount(h), cost: costSoFar(h) }
    await h.canvas.run({ keys: [], all: true, batch: 'regenerate' })
    await settle(h)
    expect(takesOf(h, h.empty.id)).toEqual({ frames: 1, videos: 1 })
    for (const shot of [h.stale, ...h.done]) {
      expect(takesOf(h, shot.id)).toEqual({ frames: 2, videos: 2 })
    }
    expect(recordCount(h) - before.records).toBe(8)
    expect(costSoFar(h) - before.cost).toBeCloseTo(plan.estimatedUsd, 6)
  })

  it('剪輯節點、場節點這種整批的入口也一樣：預設只補空的', async () => {
    const h = await setup()
    const cut = h.canvas.runPlan({ keys: ['cut'] })
    expect(cut.steps.filter((s) => s.kind !== 'cut').map((s) => s.key)).toEqual([
      `shot:${h.empty.id}:image`,
      `shot:${h.empty.id}:video`,
    ])
    expect(cut.staleKept).toBe(1)
    // 單獨一鏡的 ▶ 是明確指定：標了需要重跑的照舊補跑它
    const single = h.canvas.runPlan({ keys: [`shot:${h.stale.id}:video`] })
    expect(single.steps.filter((s) => s.kind !== 'cut').map((s) => s.key)).toEqual([
      `shot:${h.stale.id}:image`,
      `shot:${h.stale.id}:video`,
    ])
  })

  it('三種做法的鏡數、步數、金額跟各自的計畫一模一樣；都生成好了就是 0', async () => {
    const h = await setup()
    const choices = h.canvas.runChoices({})
    const planOf = (batch: 'empty' | 'stale' | 'regenerate') =>
      h.canvas.runPlan({ keys: [], all: true, batch })
    expect(choices.empty).toMatchObject({ ok: true, shots: 1, steps: 2 })
    expect(choices.stale).toMatchObject({ ok: true, shots: 1, steps: 2 })
    expect(choices.regenerate).toMatchObject({ ok: true, shots: 4, steps: 8 })
    for (const batch of ['empty', 'stale', 'regenerate'] as const) {
      expect(choices[batch].estimatedUsd).toBe(planOf(batch).estimatedUsd)
    }
    await h.canvas.run({ keys: [], all: true })
    await settle(h)
    const after = h.canvas.runChoices({})
    expect(after.empty).toMatchObject({ shots: 0, steps: 0, estimatedUsd: 0 })
    expect(after.stale.shots).toBe(1)
  })

  it('有首幀、首幀是舊描述畫的、沒有影片：生成空的只做影片（首幀照用、不重畫），確認視窗要說出來', async () => {
    const h = await setup()
    const [shot] = h.done
    if (!shot) throw new Error('沒有定稿的鏡頭')
    h.shots.update(shot.id, { description: '貓看著窗外的雨' })
    h.shots.clearAdopted(shot.id, 'video')
    const plan = h.canvas.runPlan({ keys: [], all: true })
    const mine = plan.steps.filter((s) => s.key.startsWith(`shot:${shot.id}:`)).map((s) => s.kind)
    // 這一鏡只補影片（不是首幀＋影片）
    expect(mine).toEqual(['video'])
    expect(plan.staleFrameUsed).toBe(1)
    expect(plan.staleKept).toBe(2)
    // 清掉採用中的影片：舊的那一版還留在版本裡（沒被採用）
    const before = takesOf(h, shot.id)
    await h.canvas.run({ keys: [], all: true })
    await settle(h)
    // 影片補上了，首幀沒有重畫（版本數不變）；首幀還是舊描述畫的、仍然標需要重跑
    expect(takesOf(h, shot.id)).toEqual({ frames: before.frames, videos: before.videos + 1 })
    expect(
      h.shots
        .list()
        .shots.find((v) => v.id === shot.id)
        ?.videos.some((v) => v.adopted),
    ).toBe(true)
    expect(h.shots.staleness().get(shot.id)?.image).toBe(true)
  })
})
