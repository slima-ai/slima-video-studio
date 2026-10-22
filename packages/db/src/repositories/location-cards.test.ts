import { AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const H3 = 'c'.repeat(64)

function setup() {
  const { repos } = newProject()
  const place = repos.outline.addLocation({ name: '舊倉庫', description: '堆滿木箱' })
  return { ...repos, place }
}

describe('LocationCardsRepository', () => {
  it('每個地點都有一張場景卡：一開始是草稿，沒有圖，也沒有固定描述', () => {
    const { locationCards, place } = setup()
    expect(locationCards.list()).toEqual([
      {
        id: place.id,
        name: '舊倉庫',
        description: '堆滿木箱',
        anchorText: '',
        status: 'draft',
        angles: {},
      },
    ])
    expect(locationCards.listLocked()).toEqual([])
  })

  it('概念圖依輪數保存，新的一輪在前；挑主圖會清掉原本的角度', () => {
    const { locationCards, place } = setup()
    expect(locationCards.nextConceptRound(place.id)).toBe(1)
    const a = locationCards.addConcept({
      locationId: place.id,
      round: 1,
      slot: 0,
      assetHash: H1,
      modelId: 'mock/image',
    })
    locationCards.addConcept({
      locationId: place.id,
      round: 2,
      slot: 0,
      assetHash: H2,
      modelId: 'mock/image',
    })
    expect(locationCards.nextConceptRound(place.id)).toBe(3)
    expect(locationCards.listConcepts(place.id).map((c) => c.round)).toEqual([2, 1])

    locationCards.pickMain(place.id, a.id)
    // 只有其中一個角度時，另一個就是沒有
    locationCards.setAngles(place.id, { wide: H3 })
    expect(locationCards.get(place.id)?.angles).toEqual({ wide: H3 })
    locationCards.setAngles(place.id, { reverse: H2, wide: H3 })
    expect(locationCards.get(place.id)).toMatchObject({
      mainAssetHash: H1,
      angles: { reverse: H2, wide: H3 },
    })
    // 只更新其中一個角度，另一個保留
    locationCards.setAngles(place.id, { wide: H1 })
    expect(locationCards.get(place.id)?.angles).toEqual({ reverse: H2, wide: H1 })

    const second = locationCards.listConcepts(place.id)[0]
    if (!second) throw new Error('沒有概念圖')
    locationCards.pickMain(place.id, second.id)
    expect(locationCards.get(place.id)).toMatchObject({ mainAssetHash: H2, angles: {} })
  })

  it('鎖定要有固定描述和主圖；鎖定後不能再改，解除鎖定才能改', () => {
    const { locationCards, place } = setup()
    expect(() => locationCards.lock(place.id)).toThrow(/固定的樣子/)
    locationCards.setAnchor(place.id, '  潮濕的磚牆倉庫  ')
    expect(() => locationCards.lock(place.id)).toThrow(/主場景圖/)
    const concept = locationCards.addConcept({
      locationId: place.id,
      round: 1,
      slot: 0,
      assetHash: H1,
      modelId: 'mock/image',
    })
    locationCards.pickMain(place.id, concept.id)

    expect(locationCards.lock(place.id)).toMatchObject({
      status: 'locked',
      anchorText: '潮濕的磚牆倉庫',
    })
    expect(locationCards.listLocked().map((c) => c.id)).toEqual([place.id])
    expect(() => locationCards.setAnchor(place.id, 'x')).toThrow(/已經鎖定/)
    expect(() => locationCards.pickMain(place.id, concept.id)).toThrow(AppError)
    expect(() => locationCards.setAngles(place.id, { wide: H2 })).toThrow(/已經鎖定/)

    expect(locationCards.unlock(place.id).status).toBe('draft')
    expect(locationCards.listLocked()).toEqual([])
    expect(locationCards.setAnchor(place.id, '新的樣子').anchorText).toBe('新的樣子')
  })

  it('找不到的場景卡或概念圖回報白話錯誤；別張場景卡的概念圖不能拿來用', () => {
    const { locationCards, outline, place } = setup()
    const other = outline.addLocation({ name: '海邊' })
    expect(() => locationCards.setAnchor('nope', 'x')).toThrow(/找不到這個場景卡/)
    expect(() => locationCards.lock('nope')).toThrow(AppError)
    const foreign = locationCards.addConcept({
      locationId: other.id,
      round: 1,
      slot: 0,
      assetHash: H1,
      modelId: 'm',
    })
    expect(() => locationCards.pickMain(place.id, foreign.id)).toThrow(/找不到這張概念圖/)
    expect(() => locationCards.pickMain(place.id, 'nope')).toThrow(/找不到這張概念圖/)
  })

  it('刪除地點時，場景卡的概念圖一起刪掉', () => {
    const { locationCards, outline, place } = setup()
    locationCards.addConcept({
      locationId: place.id,
      round: 1,
      slot: 0,
      assetHash: H1,
      modelId: 'm',
    })
    outline.deleteLocation(place.id)
    expect(locationCards.list()).toEqual([])
    expect(locationCards.listConcepts(place.id)).toEqual([])
  })

  describe('參考圖（有用途標記的清單）', () => {
    it('場景卡本來的主圖與兩個角度排在前面（source: card），另外加的在後（source: added）', () => {
      const { locationCards, place } = setup()
      expect(locationCards.listReferences(place.id)).toEqual([])
      const concept = locationCards.addConcept({
        locationId: place.id,
        round: 1,
        slot: 0,
        assetHash: H1,
        modelId: 'm',
      })
      locationCards.pickMain(place.id, concept.id)
      locationCards.setAngles(place.id, { wide: H2 })
      const added = locationCards.addReference({
        locationId: place.id,
        assetHash: H3,
        purpose: 'top_down',
        label: ' 從上面看的格局 ',
      })
      expect(added).toMatchObject({ purpose: 'top_down', label: '從上面看的格局', source: 'added' })
      expect(locationCards.listReferences(place.id)).toMatchObject([
        { id: 'card:main', assetHash: H1, purpose: 'main', source: 'card' },
        { id: 'card:wide', assetHash: H2, purpose: 'wide', source: 'card' },
        { id: added.id, assetHash: H3, purpose: 'top_down', source: 'added' },
      ])
    })

    it('同一張圖同一個用途只存一筆（再加一次回傳原來那筆）；同一張圖可以有不同的用途', () => {
      const { locationCards, place } = setup()
      const input = { locationId: place.id, assetHash: H1, purpose: 'depth', label: '' } as const
      const first = locationCards.addReference(input)
      expect(locationCards.addReference(input).id).toBe(first.id)
      locationCards.addReference({ ...input, purpose: 'general' })
      expect(locationCards.listReferences(place.id).map((r) => r.purpose)).toEqual([
        'depth',
        'general',
      ])
    })

    it('用途存成文字：讀到不認得的用途（較新版本存的）一律當 general，清單照樣讀得出來', () => {
      const handle = newProject()
      const spot = handle.repos.outline.addLocation({ name: '海邊' })
      handle.repos.locationCards.addReference({
        locationId: spot.id,
        assetHash: H2,
        purpose: 'depth',
        label: '',
      })
      // 模擬較新版本存了這個版本不認得的用途
      handle.sqlite.prepare("UPDATE location_references SET purpose = 'aerial-drone'").run()
      expect(handle.repos.locationCards.listReferences(spot.id).map((r) => r.purpose)).toEqual([
        'general',
      ])
    })

    it('移除只拿掉另外加的那一筆；已鎖定的場景卡要先解除鎖定才能加或拿；找不到的場景卡有白話錯誤', () => {
      const { locationCards, place } = setup()
      const added = locationCards.addReference({
        locationId: place.id,
        assetHash: H1,
        purpose: 'top_down',
        label: '',
      })
      locationCards.setAnchor(place.id, '潮濕的磚牆倉庫')
      const concept = locationCards.addConcept({
        locationId: place.id,
        round: 1,
        slot: 0,
        assetHash: H2,
        modelId: 'm',
      })
      locationCards.pickMain(place.id, concept.id)
      locationCards.lock(place.id)
      const request = { locationId: place.id, assetHash: H3, purpose: 'depth', label: '' } as const
      expect(() => locationCards.addReference(request)).toThrow(/已經鎖定/)
      expect(() => {
        locationCards.removeReference(place.id, added.id)
      }).toThrow(/已經鎖定/)
      locationCards.unlock(place.id)
      locationCards.removeReference(place.id, added.id)
      locationCards.removeReference(place.id, 'nope')
      expect(locationCards.listReferences(place.id).map((r) => r.source)).toEqual(['card'])
      expect(() => locationCards.addReference({ ...request, locationId: 'nope' })).toThrow(
        /找不到這個場景卡/,
      )
    })

    it('刪除地點時，另外加的參考圖一起刪掉', () => {
      const { locationCards, outline, place } = setup()
      locationCards.addReference({
        locationId: place.id,
        assetHash: H1,
        purpose: 'wide',
        label: '',
      })
      outline.deleteLocation(place.id)
      expect(() => locationCards.listReferences(place.id)).toThrow(/找不到這個場景卡/)
    })
  })
})
