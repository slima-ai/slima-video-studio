import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。'

describe('shots.batchCheck：預告片專案還沒確認的角色與場景卡（MCP 的 estimate_cost 用同一份）', () => {
  async function trailer() {
    const h = createStudioHarness()
    harnesses.push(h)
    await h.trailer.plan({ text: STORY })
    const ids = h.shots.list().shots.map((s) => s.id)
    return { h, ids }
  }
  const check = (
    h: Awaited<ReturnType<typeof trailer>>['h'],
    ids: string[],
    stage: 'frame' | 'video' | 'full',
  ) => h.shots.batchCheck({ shotIds: ids, skipGenerated: true, stage })

  it('生首幀：2 個角色、2 個場景卡還沒鎖定；鎖定角色後剩場景；全鎖定後沒有', async () => {
    const { h, ids } = await trailer()
    expect(check(h, ids, 'frame').unconfirmed).toEqual({ characters: 2, locations: 2 })
    for (const c of h.characters.list()) h.characters.lock(c.id)
    expect(check(h, ids, 'frame').unconfirmed).toEqual({ characters: 0, locations: 2 })
    for (const card of h.projects.current()?.repos.locationCards.list() ?? [])
      h.locations.lock(card.id)
    expect(check(h, ids, 'frame').unconfirmed).toBeUndefined()
  })

  it('整條（full）一樣算；只生影片（video）不算，因為不生畫面', async () => {
    const { h, ids } = await trailer()
    expect(check(h, ids, 'full').unconfirmed).toEqual({ characters: 2, locations: 2 })
    expect(check(h, ids, 'video').unconfirmed).toBeUndefined()
  })

  it('只選字卡與片名卡：沒有要生的畫面，不算', async () => {
    const { h } = await trailer()
    const cards = h.shots
      .list()
      .shots.filter((s) => s.beatKind === 'card' || s.beatKind === 'title')
      .map((s) => s.id)
    expect(cards.length).toBeGreaterThan(0)
    expect(check(h, cards, 'full').unconfirmed).toBeUndefined()
  })

  it('只算選到的鏡頭用到的：選的鏡頭只有一個角色，就只數那一個', async () => {
    const { h, ids } = await trailer()
    const only = h.shots.list().shots.find((s) => s.characters.length === 1 && ids.includes(s.id))
    if (!only) throw new Error('示範腳本應該有只出現一個角色的鏡頭')
    expect(check(h, [only.id], 'frame').unconfirmed?.characters).toBe(1)
  })
})
