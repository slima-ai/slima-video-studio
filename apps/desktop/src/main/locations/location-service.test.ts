import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

// 每個測試都要跑好幾次完整生成，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

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

/** 新增一個地點（沒有專案時會自動建立）。 */
function addPlace(h: Harness, name = '舊倉庫'): string {
  const view = h.outline.edit({ op: 'addLocation' })
  const location = view.locations.at(-1)
  if (!location) throw new Error('沒有新增地點')
  h.outline.edit({ op: 'updateLocation', locationId: location.id, patch: { name } })
  return location.id
}

const finish = async (
  h: Harness,
  id: string,
  check: (state: ReturnType<Harness['locations']['images']>) => void,
): Promise<void> => {
  await vi.waitFor(
    () => {
      const state = h.locations.images(id)
      expect(state.generating).toBeUndefined()
      check(state)
    },
    { timeout: 30_000, interval: 20 },
  )
}

const jobInputs = (h: Harness) =>
  (h.projects.current()?.repos.jobs.list() ?? []).map(
    (job) => job.input as { capability?: string; prompt?: string; referenceAssets?: string[] },
  )

describe('LocationService（示範模式）', () => {
  it('每個地點一張場景卡；一開始是草稿', () => {
    const h = setup()
    expect(h.locations.list()).toEqual([])
    const id = addPlace(h)
    expect(h.locations.list()).toMatchObject([
      { id, name: '舊倉庫', status: 'draft', anchorText: '' },
    ])
  })

  it('概念圖：一輪 4 張、Prompt 是沒有人物的場景圖；挑一張當主圖', async () => {
    const h = setup()
    const id = addPlace(h)
    h.locations.setAnchor(id, '潮濕的磚牆倉庫，天窗透進冷光')
    expect(h.locations.check(id, 'concepts')).toMatchObject({ ok: true, count: 4, demoMode: true })

    h.locations.generate(id, 'concepts')
    expect(h.locations.images(id).generating).toEqual({ kind: 'concepts', done: 0, total: 4 })
    await finish(h, id, (state) => {
      expect(state.concepts).toHaveLength(4)
    })
    const { concepts } = h.locations.images(id)
    expect(new Set(concepts.map((c) => c.assetHash)).size).toBe(4)
    const prompts = jobInputs(h).filter((i) => i.capability === 't2i')
    expect(prompts).toHaveLength(4)
    expect(prompts[0]?.prompt).toContain('場景設定圖，舊倉庫：潮濕的磚牆倉庫，天窗透進冷光')

    const [first] = concepts
    if (!first) throw new Error('沒有概念圖')
    expect(h.locations.pickMain(id, first.id)).toMatchObject({ mainAssetHash: first.assetHash })
    // 再生一輪：新的一輪排在前面
    h.locations.generate(id, 'concepts')
    await finish(h, id, (state) => {
      expect(state.concepts).toHaveLength(8)
    })
    expect(h.locations.images(id).concepts[0]?.round).toBe(2)
  })

  it('另外兩個角度：以主圖當參考圖，生好就記在場景卡上；沒有主圖不能生', async () => {
    const h = setup()
    const id = addPlace(h)
    expect(h.locations.check(id, 'angles')).toMatchObject({ ok: false })
    expect(h.locations.check(id, 'angles').issue).toContain('主場景圖')
    expect(() => {
      h.locations.generate(id, 'angles')
    }).toThrow('主場景圖')

    h.locations.generate(id, 'concepts')
    await finish(h, id, (state) => {
      expect(state.concepts).toHaveLength(4)
    })
    const concept = h.locations.images(id).concepts[0]
    if (!concept) throw new Error('沒有概念圖')
    h.locations.pickMain(id, concept.id)

    expect(h.locations.check(id, 'angles')).toMatchObject({ ok: true, count: 2 })
    h.locations.generate(id, 'angles')
    expect(h.locations.images(id).generating).toEqual({ kind: 'angles', done: 0, total: 2 })
    await vi.waitFor(
      () => {
        expect(h.locations.images(id).generating).toBeUndefined()
        const [card] = h.locations.list()
        expect(card?.angles.reverse).toBeDefined()
        expect(card?.angles.wide).toBeDefined()
      },
      { timeout: 30_000, interval: 20 },
    )
    const [card] = h.locations.list()
    expect(new Set([card?.mainAssetHash, card?.angles.reverse, card?.angles.wide]).size).toBe(3)
    const edits = jobInputs(h).filter((i) => i.capability === 'edit')
    expect(edits).toHaveLength(2)
    for (const input of edits) expect(input.referenceAssets).toEqual([concept.assetHash])
    expect(edits.some((i) => i.prompt?.includes('相反的方向'))).toBe(true)
    expect(edits.some((i) => i.prompt?.includes('拉遠的全景'))).toBe(true)

    // 換主圖 → 原本的角度不是照新主圖生的，清掉
    const another = h.locations.images(id).concepts[1]
    if (!another) throw new Error('沒有第二張概念圖')
    expect(h.locations.pickMain(id, another.id).angles).toEqual({})
  })

  it('鎖定要有描述和主圖；鎖定後不能改、不能重新生成；解除鎖定後可以', async () => {
    const h = setup()
    const id = addPlace(h)
    expect(() => h.locations.lock(id)).toThrow('固定的樣子')
    h.locations.setAnchor(id, '磚牆倉庫')
    expect(() => h.locations.lock(id)).toThrow('主場景圖')
    h.locations.generate(id, 'concepts')
    await finish(h, id, (state) => {
      expect(state.concepts).toHaveLength(4)
    })
    const concept = h.locations.images(id).concepts[0]
    if (!concept) throw new Error('沒有概念圖')
    h.locations.pickMain(id, concept.id)

    expect(h.locations.lock(id).status).toBe('locked')
    expect(() => h.locations.setAnchor(id, 'x')).toThrow('已經鎖定')
    expect(h.locations.check(id, 'concepts')).toMatchObject({ ok: false })
    expect(() => {
      h.locations.generate(id, 'concepts')
    }).toThrow('已經鎖定')
    expect(h.locations.unlock(id).status).toBe('draft')
    expect(h.locations.setAnchor(id, '新的樣子').anchorText).toBe('新的樣子')
  })

  it('生成中不能重複生成、挑主圖或鎖定；可以取消', async () => {
    const h = setup()
    const id = addPlace(h)
    h.locations.generate(id, 'concepts')
    expect(() => {
      h.locations.generate(id, 'concepts')
    }).toThrow('正在生成')
    expect(() => h.locations.lock(id)).toThrow('正在生成')
    expect(() => h.locations.pickMain(id, 'x')).toThrow('正在生成')
    h.locations.cancel(id)
    await vi.waitFor(() => {
      expect(h.locations.images(id).generating).toBeUndefined()
    })
    expect(h.locations.images(id).error).toBeUndefined()
  })

  it('預估超過單次上限 → 不能生成並說明原因；描述太長會被擋下', () => {
    const h = setup({ demoMode: false, perRunLimitUsd: 0.0001 })
    const id = addPlace(h)
    // 沒有 Key 也不是示範模式：先說明要設定模型
    expect(h.locations.check(id, 'concepts').ok).toBe(false)
    expect(() => h.locations.setAnchor(id, 'x'.repeat(1001))).toThrow('不要超過')
    expect(h.locations.check('nope', 'concepts').issue).toBe('找不到這個場景卡。')
  })

  it('廣播進度：每張圖完成都推一次完整快照', async () => {
    const h = setup()
    const id = addPlace(h)
    h.events.length = 0
    h.locations.generate(id, 'concepts')
    await finish(h, id, (state) => {
      expect(state.concepts).toHaveLength(4)
    })
    const states = h.events
      .filter((e) => e.name === 'locations.imagesChanged')
      .map((e) => e.payload as ReturnType<Harness['locations']['images']>)
    expect(states.map((s) => s.generating?.done)).toEqual([0, 1, 2, 3, 4, undefined])
  })
})

describe('LocationService：參考圖清單', () => {
  const putImage = async (h: Harness, byte: number, mime = 'image/png'): Promise<string> => {
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    return (await handle.assets.put(new Uint8Array([137, 80, 78, 71, byte]), mime)).hash
  }

  it('加上、列出、移除；同一張圖同一個用途只存一筆；回傳的是更新後的完整清單', async () => {
    const h = setup()
    const id = addPlace(h)
    expect(h.locations.references(id)).toEqual({ locationId: id, references: [] })
    const hash = await putImage(h, 1)
    const added = h.locations.addReference({
      locationId: id,
      assetHash: hash,
      purpose: 'top_down',
      label: '格局',
    })
    expect(added.references).toMatchObject([
      { assetHash: hash, purpose: 'top_down', label: '格局', source: 'added' },
    ])
    expect(
      h.locations.addReference({ locationId: id, assetHash: hash, purpose: 'top_down', label: '' })
        .references,
    ).toHaveLength(1)
    const [reference] = added.references
    if (!reference) throw new Error('沒有參考圖')
    expect(h.locations.removeReference(id, reference.id).references).toEqual([])
  })

  it('專案裡沒有的圖、不是圖片的檔案、找不到的場景卡：白話說明原因', async () => {
    const h = setup()
    const id = addPlace(h)
    const request = { locationId: id, purpose: 'depth', label: '' } as const
    expect(() => h.locations.addReference({ ...request, assetHash: 'f'.repeat(64) })).toThrow(
      '專案裡找不到這張圖片',
    )
    const notImage = await putImage(h, 2, 'video/mp4')
    expect(() => h.locations.addReference({ ...request, assetHash: notImage })).toThrow(
      '專案裡找不到這張圖片',
    )
    const hash = await putImage(h, 3)
    expect(() =>
      h.locations.addReference({ ...request, locationId: 'nope', assetHash: hash }),
    ).toThrow('找不到這個場景卡')
  })
})
