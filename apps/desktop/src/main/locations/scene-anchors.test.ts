import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { lockedScenes } from './scene-anchors'

// 每個測試都要跑好幾次完整生成，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

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

const TEXT = '潮濕的磚牆倉庫，天窗透進冷光'

/** 建好專案、一個地點、一個鏡頭，並把地點的場景卡鎖定（主圖與兩個角度都是真的檔案）。 */
async function lockedWarehouse(h: Harness) {
  await h.runQuickStart() // 順便建立專案
  const handle = h.projects.current()
  if (!handle) throw new Error('沒有專案')
  const place = handle.repos.outline.addLocation({ name: '舊倉庫', description: '堆滿木箱' })
  const put = async (byte: number) =>
    (await handle.assets.put(new Uint8Array([137, 80, 78, 71, byte]), 'image/png')).hash
  const [main, reverse, wide] = [await put(1), await put(2), await put(3)]
  if (!main || !reverse || !wide) throw new Error('素材沒有寫入')
  const cards = handle.repos.locationCards
  cards.setAnchor(place.id, TEXT)
  const concept = cards.addConcept({
    locationId: place.id,
    round: 1,
    slot: 0,
    assetHash: main,
    modelId: 'mock/image',
  })
  cards.pickMain(place.id, concept.id)
  cards.setAngles(place.id, { reverse, wide })
  const shot = h.shots.create({})
  h.shots.update(shot.id, { description: '阿鐵推開倉庫的門', locationId: place.id })
  return { handle, place, shot, hashes: { main, reverse, wide } }
}

const imageInputs = (h: Harness) =>
  (h.projects.current()?.repos.jobs.list() ?? [])
    .map((job) => job.input as { capability?: string; prompt?: string; referenceAssets?: string[] })
    .filter((input) => input.capability === 'edit' || input.capability === 't2i')

describe('lockedScenes', () => {
  it('只列出已鎖定、描述不是空的場景卡，連同主圖與角度', async () => {
    const h = setup()
    const { handle, place, hashes } = await lockedWarehouse(h)
    expect(lockedScenes(handle)).toEqual([])

    handle.repos.locationCards.lock(place.id)
    const [scene] = lockedScenes(handle)
    expect(scene).toMatchObject({ id: place.id, name: '舊倉庫', text: TEXT })
    expect(scene?.images?.main?.hash).toBe(hashes.main)
    expect(scene?.images?.reverse?.hash).toBe(hashes.reverse)
    expect(scene?.images?.wide?.hash).toBe(hashes.wide)

    handle.repos.locationCards.unlock(place.id)
    expect(lockedScenes(handle)).toEqual([])
  })
})

describe('lockedScenes：另外加的參考圖', () => {
  it('俯視圖與縱深感的環境圖帶進場景；另外加的主景、拉遠全景只在場景卡本來那張缺的時候頂替', async () => {
    const h = setup()
    const { handle, place, hashes } = await lockedWarehouse(h)
    const put = async (byte: number) =>
      (await handle.assets.put(new Uint8Array([137, 80, 78, 71, byte]), 'image/png')).hash
    const [topDown, depth, otherWide] = [await put(11), await put(12), await put(13)]
    if (!topDown || !depth || !otherWide) throw new Error('素材沒有寫入')
    const cards = handle.repos.locationCards
    cards.addReference({ locationId: place.id, assetHash: topDown, purpose: 'top_down', label: '' })
    cards.addReference({ locationId: place.id, assetHash: depth, purpose: 'depth', label: '' })
    cards.addReference({ locationId: place.id, assetHash: otherWide, purpose: 'wide', label: '' })
    cards.lock(place.id)
    const [scene] = lockedScenes(handle)
    expect(scene?.images?.topDown?.hash).toBe(topDown)
    expect(scene?.images?.depth?.hash).toBe(depth)
    // 場景卡本來就有拉遠全景：另外加的那張不頂替
    expect(scene?.images?.wide?.hash).toBe(hashes.wide)
  })

  it('場景卡本來沒有的角度，用另外加的頂替；「一般」用途不會自動帶進去', async () => {
    const h = setup()
    const { handle, place, hashes } = await lockedWarehouse(h)
    const put = async (byte: number) =>
      (await handle.assets.put(new Uint8Array([137, 80, 78, 71, byte]), 'image/png')).hash
    const [extraWide, general] = [await put(21), await put(22)]
    if (!extraWide || !general) throw new Error('素材沒有寫入')
    const cards = handle.repos.locationCards
    cards.setAngles(place.id, { wide: '' })
    cards.addReference({ locationId: place.id, assetHash: extraWide, purpose: 'wide', label: '' })
    cards.addReference({ locationId: place.id, assetHash: general, purpose: 'general', label: '' })
    cards.lock(place.id)
    const [scene] = lockedScenes(handle)
    expect(scene?.images?.wide?.hash).toBe(extraWide)
    expect(scene?.images?.main?.hash).toBe(hashes.main)
    expect(Object.keys(scene?.images ?? {}).sort()).toEqual(['main', 'reverse', 'wide'])
  })

  it('正上方的鏡頭生首幀時，請求帶的是俯視圖', async () => {
    const h = setup()
    const { handle, place, shot } = await lockedWarehouse(h)
    const topDown = (await handle.assets.put(new Uint8Array([137, 80, 78, 71, 31]), 'image/png'))
      .hash
    handle.repos.locationCards.addReference({
      locationId: place.id,
      assetHash: topDown,
      purpose: 'top_down',
      label: '',
    })
    handle.repos.locationCards.lock(place.id)
    h.shots.update(shot.id, { angle: 'overhead' })
    const before = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    expect(imageInputs(h).slice(before).at(-1)).toMatchObject({
      capability: 'edit',
      referenceAssets: [topDown],
    })
  })
})

describe('已鎖定場景卡 → 鏡頭自動帶入', () => {
  it('鎖定後，鏡頭的畫面 Prompt 帶入場景描述並附上主場景圖當參考圖；草稿時完全不帶', async () => {
    const h = setup()
    const { handle, place, shot, hashes } = await lockedWarehouse(h)

    const draft = h.shots.list().shots.find((s) => s.id === shot.id)
    expect(draft?.autoPrompt).not.toContain(TEXT)
    const before = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    const plain = imageInputs(h).slice(before).at(-1)
    expect(plain).toMatchObject({ capability: 't2i', referenceAssets: [] })
    expect(plain?.prompt).not.toContain(TEXT)

    handle.repos.locationCards.lock(place.id)
    const locked = h.shots.list().shots.find((s) => s.id === shot.id)
    expect(locked?.autoPrompt).toContain(`場景（舊倉庫）——${TEXT}`)

    const beforeLocked = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    const withScene = imageInputs(h).slice(beforeLocked).at(-1)
    expect(withScene).toMatchObject({ capability: 'edit', referenceAssets: [hashes.main] })
    expect(withScene?.prompt).toContain(TEXT)
  })

  it('遠景鏡頭改用拉遠的全景；改了場景描述再鎖定，Prompt 跟著更新', async () => {
    const h = setup()
    const { handle, place, shot, hashes } = await lockedWarehouse(h)
    handle.repos.locationCards.lock(place.id)
    h.shots.update(shot.id, { size: 'wide' })

    const before = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    expect(imageInputs(h).slice(before).at(-1)).toMatchObject({
      capability: 'edit',
      referenceAssets: [hashes.wide],
    })

    handle.repos.locationCards.unlock(place.id)
    handle.repos.locationCards.setAnchor(place.id, '空曠的碼頭倉庫')
    handle.repos.locationCards.lock(place.id)
    expect(h.shots.list().shots.find((s) => s.id === shot.id)?.autoPrompt).toContain(
      '空曠的碼頭倉庫',
    )
  })
})
