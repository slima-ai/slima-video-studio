import { probe, resolveTools } from '@svs/media'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
const setup = (): Harness => {
  const harness = createStudioHarness()
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

/** 建好角色並挑好主圖。 */
async function heroReady(h: Harness): Promise<{ id: string; heroHash: string }> {
  const hero = h.characters.create('阿鐵')
  h.characters.update(hero.id, { appearance: '短黑髮、琥珀色眼睛', outfit: '深藍工作服' })
  h.concepts.generate(hero.id)
  await vi.waitFor(
    () => {
      const state = h.concepts.state(hero.id)
      expect(state.generating).toBeUndefined()
      expect(state.concepts).toHaveLength(4)
    },
    { timeout: 30_000, interval: 20 },
  )
  const [first] = h.concepts.state(hero.id).concepts
  if (!first) throw new Error('沒有概念圖')
  h.characters.pickHero(hero.id, first.id)
  return { id: hero.id, heroHash: first.assetHash }
}

const finish = async (h: Harness, id: string, count: number): Promise<void> => {
  await vi.waitFor(
    () => {
      const state = h.turnarounds.state(id)
      expect(state.generating).toBeUndefined()
      expect(state.turnarounds).toHaveLength(count)
    },
    { timeout: 30_000, interval: 20 },
  )
}

describe('TurnaroundService（示範模式）', () => {
  it('還沒挑主圖：不能生成，說明要先挑主圖', () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    expect(h.turnarounds.check(hero.id)).toMatchObject({ ok: false })
    expect(h.turnarounds.check(hero.id).issue).toContain('先從概念圖挑一張主圖')
    expect(() => {
      h.turnarounds.generate(hero.id)
    }).toThrow('主圖')
  })

  it('一輪 4 組：每組有設定稿與切好的三張圖；請求帶著主圖當參考圖', async () => {
    const h = setup()
    const { id, heroHash } = await heroReady(h)
    expect(h.turnarounds.check(id)).toMatchObject({ ok: true, count: 4, demoMode: true })

    h.turnarounds.generate(id)
    expect(h.turnarounds.state(id).generating).toEqual({ done: 0, total: 4 })
    await finish(h, id, 4)

    const { turnarounds } = h.turnarounds.state(id)
    expect(new Set(turnarounds.map((t) => t.sheetHash)).size).toBe(4)
    const tools = resolveTools()
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    for (const t of turnarounds) {
      expect(t.cuts).toEqual({ a: 1 / 3, b: 2 / 3 })
      const sheet = handle.assets.find(t.sheetHash)
      const front = handle.assets.find(t.frontHash)
      if (!sheet || !front) throw new Error('素材不存在')
      const sheetInfo = await probe(tools, sheet.path)
      const frontInfo = await probe(tools, front.path)
      expect(frontInfo.height).toBe(sheetInfo.height)
      expect(Math.abs((frontInfo.width ?? 0) * 3 - (sheetInfo.width ?? 0))).toBeLessThanOrEqual(3)
    }

    // 送出的是「帶參考圖的編輯」請求，參考圖就是主圖；Prompt 要求三視圖
    const edits = handle.repos.jobs.list().filter((job) => {
      const input = job.input as { capability?: string }
      return input.capability === 'edit'
    })
    expect(edits).toHaveLength(4)
    for (const job of edits) {
      const input = job.input as { referenceAssets: string[]; prompt: string }
      expect(input.referenceAssets).toEqual([heroHash])
      expect(input.prompt).toContain('正面')
      expect(input.prompt).toContain('短黑髮、琥珀色眼睛')
    }
  })

  it('整組重跑：新的一輪在前，舊的保留；進度與結果用事件推送', async () => {
    const h = setup()
    const { id } = await heroReady(h)
    h.turnarounds.generate(id)
    await finish(h, id, 4)
    h.turnarounds.generate(id)
    await finish(h, id, 8)
    expect(h.turnarounds.state(id).turnarounds.map((t) => t.round)).toEqual([
      2, 2, 2, 2, 1, 1, 1, 1,
    ])

    const pushed = h.events
      .filter((e) => e.name === 'characters.turnaroundsChanged')
      .map((e) => e.payload as { generating?: unknown; turnarounds: unknown[] })
    expect(pushed.some((p) => p.generating !== undefined)).toBe(true)
    expect(pushed.at(-1)?.generating).toBeUndefined()
    expect(pushed.at(-1)?.turnarounds).toHaveLength(8)
  })

  it('採用一組 → 角色卡有三張圖；換採用另一組會換掉', async () => {
    const h = setup()
    const { id } = await heroReady(h)
    h.turnarounds.generate(id)
    await finish(h, id, 4)
    const [a, b] = h.turnarounds.state(id).turnarounds
    if (!a || !b) throw new Error('沒有候選')

    const view = h.characters.adoptTurnaround(id, a.id)
    expect(view.turnaround).toEqual({ front: a.frontHash, side: a.sideHash, back: a.backHash })
    expect(h.characters.adoptTurnaround(id, b.id).turnaround?.front).toBe(b.frontHash)
    expect(h.characters.list()[0]?.turnaround?.front).toBe(b.frontHash)
  })

  it('調整切線：用同一張設定稿重新切，三張圖的寬度跟著變', async () => {
    const h = setup()
    const { id } = await heroReady(h)
    h.turnarounds.generate(id)
    await finish(h, id, 4)
    const [t] = h.turnarounds.state(id).turnarounds
    if (!t) throw new Error('沒有候選')

    const updated = await h.turnarounds.reslice(id, t.id, { a: 0.25, b: 0.75 })
    expect(updated.sheetHash).toBe(t.sheetHash)
    expect(updated.cuts).toEqual({ a: 0.25, b: 0.75 })
    expect(updated.frontHash).not.toBe(t.frontHash)

    const handle = h.projects.current()
    const found = handle?.assets.find(updated.sideHash)
    if (!found) throw new Error('素材不存在')
    const sheet = handle?.assets.find(t.sheetHash)
    const widthOf = async (path: string): Promise<number> =>
      (await probe(resolveTools(), path)).width ?? 0
    expect((await widthOf(found.path)) * 2).toBe(await widthOf(sheet?.path ?? ''))
    // 存起來了
    expect(h.turnarounds.state(id).turnarounds.find((x) => x.id === t.id)?.cuts).toEqual({
      a: 0.25,
      b: 0.75,
    })
  })

  it('切線不合理（太靠近或超出範圍）會被拒絕', async () => {
    const h = setup()
    const { id } = await heroReady(h)
    h.turnarounds.generate(id)
    await finish(h, id, 4)
    const [t] = h.turnarounds.state(id).turnarounds
    if (!t) throw new Error('沒有候選')
    await expect(h.turnarounds.reslice(id, t.id, { a: 0.5, b: 0.52 })).rejects.toThrow()
    await expect(h.turnarounds.reslice(id, t.id, { a: 0, b: 1 })).rejects.toThrow()
    await expect(h.turnarounds.reslice(id, 'missing', { a: 0.3, b: 0.6 })).rejects.toThrow(
      '找不到這組三視圖',
    )
  })

  it('正在生成時不能重複開始；可以取消，取消不算錯誤', async () => {
    const h = setup()
    const { id } = await heroReady(h)
    h.turnarounds.generate(id)
    expect(() => {
      h.turnarounds.generate(id)
    }).toThrow('正在生成中')
    h.turnarounds.cancel(id)
    await vi.waitFor(() => {
      expect(h.turnarounds.state(id).generating).toBeUndefined()
    })
    expect(h.turnarounds.state(id).error).toBeUndefined()
  })
})
