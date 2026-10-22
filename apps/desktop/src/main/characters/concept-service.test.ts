import type { CharacterReferencePurpose } from '@svs/schema'
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

const imageJobs = (
  h: Harness,
): { capability?: string; prompt: string; referenceAssets?: string[] }[] =>
  (h.projects.current()?.repos.jobs.list() ?? [])
    .filter((job) => job.kind === 'image')
    .map((job) => job.input as { capability?: string; prompt: string; referenceAssets?: string[] })

describe('ConceptService：照參考圖畫（示範模式）', () => {
  /** 先生成一輪，拿其中幾張圖當「專案裡已有的圖」。 */
  async function withProjectImages(h: Harness): Promise<{ id: string; hashes: string[] }> {
    const hero = h.characters.create('小饅頭')
    h.characters.update(hero.id, { appearance: '奶油黃圓頂史萊姆' })
    h.concepts.generate(hero.id)
    await finish(h, hero.id, 4)
    return { id: hero.id, hashes: h.concepts.state(hero.id).concepts.map((c) => c.assetHash) }
  }
  const add = (
    h: Harness,
    characterId: string,
    assetHash: string,
    purpose: CharacterReferencePurpose = 'general',
  ) => h.concepts.addReference({ characterId, assetHash, purpose })

  it('沒有參考圖：走原本的文字生圖，請求不帶參考圖，檢查也回報 0 張', async () => {
    const h = setup()
    const { id } = await withProjectImages(h)
    expect(h.concepts.check(id).references).toBe(0)
    expect(h.concepts.references(id).references).toEqual([])
    const jobs = imageJobs(h)
    expect(jobs).toHaveLength(4)
    expect(
      jobs.every((j) => j.capability !== 'edit' && (j.referenceAssets ?? []).length === 0),
    ).toBe(true)
    expect(jobs.every((j) => !j.prompt.includes('參考圖'))).toBe(true)
  })

  it('加了參考圖：下一輪 4 張請求都用編輯模型、一定帶著那張參考圖，Prompt 照參考圖畫', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [hash] = hashes
    if (!hash) throw new Error('沒有圖')
    const state = add(h, id, hash, 'face')
    expect(state.references).toMatchObject([{ assetHash: hash, purpose: 'face', source: 'added' }])
    expect(h.concepts.check(id)).toMatchObject({ ok: true, references: 1 })

    h.concepts.generate(id)
    await finish(h, id, 8)
    const second = imageJobs(h).slice(4)
    expect(second).toHaveLength(4)
    for (const job of second) {
      expect(job.capability).toBe('edit')
      expect(job.referenceAssets).toEqual([hash])
      expect(job.prompt).toContain('參考圖是「小饅頭」本來的樣子')
      expect(job.prompt).toContain('奶油黃圓頂史萊姆')
      expect(job.prompt).toContain('參考圖依序是：第 1 張是臉。')
    }
  })

  it('好幾張有用途的參考圖：臉、身體、三視圖排在前面，Prompt 照順序說明每一張是什麼', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [a, b, c] = hashes
    if (!a || !b || !c) throw new Error('圖不夠')
    // 先加的是「一般」，後加的是臉與身體：送出時臉、身體排在前面
    add(h, id, a, 'general')
    add(h, id, c, 'body')
    add(h, id, b, 'face')
    h.concepts.generate(id)
    await finish(h, id, 8)
    for (const job of imageJobs(h).slice(4)) {
      expect(job.referenceAssets).toEqual([b, c, a])
      expect(job.prompt).toContain('參考圖依序是：第 1 張是臉，第 2 張是身體，第 3 張是一般。')
    }
  })

  it('同一張圖同一個用途加兩次只有一筆（可以更新備註）；同一張圖不同用途各一筆但只送一次', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [hash] = hashes
    if (!hash) throw new Error('沒有圖')
    add(h, id, hash, 'face')
    const again = h.concepts.addReference({
      characterId: id,
      assetHash: hash,
      purpose: 'face',
      label: '原版設定圖',
    })
    expect(again.references).toHaveLength(1)
    expect(again.references[0]?.label).toBe('原版設定圖')
    expect(add(h, id, hash, 'body').references.map((r) => r.purpose)).toEqual(['face', 'body'])
    h.concepts.generate(id)
    await finish(h, id, 8)
    expect(
      imageJobs(h)
        .slice(4)
        .every((j) => j.referenceAssets?.length === 1),
    ).toBe(true)
  })

  it('以前在畫布上接到「參考圖」的圖（upload 概念圖）也算參考圖，只能在畫布上拿掉', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [hash] = hashes
    const handle = h.projects.current()
    if (!hash || !handle) throw new Error('沒有圖')
    handle.repos.characters.addConcept({
      characterId: id,
      round: 9,
      slot: 0,
      assetHash: hash,
      modelId: 'upload',
    })
    const refs = h.concepts.references(id).references
    expect(refs).toMatchObject([{ assetHash: hash, purpose: 'general', source: 'canvas' }])
    expect(() => h.concepts.removeReference(id, refs[0]?.id ?? '')).toThrow('在畫布上剪掉')
    expect(h.concepts.check(id).references).toBe(1)
  })

  it('移除參考圖：清單少一筆、圖留在專案裡；沒有的 id 說明原因', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [hash] = hashes
    if (!hash) throw new Error('沒有圖')
    const [added] = add(h, id, hash, 'face').references
    expect(h.concepts.removeReference(id, added?.id ?? '').references).toEqual([])
    expect(h.projects.current()?.assets.getMeta(hash)).toBeDefined()
    expect(() => h.concepts.removeReference(id, 'nope')).toThrow('找不到這張參考圖')
    // 沒有參考圖了：回到文字生圖
    h.concepts.generate(id)
    await finish(h, id, 8)
    expect(
      imageJobs(h)
        .slice(4)
        .every((j) => j.capability !== 'edit'),
    ).toBe(true)
  })

  it('專案裡沒有的圖、找不到的角色：說明原因，不會加', async () => {
    const h = setup()
    const { id } = await withProjectImages(h)
    expect(() => add(h, id, 'a'.repeat(64))).toThrow('專案裡找不到這張圖片')
    expect(() => add(h, 'nope', 'a'.repeat(64))).toThrow('找不到這個角色')
    expect(h.concepts.references(id).references).toEqual([])
  })

  it('設定裡改了範本：下一輪就用改過的（有參考圖與沒有參考圖各用各的範本）', async () => {
    const h = setup()
    const { id, hashes } = await withProjectImages(h)
    const [hash] = hashes
    if (!hash) throw new Error('沒有圖')
    h.settings.update({
      characterPrompts: {
        concept: '我的範本：{{名稱}}／{{畫風}}',
        conceptRef: '我的參考範本：{{角色}}｜{{參考圖說明}}',
      },
    })
    h.concepts.generate(id)
    await finish(h, id, 8)
    expect(
      imageJobs(h)
        .slice(4)
        .every((j) => j.prompt.startsWith('我的範本：小饅頭／')),
    ).toBe(true)

    add(h, id, hash, 'face')
    h.concepts.generate(id)
    await finish(h, id, 12)
    const refJobs = imageJobs(h).slice(8)
    expect(refJobs.every((j) => j.capability === 'edit')).toBe(true)
    expect(
      refJobs.every(
        (j) => j.prompt === '我的參考範本：小饅頭：奶油黃圓頂史萊姆｜參考圖依序是：第 1 張是臉。',
      ),
    ).toBe(true)
  })
})
