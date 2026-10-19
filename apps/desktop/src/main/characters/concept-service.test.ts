import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
const setup = (options: Parameters<typeof createStudioHarness>[0] = {}): Harness => {
  const harness = createStudioHarness(options)
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

const imagePrompts = (h: Harness): string[] =>
  (h.projects.current()?.repos.jobs.list() ?? [])
    .filter((job) => job.kind === 'image')
    .map((job) => (job.input as { prompt: string }).prompt)

const finish = async (h: Harness, id: string, count: number): Promise<void> => {
  await vi.waitFor(
    () => {
      const state = h.concepts.state(id)
      expect(state.generating).toBeUndefined()
      expect(state.concepts).toHaveLength(count)
    },
    { timeout: 30_000, interval: 20 },
  )
}

describe('ConceptService（示範模式）', () => {
  it('一輪生成 4 張不同的概念圖，進度與結果用事件推送，花費入帳', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { appearance: '短黑髮、琥珀色眼睛', outfit: '深藍工作服' })

    expect(h.concepts.check(hero.id)).toMatchObject({ ok: true, count: 4, demoMode: true })
    h.concepts.generate(hero.id)
    expect(h.concepts.state(hero.id).generating).toEqual({ done: 0, total: 4 })
    await finish(h, hero.id, 4)

    const { concepts } = h.concepts.state(hero.id)
    expect(new Set(concepts.map((c) => c.assetHash)).size).toBe(4)
    expect(concepts.every((c) => c.round === 1)).toBe(true)

    // 推送過「進行中」與最後的完整快照
    const pushed = h.events
      .filter((e) => e.name === 'characters.conceptsChanged')
      .map((e) => e.payload as { generating?: { done: number }; concepts: unknown[] })
    expect(pushed.some((p) => p.generating !== undefined)).toBe(true)
    expect(pushed.at(-1)).toMatchObject({ concepts: expect.arrayContaining([]) as unknown[] })
    expect(pushed.at(-1)?.generating).toBeUndefined()
    expect(pushed.at(-1)?.concepts).toHaveLength(4)

    // Prompt 帶了名字、長相與服裝
    expect(imagePrompts(h).every((p) => p.includes('阿鐵') && p.includes('深藍工作服'))).toBe(true)
    const handle = h.projects.current()
    expect(handle?.repos.costs.list(handle.projectId).length).toBeGreaterThanOrEqual(4)
  })

  it('整組重跑：新的一輪排在前面，舊的保留', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.concepts.generate(hero.id)
    await finish(h, hero.id, 4)
    h.concepts.generate(hero.id)
    await finish(h, hero.id, 8)

    const { concepts } = h.concepts.state(hero.id)
    expect(concepts.map((c) => c.round)).toEqual([2, 2, 2, 2, 1, 1, 1, 1])
    // 兩輪的圖都不一樣（換了變化編號，沒有沿用快取）
    expect(new Set(concepts.map((c) => c.assetHash)).size).toBe(8)
  })

  it('有固定外觀描述就用它（原封不動），不再重複列長相', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { appearance: '這句不該出現' })
    h.characters.setAnchor(hero.id, '短黑髮、左臉小疤')
    h.concepts.generate(hero.id)
    await finish(h, hero.id, 4)
    const prompts = imagePrompts(h)
    expect(prompts.every((p) => p.includes('短黑髮、左臉小疤'))).toBe(true)
    expect(prompts.some((p) => p.includes('這句不該出現'))).toBe(false)
  })

  it('正在生成時不能重複開始；可以取消', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.concepts.generate(hero.id)
    expect(() => {
      h.concepts.generate(hero.id)
    }).toThrow('正在生成中')
    h.concepts.cancel(hero.id)
    await vi.waitFor(() => {
      expect(h.concepts.state(hero.id).generating).toBeUndefined()
    })
    // 取消不算錯誤
    expect(h.concepts.state(hero.id).error).toBeUndefined()
  })

  it('挑主圖：角色卡顯示主圖，重新挑會換掉', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.concepts.generate(hero.id)
    await finish(h, hero.id, 4)
    const [a, b] = h.concepts.state(hero.id).concepts
    if (!a || !b) throw new Error('沒有概念圖')

    expect(h.characters.pickHero(hero.id, a.id).heroAssetHash).toBe(a.assetHash)
    expect(h.characters.list()[0]?.heroAssetHash).toBe(a.assetHash)
    expect(h.characters.pickHero(hero.id, b.id).heroAssetHash).toBe(b.assetHash)
  })

  it('超過單次花費上限 → 不能生成，說明原因', () => {
    const h = setup({ demoMode: false, perRunLimitUsd: 0.0001 })
    expect(h.concepts.check('x').ok).toBe(false)
    expect(() => {
      h.concepts.generate('x')
    }).toThrow()
  })

  it('沒有專案或找不到角色：檢查回報原因', () => {
    const h = setup()
    expect(h.concepts.check('x')).toMatchObject({ ok: false, issue: '找不到這個角色。' })
    expect(h.concepts.state('x')).toEqual({ characterId: 'x', concepts: [] })
  })
})
