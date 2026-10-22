import { AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject, reopen, tempDir } from '../__tests__/helpers'
import { openProject } from '../project-folder'
import { outfitOf } from './characters'

describe('CharactersRepository', () => {
  it('新增角色：名字會去掉前後空白，其他欄位是空的', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('  阿鐵 ')
    expect(hero).toMatchObject({ name: '阿鐵', appearance: '', personality: '', costumes: [] })
    expect(repos.characters.list().map((c) => c.name)).toEqual(['阿鐵'])
  })

  it('修改欄位：服裝存成第一套，年齡可以清掉', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const edited = repos.characters.update(hero.id, {
      appearance: '短黑髮、琥珀色眼睛',
      personality: '嘴硬心軟',
      age: '28',
      outfit: '深藍工作服',
    })
    expect(edited).toMatchObject({ appearance: '短黑髮、琥珀色眼睛', age: '28' })
    expect(outfitOf(edited)).toBe('深藍工作服')
    expect(edited.costumes).toHaveLength(1)

    const again = repos.characters.update(hero.id, { outfit: '紅色雨衣', age: null })
    expect(outfitOf(again)).toBe('紅色雨衣')
    expect(again.costumes).toHaveLength(1)
    expect(again.costumes[0]?.id).toBe(edited.costumes[0]?.id)
    expect(again.age).toBeUndefined()
    expect(again.updatedAt >= edited.updatedAt).toBe(true)
  })

  it('沒傳的欄位不會被清掉；找不到的角色回報錯誤', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.update(hero.id, { personality: '嘴硬心軟' })
    expect(repos.characters.update(hero.id, { name: '鐵哥' })).toMatchObject({
      name: '鐵哥',
      personality: '嘴硬心軟',
    })
    expect(() => repos.characters.update('missing', {})).toThrow(AppError)
  })

  it('刪除角色；刪不存在的不會出錯', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.delete(hero.id)
    repos.characters.delete(hero.id)
    expect(repos.characters.list()).toEqual([])
  })

  it('重新開啟專案後資料還在', () => {
    const dir = tempDir()
    const first = newProject('角色專案', dir)
    const hero = first.repos.characters.create('阿鐵')
    first.repos.characters.update(hero.id, { appearance: '短黑髮', outfit: '工作服' })
    const { dir: projectDir } = first
    first.close()
    const reopened = openProject(projectDir, { appVersion: '0.0.0-test' })
    try {
      const [loaded] = reopened.repos.characters.list()
      expect(loaded).toMatchObject({ name: '阿鐵', appearance: '短黑髮' })
      expect(loaded ? outfitOf(loaded) : '').toBe('工作服')
    } finally {
      reopened.close()
    }
  })

  it('角色依建立順序排列', () => {
    const { repos } = newProject()
    repos.characters.create('甲')
    repos.characters.create('乙')
    expect(repos.characters.list().map((c) => c.name)).toEqual(['甲', '乙'])
  })
})

describe('CharactersRepository：固定外觀描述與版本', () => {
  it('還沒寫過就沒有角色包；寫了之後是第 1 版草稿，鎖定後變成已鎖定', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    expect(repos.characters.pack(hero.id)).toBeUndefined()

    const draft = repos.characters.setAnchor(hero.id, '  短黑髮、琥珀色眼睛  ')
    expect(draft).toMatchObject({ version: 1, status: 'draft', anchorText: '短黑髮、琥珀色眼睛' })
    expect(repos.characters.get(hero.id)?.currentPackId).toBe(draft.id)

    repos.characters.setAnchor(hero.id, '短黑髮、琥珀色眼睛、左臉小疤')
    expect(repos.characters.packs(hero.id)).toHaveLength(1)

    expect(repos.characters.lock(hero.id)).toMatchObject({ version: 1, status: 'locked' })
    expect(repos.characters.pack(hero.id)).toMatchObject({
      status: 'locked',
      anchorText: '短黑髮、琥珀色眼睛、左臉小疤',
    })
  })

  it('空的不能鎖定；已經鎖定再鎖一次不會多出版本', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    expect(() => repos.characters.lock(hero.id)).toThrow(AppError)
    repos.characters.setAnchor(hero.id, '   ')
    expect(() => repos.characters.lock(hero.id)).toThrow(AppError)
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    repos.characters.lock(hero.id)
    expect(repos.characters.packs(hero.id)).toHaveLength(1)
  })

  it('改已鎖定的描述 → 下一版草稿，舊版保留且仍是鎖定', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)

    const next = repos.characters.setAnchor(hero.id, '短黑髮、戴眼鏡')
    expect(next).toMatchObject({ version: 2, status: 'draft', anchorText: '短黑髮、戴眼鏡' })
    expect(repos.characters.packs(hero.id).map((p) => [p.version, p.status, p.anchorText])).toEqual(
      [
        [1, 'locked', '短黑髮'],
        [2, 'draft', '短黑髮、戴眼鏡'],
      ],
    )
    expect(repos.characters.lock(hero.id)).toMatchObject({ version: 2, status: 'locked' })
  })

  it('已鎖定後改長相或服裝 → 退回下一版草稿（描述沿用）；改名字或個性不影響', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)

    repos.characters.update(hero.id, { name: '鐵哥', personality: '嘴硬心軟' })
    expect(repos.characters.pack(hero.id)).toMatchObject({ version: 1, status: 'locked' })

    repos.characters.update(hero.id, { appearance: '剪成平頭' })
    expect(repos.characters.pack(hero.id)).toMatchObject({
      version: 2,
      status: 'draft',
      anchorText: '短黑髮',
    })
    // 同樣的內容再存一次不會再多一版
    repos.characters.update(hero.id, { appearance: '剪成平頭' })
    expect(repos.characters.packs(hero.id)).toHaveLength(2)

    repos.characters.lock(hero.id)
    repos.characters.update(hero.id, { outfit: '紅色雨衣' })
    expect(repos.characters.pack(hero.id)).toMatchObject({ version: 3, status: 'draft' })
  })

  it('還沒寫過固定描述時改長相，不會冒出空的角色包', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.update(hero.id, { appearance: '短黑髮' })
    expect(repos.characters.packs(hero.id)).toEqual([])
  })

  it('刪除角色連同它的所有版本一起刪掉', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    repos.characters.delete(hero.id)
    expect(repos.characters.packs(hero.id)).toEqual([])
  })
})

describe('CharactersRepository：概念圖與主圖', () => {
  const H = (c: string): string => c.repeat(64)

  it('每一輪的編號遞增；列出時新的一輪在前、同一輪依順序', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    expect(repos.characters.nextConceptRound(hero.id)).toBe(1)
    for (const slot of [0, 1, 2, 3]) {
      repos.characters.addConcept({
        characterId: hero.id,
        round: 1,
        slot,
        assetHash: H('a'),
        modelId: 'mock/image',
      })
    }
    expect(repos.characters.nextConceptRound(hero.id)).toBe(2)
    repos.characters.addConcept({
      characterId: hero.id,
      round: 2,
      slot: 0,
      assetHash: H('b'),
      modelId: 'mock/image',
    })
    expect(repos.characters.listConcepts(hero.id).map((c) => [c.round, c.assetHash[0]])).toEqual([
      [2, 'b'],
      [1, 'a'],
      [1, 'a'],
      [1, 'a'],
      [1, 'a'],
    ])
  })

  it('挑主圖：存在第 1 版草稿；已鎖定的角色挑新主圖 → 下一版草稿，舊主圖留在舊版', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const first = repos.characters.addConcept({
      characterId: hero.id,
      round: 1,
      slot: 0,
      assetHash: H('a'),
      modelId: 'm',
    })
    const second = repos.characters.addConcept({
      characterId: hero.id,
      round: 1,
      slot: 1,
      assetHash: H('b'),
      modelId: 'm',
    })
    expect(repos.characters.pickHero(hero.id, first.id)).toMatchObject({
      version: 1,
      status: 'draft',
      heroAssetHash: H('a'),
    })

    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    expect(repos.characters.pickHero(hero.id, second.id)).toMatchObject({
      version: 2,
      status: 'draft',
      heroAssetHash: H('b'),
      anchorText: '短黑髮',
    })
    expect(repos.characters.packs(hero.id).map((p) => [p.version, p.heroAssetHash?.[0]])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ])
  })

  it('重新挑同一張不會多出版本；別的角色的概念圖不能挑', () => {
    const { repos } = newProject()
    const a = repos.characters.create('甲')
    const b = repos.characters.create('乙')
    const concept = repos.characters.addConcept({
      characterId: a.id,
      round: 1,
      slot: 0,
      assetHash: H('a'),
      modelId: 'm',
    })
    repos.characters.pickHero(a.id, concept.id)
    repos.characters.setAnchor(a.id, '短髮')
    repos.characters.lock(a.id)
    repos.characters.pickHero(a.id, concept.id)
    expect(repos.characters.pack(a.id)).toMatchObject({ version: 1, status: 'locked' })
    expect(() => repos.characters.pickHero(b.id, concept.id)).toThrow(AppError)
  })

  it('刪除角色連同概念圖一起刪掉', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.addConcept({
      characterId: hero.id,
      round: 1,
      slot: 0,
      assetHash: H('a'),
      modelId: 'm',
    })
    repos.characters.delete(hero.id)
    expect(repos.characters.listConcepts(hero.id)).toEqual([])
  })
})

describe('CharactersRepository：參考圖（有用途標記的清單）', () => {
  const H = (c: string): string => c.repeat(64)

  it('加參考圖：先加的在前，每一筆有用途與備註；沒有的角色回報錯誤', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('小饅頭')
    expect(repos.characters.listReferences(hero.id)).toEqual([])
    const face = repos.characters.addReference({
      characterId: hero.id,
      assetHash: H('a'),
      purpose: 'face',
      label: '  原版設定圖 ',
    })
    repos.characters.addReference({ characterId: hero.id, assetHash: H('b'), purpose: 'body' })
    expect(face).toMatchObject({ purpose: 'face', label: '原版設定圖', source: 'added' })
    expect(repos.characters.listReferences(hero.id).map((r) => [r.assetHash, r.purpose])).toEqual([
      [H('a'), 'face'],
      [H('b'), 'body'],
    ])
    expect(() =>
      repos.characters.addReference({ characterId: 'nope', assetHash: H('a'), purpose: 'face' }),
    ).toThrow(AppError)
  })

  it('同一張圖同一個用途只有一筆（只更新備註）；同一張圖可以有不同的用途', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('小饅頭')
    const first = repos.characters.addReference({
      characterId: hero.id,
      assetHash: H('a'),
      purpose: 'face',
    })
    const again = repos.characters.addReference({
      characterId: hero.id,
      assetHash: H('a'),
      purpose: 'face',
      label: '新備註',
    })
    expect(again.id).toBe(first.id)
    expect(repos.characters.listReferences(hero.id)).toHaveLength(1)
    expect(repos.characters.listReferences(hero.id)[0]?.label).toBe('新備註')
    // 沒給備註再加一次不會把備註清掉
    repos.characters.addReference({ characterId: hero.id, assetHash: H('a'), purpose: 'face' })
    expect(repos.characters.listReferences(hero.id)[0]?.label).toBe('新備註')
    repos.characters.addReference({ characterId: hero.id, assetHash: H('a'), purpose: 'prop' })
    expect(repos.characters.listReferences(hero.id).map((r) => r.purpose)).toEqual(['face', 'prop'])
  })

  it('移除：只刪那一筆；別的角色的參考圖動不了；沒有的回 false', () => {
    const { repos } = newProject()
    const a = repos.characters.create('小饅頭')
    const b = repos.characters.create('獸人')
    const ref = repos.characters.addReference({
      characterId: a.id,
      assetHash: H('a'),
      purpose: 'face',
    })
    repos.characters.addReference({ characterId: a.id, assetHash: H('b'), purpose: 'body' })
    expect(repos.characters.removeReference(b.id, ref.id)).toBe(false)
    expect(repos.characters.removeReference(a.id, 'nope')).toBe(false)
    expect(repos.characters.removeReference(a.id, ref.id)).toBe(true)
    expect(repos.characters.listReferences(a.id).map((r) => r.purpose)).toEqual(['body'])
  })

  it('讀到不認得的用途（較新版本存的）當成 general，整份清單照樣讀得出來；重新開啟專案後還在', () => {
    const first = newProject()
    const hero = first.repos.characters.create('小饅頭')
    first.repos.characters.addReference({
      characterId: hero.id,
      assetHash: H('a'),
      purpose: 'face',
    })
    first.sqlite.prepare("UPDATE character_references SET purpose = 'weapon-from-the-future'").run()
    first.close()
    const reopened = reopen(first)
    expect(reopened.repos.characters.listReferences(hero.id)).toMatchObject([
      { assetHash: H('a'), purpose: 'general' },
    ])
  })

  it('刪除角色連同參考圖一起刪掉', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('小饅頭')
    repos.characters.addReference({ characterId: hero.id, assetHash: H('a'), purpose: 'face' })
    repos.characters.delete(hero.id)
    expect(repos.characters.listReferences(hero.id)).toEqual([])
  })
})

describe('CharactersRepository：三視圖', () => {
  const H = (c: string): string => c.repeat(64)
  const turn = (characterId: string, round: number, slot: number, c: string) => ({
    characterId,
    round,
    slot,
    sheetHash: H(c),
    frontHash: H('1'),
    sideHash: H('2'),
    backHash: H('3'),
    cuts: { a: 1 / 3, b: 2 / 3 },
    heroHash: H('h'),
    modelId: 'mock/image',
  })

  it('候選依輪次排列（新的在前）；輪次遞增', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    expect(repos.characters.nextTurnaroundRound(hero.id)).toBe(1)
    for (const slot of [0, 1]) repos.characters.addTurnaround(turn(hero.id, 1, slot, 'a'))
    repos.characters.addTurnaround(turn(hero.id, 2, 0, 'b'))
    expect(repos.characters.nextTurnaroundRound(hero.id)).toBe(3)
    expect(repos.characters.listTurnarounds(hero.id).map((t) => [t.round, t.sheetHash[0]])).toEqual(
      [
        [2, 'b'],
        [1, 'a'],
        [1, 'a'],
      ],
    )
  })

  it('調整切線：更新三張切圖與切線位置', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const t = repos.characters.addTurnaround(turn(hero.id, 1, 0, 'a'))
    const updated = repos.characters.updateTurnaroundSlices(hero.id, t.id, {
      frontHash: H('4'),
      sideHash: H('5'),
      backHash: H('6'),
      cuts: { a: 0.3, b: 0.7 },
    })
    expect(updated).toMatchObject({ frontHash: H('4'), cuts: { a: 0.3, b: 0.7 } })
    expect(repos.characters.listTurnarounds(hero.id)[0]).toEqual(updated)
    expect(() =>
      repos.characters.updateTurnaroundSlices('other', t.id, {
        frontHash: H('4'),
        sideHash: H('5'),
        backHash: H('6'),
        cuts: { a: 0.3, b: 0.7 },
      }),
    ).toThrow(AppError)
  })

  it('採用：存在角色包；已鎖定的角色 → 下一版草稿；重複採用同一組不再多一版', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const a = repos.characters.addTurnaround(turn(hero.id, 1, 0, 'a'))
    const b = repos.characters.addTurnaround({
      ...turn(hero.id, 1, 1, 'b'),
      frontHash: H('7'),
    })
    expect(repos.characters.adoptTurnaround(hero.id, a.id)).toMatchObject({
      version: 1,
      turnaround: { front: H('1'), side: H('2'), back: H('3') },
    })

    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    repos.characters.adoptTurnaround(hero.id, a.id)
    expect(repos.characters.pack(hero.id)).toMatchObject({ version: 1, status: 'locked' })

    expect(repos.characters.adoptTurnaround(hero.id, b.id)).toMatchObject({
      version: 2,
      status: 'draft',
      turnaround: { front: H('7') },
    })
  })

  it('刪除角色連同三視圖候選一起刪掉', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.addTurnaround(turn(hero.id, 1, 0, 'a'))
    repos.characters.delete(hero.id)
    expect(repos.characters.listTurnarounds(hero.id)).toEqual([])
  })
})

describe('CharactersRepository：還原舊版本', () => {
  const H = (c: string): string => c.repeat(64)

  it('目前已鎖定 → 以舊版內容開下一版草稿；所有舊版保留不變', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    const v1 = repos.characters.pack(hero.id)
    repos.characters.setAnchor(hero.id, '長白髮')
    repos.characters.lock(hero.id)
    expect(repos.characters.pack(hero.id)).toMatchObject({ version: 2, status: 'locked' })

    const restored = repos.characters.restorePack(hero.id, v1?.id ?? '')
    expect(restored).toMatchObject({ version: 3, status: 'draft', anchorText: '短黑髮' })
    expect(repos.characters.pack(hero.id)?.id).toBe(restored.id)
    expect(repos.characters.packs(hero.id).map((p) => [p.version, p.status, p.anchorText])).toEqual(
      [
        [1, 'locked', '短黑髮'],
        [2, 'locked', '長白髮'],
        [3, 'draft', '短黑髮'],
      ],
    )
  })

  it('目前是草稿 → 直接換成舊版內容（含主圖與三視圖），不多出版本', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const concept = repos.characters.addConcept({
      characterId: hero.id,
      round: 1,
      slot: 0,
      assetHash: H('a'),
      modelId: 'm',
    })
    repos.characters.pickHero(hero.id, concept.id)
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    const v1 = repos.characters.pack(hero.id)
    repos.characters.setAnchor(hero.id, '亂改的草稿')

    const restored = repos.characters.restorePack(hero.id, v1?.id ?? '')
    expect(restored).toMatchObject({ version: 2, anchorText: '短黑髮', heroAssetHash: H('a') })
    expect(repos.characters.packs(hero.id)).toHaveLength(2)
    expect(repos.characters.pack(hero.id)).toMatchObject({ anchorText: '短黑髮', status: 'draft' })
  })

  it('還原目前這一版什麼都不做；別的角色或不存在的版本回報錯誤', () => {
    const { repos } = newProject()
    const hero = repos.characters.create('阿鐵')
    const other = repos.characters.create('小雨')
    repos.characters.setAnchor(hero.id, '短黑髮')
    repos.characters.lock(hero.id)
    const current = repos.characters.pack(hero.id)
    repos.characters.setAnchor(other.id, '雨衣')

    expect(repos.characters.restorePack(hero.id, current?.id ?? '')).toEqual(current)
    expect(repos.characters.packs(hero.id)).toHaveLength(1)
    const foreign = repos.characters.pack(other.id)
    expect(() => repos.characters.restorePack(hero.id, foreign?.id ?? '')).toThrow(AppError)
    expect(() => repos.characters.restorePack(hero.id, 'nope')).toThrow(AppError)
  })
})
