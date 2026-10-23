import { AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

const HASH = (c: string): string => c.repeat(64)

describe('ShotsRepository', () => {
  it('新增鏡頭時鏡號與排序依序遞增，並套用預設值', () => {
    const { repos } = newProject()
    const a = repos.shots.create({ description: 'A' })
    const b = repos.shots.create({ description: 'B', size: 'close_up' })
    expect([a.number, a.order]).toEqual([1, 0])
    expect([b.number, b.order]).toEqual([2, 1])
    expect(a).toMatchObject({
      size: 'medium',
      angle: 'eye_level',
      durationSec: 3,
      cameraMove: null,
      status: 'draft',
    })
    expect(repos.shots.list().map((s) => s.description)).toEqual(['A', 'B'])
  })

  it('動作欄：沒填是空字串，寫了能往返，update 可以清掉', () => {
    const { repos } = newProject()
    const plain = repos.shots.create({ description: 'A' })
    expect(plain.action).toBe('')
    const shot = repos.shots.create({ description: 'B', action: '向左跳一下' })
    expect(repos.shots.get(shot.id)?.action).toBe('向左跳一下')
    expect(repos.shots.update(shot.id, { action: '' }).action).toBe('')
    expect(repos.shots.get(shot.id)?.action).toBe('')
  })

  it('尾幀描述：沒填是空字串，寫了能往返，update 可以清掉', () => {
    const { repos } = newProject()
    expect(repos.shots.create({ description: 'A' }).endDescription).toBe('')
    const shot = repos.shots.create({ description: 'B', endDescription: 'now on the far side' })
    expect(repos.shots.get(shot.id)?.endDescription).toBe('now on the far side')
    expect(repos.shots.update(shot.id, { endDescription: '' }).endDescription).toBe('')
  })

  it('版本的輸入指紋可以事後補記或更新', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'A' })
    const take = repos.shots.addTake({
      shotId: shot.id,
      kind: 'first_frame',
      assetHash: HASH('a'),
      modelId: 'm',
    })
    expect(take.inputHash).toBeUndefined()
    repos.shots.setTakeInputHash(take.id, 'h1')
    repos.shots.setTakeInputHash(take.id, 'h2')
    expect(repos.shots.listTakes(shot.id, 'first_frame')[0]?.inputHash).toBe('h2')
  })

  it('出場角色（JSON 欄位）與可選欄位能完整往返', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({
      characters: [{ characterId: 'c1', costumeId: 'k1' }, { characterId: 'c2' }],
      lighting: '黃昏逆光',
      cameraMove: 'orbit',
    })
    expect(repos.shots.get(shot.id)).toEqual(shot)
  })

  it('出場角色可以只有名字（角色卡建立前，AI 拆鏡只給得出名字）', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ characters: [{ name: '小貓' }, { characterId: 'c1' }] })
    expect(repos.shots.get(shot.id)?.characters).toEqual([{ name: '小貓' }, { characterId: 'c1' }])
    expect(() => repos.shots.create({ characters: [{ costumeId: 'k1' }] })).toThrow()
  })

  it('update 傳入 undefined 可以清掉手動修改過的 prompt', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ prompt: '手動改的' })
    expect(repos.shots.update(shot.id, { prompt: undefined }).prompt).toBeUndefined()
    expect(repos.shots.get(shot.id)?.prompt).toBeUndefined()
  })

  it('update 合併欄位並驗證；找不到的鏡頭回報錯誤', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({})
    const updated = repos.shots.update(shot.id, {
      durationSec: 5,
      prompt: '新的 prompt',
      lighting: undefined,
    })
    expect(updated).toMatchObject({ durationSec: 5, prompt: '新的 prompt' })
    expect(() => repos.shots.update(shot.id, { durationSec: 0 })).toThrow()
    expect(() => repos.shots.update('missing', {})).toThrow(AppError)
  })

  it('刪除鏡頭時一併刪除它的版本（外鍵 cascade）', () => {
    const { repos, sqlite } = newProject()
    const shot = repos.shots.create({})
    repos.shots.addTake({ shotId: shot.id, kind: 'video', assetHash: HASH('a'), modelId: 'm' })
    repos.shots.delete(shot.id)
    expect(repos.shots.get(shot.id)).toBeUndefined()
    expect(sqlite.prepare('select count(*) from takes').pluck().get()).toBe(0)
  })

  it('reorder 依新順序重新排序並重編鏡號；不完整或重複的排序會被拒絕', () => {
    const { repos } = newProject()
    const [a, b, c] = ['A', 'B', 'C'].map((d) => repos.shots.create({ description: d }))
    if (!a || !b || !c) throw new Error('setup')
    repos.shots.reorder([c.id, a.id, b.id])
    expect(repos.shots.list().map((s) => [s.description, s.number])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ])
    expect(() => {
      repos.shots.reorder([a.id, b.id])
    }).toThrow(AppError)
    expect(() => {
      repos.shots.reorder([a.id, a.id, b.id])
    }).toThrow(AppError)
    expect(() => {
      repos.shots.reorder([a.id, b.id, 'x'])
    }).toThrow(AppError)
  })

  describe('版本（Take）', () => {
    it('版本號在同一鏡頭同一種類內遞增；第一個版本自動採用並設為鏡頭的 activeTakeId', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      const v1 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: HASH('a'),
        modelId: 'kling',
      })
      const v2 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: HASH('b'),
        modelId: 'kling',
        seed: 7,
      })
      const frame = repos.shots.addTake({
        shotId: shot.id,
        kind: 'first_frame',
        assetHash: HASH('c'),
        modelId: 'nb',
      })
      expect([v1.version, v1.adopted]).toEqual([1, true])
      expect([v2.version, v2.adopted, v2.seed]).toEqual([2, false, 7])
      expect([frame.version, frame.adopted]).toEqual([1, true])
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(v1.id)
    })

    it('deleteTake 拿掉採用中的版本：改採用同種類最新的那一個；都沒了就沒有採用中的', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      const add = (hash: string) =>
        repos.shots.addTake({
          shotId: shot.id,
          kind: 'first_frame',
          assetHash: HASH(hash),
          modelId: 'nb',
        })
      const v1 = add('a')
      const v2 = add('b')
      const upload = add('c')
      repos.shots.adoptTake(upload.id)
      repos.shots.deleteTake(upload.id)
      const adopted = () =>
        repos.shots
          .listTakes(shot.id, 'first_frame')
          .filter((t) => t.adopted)
          .map((t) => t.id)
      expect(adopted()).toEqual([v2.id])
      // 沒採用的拿掉：採用中的不變
      repos.shots.deleteTake(v1.id)
      expect(adopted()).toEqual([v2.id])
      repos.shots.deleteTake(v2.id)
      expect(repos.shots.listTakes(shot.id, 'first_frame')).toEqual([])
      // 不存在的不會出錯
      repos.shots.deleteTake('nope')
    })

    it('unadopt 清掉採用中的版本：版本都還在，影片的 activeTakeId 也清掉；別的種類不受影響', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      const add = (kind: 'first_frame' | 'video', hash: string) =>
        repos.shots.addTake({ shotId: shot.id, kind, assetHash: HASH(hash), modelId: 'm' })
      add('first_frame', 'a')
      const video = add('video', 'b')
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(video.id)
      repos.shots.unadopt(shot.id, 'video')
      expect(repos.shots.get(shot.id)?.activeTakeId).toBeUndefined()
      expect(repos.shots.listTakes(shot.id, 'video').map((t) => t.adopted)).toEqual([false])
      expect(repos.shots.listTakes(shot.id, 'first_frame').map((t) => t.adopted)).toEqual([true])
      // 之後還可以再採用
      repos.shots.adoptTake(video.id)
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(video.id)
    })

    it('adoptTake 切換採用版本：同種類只有一個採用，鏡頭的 activeTakeId 跟著更新', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      const v1 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: HASH('a'),
        modelId: 'k',
      })
      const v2 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: HASH('b'),
        modelId: 'k',
      })
      repos.shots.adoptTake(v2.id)
      expect(repos.shots.listTakes(shot.id, 'video').map((t) => [t.version, t.adopted])).toEqual([
        [1, false],
        [2, true],
      ])
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(v2.id)
      // 切回舊版本
      repos.shots.adoptTake(v1.id)
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(v1.id)
      expect(repos.shots.listTakes(shot.id).filter((t) => t.adopted)).toHaveLength(1)
    })

    it('首幀版本的採用不影響影片的 activeTakeId', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      const video = repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: HASH('a'),
        modelId: 'k',
      })
      const f1 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'first_frame',
        assetHash: HASH('b'),
        modelId: 'n',
      })
      const f2 = repos.shots.addTake({
        shotId: shot.id,
        kind: 'first_frame',
        assetHash: HASH('c'),
        modelId: 'n',
      })
      repos.shots.adoptTake(f2.id)
      expect(repos.shots.get(shot.id)?.activeTakeId).toBe(video.id)
      expect(repos.shots.listTakes(shot.id, 'first_frame').map((t) => t.adopted)).toEqual([
        false,
        true,
      ])
      expect(f1.version).toBe(1)
    })

    it('找不到的版本回報錯誤；不合法的雜湊被拒絕', () => {
      const { repos } = newProject()
      const shot = repos.shots.create({})
      expect(() => repos.shots.adoptTake('missing')).toThrow(AppError)
      expect(() =>
        repos.shots.addTake({ shotId: shot.id, kind: 'video', assetHash: 'abc', modelId: 'm' }),
      ).toThrow()
    })
  })
})

describe('ShotsRepository：時段', () => {
  it('時段與光線存進資料庫，清掉後回到沒有', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'x', lighting: '逆光', timeOfDay: '黃昏' })
    expect(repos.shots.get(shot.id)).toMatchObject({ lighting: '逆光', timeOfDay: '黃昏' })
    repos.shots.update(shot.id, { timeOfDay: undefined })
    expect(repos.shots.get(shot.id)?.timeOfDay).toBeUndefined()
  })

  it('版本記錄擁有者（鏡頭）；採用只影響同一擁有者、同一種類；新鏡頭預設放進成品', () => {
    const { repos, sqlite } = newProject()
    const a = repos.shots.create({ description: 'A' })
    const b = repos.shots.create({ description: 'B' })
    expect(a.inCut).toBe(true)
    const a1 = repos.shots.addTake({
      shotId: a.id,
      kind: 'video',
      assetHash: HASH('a'),
      modelId: 'm',
      inputHash: 'x1',
    })
    const a2 = repos.shots.addTake({
      shotId: a.id,
      kind: 'video',
      assetHash: HASH('b'),
      modelId: 'm',
    })
    const b1 = repos.shots.addTake({
      shotId: b.id,
      kind: 'video',
      assetHash: HASH('c'),
      modelId: 'm',
    })
    expect(a1.inputHash).toBe('x1')
    expect(
      sqlite.prepare('select owner_type, owner_id from takes where id = ?').get(a1.id),
    ).toEqual({
      owner_type: 'shot',
      owner_id: a.id,
    })
    repos.shots.adoptTake(a2.id)
    expect(
      repos.shots
        .adoptedTakes()
        .map((t) => t.id)
        .sort(),
    ).toEqual([a2.id, b1.id].sort())
  })
})

describe('ShotsRepository：參考圖釘選', () => {
  it('整份換、依序讀；重複的只留第一次；空陣列＝清掉（回到自動）；沒指定的鏡頭是空陣列', () => {
    const { repos } = newProject()
    const a = repos.shots.create({})
    const b = repos.shots.create({})
    expect(repos.shots.listPins(a.id)).toEqual([])
    repos.shots.setPins(a.id, [HASH('c'), HASH('a'), HASH('c'), HASH('b')])
    repos.shots.setPins(b.id, [HASH('d')])
    expect(repos.shots.listPins(a.id)).toEqual([HASH('c'), HASH('a'), HASH('b')])
    expect(repos.shots.allPins()).toEqual(
      new Map([
        [a.id, [HASH('c'), HASH('a'), HASH('b')]],
        [b.id, [HASH('d')]],
      ]),
    )
    repos.shots.setPins(a.id, [HASH('b'), HASH('c')])
    expect(repos.shots.listPins(a.id)).toEqual([HASH('b'), HASH('c')])
    repos.shots.setPins(a.id, [])
    expect(repos.shots.listPins(a.id)).toEqual([])
    expect(repos.shots.allPins().has(a.id)).toBe(false)
  })

  it('找不到的鏡頭有白話錯誤；刪鏡頭時它的釘選一起刪掉', () => {
    const { repos } = newProject()
    expect(() => {
      repos.shots.setPins('nope', [HASH('a')])
    }).toThrow(AppError)
    const a = repos.shots.create({})
    repos.shots.setPins(a.id, [HASH('a')])
    repos.shots.delete(a.id)
    expect(repos.shots.allPins().size).toBe(0)
  })
})
