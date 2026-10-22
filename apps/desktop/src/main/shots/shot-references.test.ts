import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from './test-harness'

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

const imageInputs = (h: Harness) =>
  (h.projects.current()?.repos.jobs.list() ?? [])
    .map((job) => job.input as { capability?: string; prompt?: string; referenceAssets?: string[] })
    .filter((input) => input.capability === 'edit' || input.capability === 't2i')

/**
 * 建好一個鏡頭：阿鐵（已鎖定、有主圖、另外加了「臉」「道具」兩張參考圖）出場，地點是舊倉庫
 * （已鎖定、有主圖，另外加了一張俯視圖）。圖都是真的檔案。
 */
async function scene(h: Harness) {
  const shot = h.shots.create({})
  const handle = h.projects.current()
  if (!handle) throw new Error('沒有專案')
  const put = async (byte: number): Promise<string> =>
    (await handle.assets.put(new Uint8Array([137, 80, 78, 71, byte]), 'image/png')).hash
  const hashes = {
    hero: await put(1),
    face: await put(2),
    prop: await put(3),
    main: await put(4),
    topDown: await put(5),
    stranger: await put(6),
  }
  const { characters, locationCards, outline } = handle.repos
  const person = characters.create('阿鐵')
  const concept = characters.addConcept({
    characterId: person.id,
    round: 1,
    slot: 0,
    assetHash: hashes.hero,
    modelId: 'mock/image',
  })
  characters.pickHero(person.id, concept.id)
  characters.setAnchor(person.id, '短黑髮、深藍工作服')
  characters.lock(person.id)
  characters.addReference({
    characterId: person.id,
    assetHash: hashes.face,
    purpose: 'face',
    label: '原版設定圖',
  })
  characters.addReference({ characterId: person.id, assetHash: hashes.prop, purpose: 'prop' })
  const place = outline.addLocation({ name: '舊倉庫' })
  locationCards.setAnchor(place.id, '潮濕的磚牆倉庫')
  const mainConcept = locationCards.addConcept({
    locationId: place.id,
    round: 1,
    slot: 0,
    assetHash: hashes.main,
    modelId: 'mock/image',
  })
  locationCards.pickMain(place.id, mainConcept.id)
  locationCards.addReference({
    locationId: place.id,
    assetHash: hashes.topDown,
    purpose: 'top_down',
    label: '格局',
  })
  locationCards.lock(place.id)
  h.shots.update(shot.id, {
    description: '阿鐵推開倉庫的門',
    characters: ['阿鐵'],
    locationId: place.id,
  })
  return { shot, handle, hashes }
}

describe('鏡頭的參考圖：可以挑的清單', () => {
  it('出場角色的主圖與另外加的參考圖、地點的主景與另外加的參考圖，都列出來；每張標著是誰的、什麼用途', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    const state = h.shots.references(shot.id)
    expect(state.candidates).toEqual([
      {
        assetHash: hashes.hero,
        ownerKind: 'character',
        ownerName: '阿鐵',
        purpose: '主圖',
        label: '',
      },
      {
        assetHash: hashes.face,
        ownerKind: 'character',
        ownerName: '阿鐵',
        purpose: '臉',
        label: '原版設定圖',
      },
      {
        assetHash: hashes.prop,
        ownerKind: 'character',
        ownerName: '阿鐵',
        purpose: '道具',
        label: '',
      },
      {
        assetHash: hashes.main,
        ownerKind: 'location',
        ownerName: '舊倉庫',
        purpose: '主景',
        label: '',
      },
      {
        assetHash: hashes.topDown,
        ownerKind: 'location',
        ownerName: '舊倉庫',
        purpose: '俯視',
        label: '格局',
      },
    ])
  })

  it('沒有手動指定時是自動挑（auto）：跟生成送出的一樣，沒有鎖定的圖也不會自己跑進去', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    const state = h.shots.references(shot.id)
    expect(state.auto).toBe(true)
    expect(state.limit).toBeGreaterThan(0)
    // 自動挑（中景）：角色的主圖＋用途對得上的臉＋場景的主景（道具、俯視圖不會自動帶）
    expect(state.picked.map((item) => item.assetHash)).toEqual([
      hashes.hero,
      hashes.face,
      hashes.main,
    ])
  })
})

describe('鏡頭的參考圖：角色另外加的參考圖會進首幀', () => {
  const sent = async (h: Harness, shotId: string) => {
    const before = imageInputs(h).length
    await h.shots.regenerate(shotId, 'all')
    await h.idle(shotId)
    return imageInputs(h).slice(before).at(-1)
  }

  it('中景：主圖 → 臉 → 場景主景，生成請求的 referenceAssets 真的有它，Prompt 說明每一張是什麼', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    h.shots.update(shot.id, { size: 'medium' })
    const request = await sent(h, shot.id)
    expect(request).toMatchObject({
      capability: 'edit',
      referenceAssets: [hashes.hero, hashes.face, hashes.main],
    })
    expect(request?.prompt).toContain(
      '第 1 張是阿鐵的主圖，第 2 張是阿鐵的臉，第 3 張是舊倉庫的主景',
    )
  })

  it('特寫：主圖 → 臉（沒有三視圖也沒有表情圖），仍然留一個名額給場景', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    h.shots.update(shot.id, { size: 'close_up' })
    expect((await sent(h, shot.id))?.referenceAssets).toEqual([
      hashes.hero,
      hashes.face,
      hashes.main,
    ])
  })

  it('遠景：看的是身體與服裝，「臉」這張不帶；整個清單都沒有對得上的用途就跟以前一樣', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    h.shots.update(shot.id, { size: 'wide' })
    const request = await sent(h, shot.id)
    expect(request?.referenceAssets).toEqual([hashes.hero, hashes.main])
    expect(request?.prompt).not.toContain('參考圖依序是')
  })

  it('參考圖拿掉之後（檔案還在、清單沒有它）不再帶，也不再有說明', async () => {
    const h = setup()
    const { shot, handle, hashes } = await scene(h)
    h.shots.update(shot.id, { size: 'medium' })
    const person = handle.repos.characters.list()[0]
    const face = handle.repos.characters.listReferences(person?.id ?? '')[0]
    handle.repos.characters.removeReference(person?.id ?? '', face?.id ?? '')
    const request = await sent(h, shot.id)
    expect(request?.referenceAssets).toEqual([hashes.hero, hashes.main])
    expect(request?.prompt).not.toContain('參考圖依序是')
  })
})

describe('鏡頭的參考圖：手動指定', () => {
  it('指定後只帶指定的、照指定的順序；生成請求的參考圖與 Prompt 說明都跟著；恢復自動就回到原本', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    const before = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    const auto = imageInputs(h).slice(before).at(-1)
    expect(auto).toMatchObject({
      capability: 'edit',
      referenceAssets: [hashes.hero, hashes.face, hashes.main],
    })

    const pinned = h.shots.setReferences(shot.id, [hashes.face, hashes.topDown])
    expect(pinned.auto).toBe(false)
    expect(pinned.picked.map((item) => item.assetHash)).toEqual([hashes.face, hashes.topDown])
    const beforePinned = imageInputs(h).length
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    const sent = imageInputs(h).slice(beforePinned).at(-1)
    expect(sent).toMatchObject({
      capability: 'edit',
      referenceAssets: [hashes.face, hashes.topDown],
    })
    expect(sent?.prompt).toContain('參考圖依序是：第 1 張是阿鐵的臉，第 2 張是舊倉庫的俯視。')

    const reset = h.shots.setReferences(shot.id, [])
    expect(reset.auto).toBe(true)
    expect(reset.picked.map((item) => item.assetHash)).toEqual([
      hashes.hero,
      hashes.face,
      hashes.main,
    ])
  })

  it('換了指定的圖，已經生成的第一張畫面就變成「需要重新生成」；恢復自動又對得上', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    await h.shots.regenerate(shot.id, 'all')
    await h.idle(shot.id)
    expect(h.shots.staleness().get(shot.id)).toBeUndefined()

    h.shots.setReferences(shot.id, [hashes.face])
    expect(h.shots.staleness().get(shot.id)?.image).toBe(true)
    h.shots.setReferences(shot.id, [])
    expect(h.shots.staleness().get(shot.id)).toBeUndefined()
  })

  it('只能挑這一鏡可以挑的圖、不能超過張數上限、找不到的鏡頭有白話錯誤；擋下來的不會改到現有的指定', async () => {
    const h = setup()
    const { shot, hashes } = await scene(h)
    const { limit } = h.shots.references(shot.id)
    expect(() => h.shots.setReferences(shot.id, [hashes.stranger])).toThrow(
      '不在這一鏡可以挑的參考圖裡',
    )
    expect(() =>
      h.shots.setReferences(
        shot.id,
        [hashes.hero, hashes.face, hashes.prop, hashes.main, hashes.topDown].slice(0, limit + 1),
      ),
    ).toThrow(`最多收 ${String(limit)} 張`)
    expect(() => h.shots.setReferences('nope', [])).toThrow('找不到這個鏡頭')
    expect(h.shots.references(shot.id).auto).toBe(true)
  })

  it('指定的圖後來不在清單裡了（例如把那張參考圖拿掉）：不帶它；全都不在就回到自動', async () => {
    const h = setup()
    const { shot, handle, hashes } = await scene(h)
    h.shots.setReferences(shot.id, [hashes.face])
    const person = handle.repos.characters.list()[0]
    const face = handle.repos.characters
      .listReferences(person?.id ?? '')
      .find((r) => r.purpose === 'face')
    if (!person || !face) throw new Error('沒有臉的參考圖')
    handle.repos.characters.removeReference(person.id, face.id)
    const state = h.shots.references(shot.id)
    expect(state.auto).toBe(true)
    expect(state.picked.map((item) => item.assetHash)).toEqual([hashes.hero, hashes.main])
  })
})
