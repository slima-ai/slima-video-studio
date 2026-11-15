import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

async function planned() {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.trailer.plan({ text: STORY })
  return h
}

const view = (h: Awaited<ReturnType<typeof planned>>, id: string) =>
  h.shots.list().shots.find((s) => s.id === id)

describe('格子最短（D3）：改單一格的秒數', () => {
  it('預告片的會動格改成比 1.5 秒短：自動改成不動的畫面（秒數照改）；1.5 秒整不改', async () => {
    const h = await planned()
    const moving = h.shots.list().shots.find((s) => (s.beatKind ?? 'video') === 'video')
    if (!moving) throw new Error('示範腳本應該有會動的格子')
    expect(h.shots.update(moving.id, { durationSec: 1.5 }).beatKind ?? 'video').toBe('video')
    const out = h.shots.update(moving.id, { durationSec: 1.2 })
    expect(out.beatKind).toBe('still')
    expect(out.durationSec).toBeCloseTo(1.2, 6)
    expect(view(h, moving.id)?.beatKind).toBe('still')
    await h.shots.whenIdle()
  })

  it('不動的格、字卡短於 1.5 秒不受影響；改成 1.5 秒以上的會動格不受影響', async () => {
    const h = await planned()
    const still = h.shots.list().shots.find((s) => s.beatKind === 'still')
    if (!still) throw new Error('示範腳本應該有不動的格子')
    expect(h.shots.update(still.id, { durationSec: 1 }).beatKind).toBe('still')
    const moving = h.shots.list().shots.find((s) => (s.beatKind ?? 'video') === 'video')
    if (!moving) throw new Error('需要會動的格子')
    expect(h.shots.update(moving.id, { durationSec: 4 }).beatKind ?? 'video').toBe('video')
    await h.shots.whenIdle()
  })

  it('只改種類（沒動秒數）：使用者自己選的照辦，不自動改回去', async () => {
    const h = await planned()
    const still = h.shots.list().shots.find((s) => s.beatKind === 'still')
    if (!still) throw new Error('需要不動的格子')
    h.shots.update(still.id, { durationSec: 1 })
    expect(h.shots.update(still.id, { beatKind: 'video' }).beatKind ?? 'video').toBe('video')
    await h.shots.whenIdle()
  })

  it('一般專案（沒有預告片）的鏡頭：秒數怎麼改種類都不動', () => {
    const h = createStudioHarness()
    harnesses.push(h)
    const shot = h.shots.create({})
    const out = h.shots.update(shot.id, { durationSec: 1 })
    expect(out.beatKind ?? 'video').toBe('video')
    expect(out.durationSec).toBe(1)
  })
})
