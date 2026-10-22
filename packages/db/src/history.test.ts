import { AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject } from './__tests__/helpers'
import { StructureHistory } from './history'
import { shots } from './tables/core'
import { eq } from 'drizzle-orm'

const HASH = (c: string): string => c.repeat(64)

function setup() {
  const handle = newProject()
  const history = new StructureHistory(handle.db, handle.projectId)
  return { handle, repos: handle.repos, history }
}

describe('StructureHistory：大綱', () => {
  it('修改欄位：復原回到原值、重做再套回去', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })

    history.record('修改場的名字', () => repos.outline.updateScene(scene.id, { title: '巷口' }))
    expect(history.state()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: '修改場的名字',
    })

    expect(history.state()).toMatchObject({ undoCount: 1, redoCount: 0 })
    expect(history.undo()?.label).toBe('修改場的名字')
    expect(history.state()).toMatchObject({ undoCount: 0, redoCount: 1 })
    expect(repos.outline.listScenes()[0]?.title).toBe('街角')
    expect(history.state()).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: '修改場的名字',
    })

    history.redo()
    expect(repos.outline.listScenes()[0]?.title).toBe('巷口')
  })

  it('新增與刪除：復原新增就是刪掉；復原刪除幕會連它的場一起回來', () => {
    const { repos, history } = setup()
    const added = history.record('新增一幕', () => repos.outline.addAct({ title: '序幕' }))
    history.undo()
    expect(repos.outline.listActs()).toHaveLength(0)
    history.redo()
    expect(repos.outline.listActs().map((a) => a.id)).toEqual([added.id])

    const scene = repos.outline.addScene(added.id, { title: '街角', mood: '安靜' })
    history.clear()
    history.record('刪除這一幕', () => {
      repos.outline.deleteAct(added.id)
    })
    expect(repos.outline.listActs()).toHaveLength(0)
    history.undo()
    expect(repos.outline.listActs().map((a) => a.id)).toEqual([added.id])
    expect(repos.outline.listScenes()).toMatchObject([
      { id: scene.id, mood: '安靜', actId: added.id },
    ])
  })

  it('排序：復原與重做都回到對應的順序', () => {
    const { repos, history } = setup()
    const a = repos.outline.addAct({ title: 'A' })
    const b = repos.outline.addAct({ title: 'B' })
    history.record('整幕往後移', () => {
      repos.outline.moveAct(a.id, 'down')
    })
    expect(repos.outline.listActs().map((x) => x.title)).toEqual(['B', 'A'])
    history.undo()
    expect(repos.outline.listActs().map((x) => x.title)).toEqual(['A', 'B'])
    history.redo()
    expect(repos.outline.listActs().map((x) => x.title)).toEqual(['B', 'A'])
    expect(b.id).toBeDefined()
  })

  it('刪除場：用到它的鏡頭原本屬於這個場，復原後鏡頭又指回去', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    const shot = repos.shots.create({ sceneId: scene.id })
    history.record('刪除這個場', () => {
      repos.outline.deleteScene(scene.id)
    })
    expect(repos.shots.get(shot.id)?.sceneId).toBeUndefined()
    history.undo()
    expect(repos.shots.get(shot.id)?.sceneId).toBe(scene.id)
    history.redo()
    expect(repos.shots.get(shot.id)?.sceneId).toBeUndefined()
  })

  it('刪除地點：場與鏡頭的地點指定、場景卡的概念圖都會回來', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const place = repos.outline.addLocation({ name: '舊倉庫' })
    const scene = repos.outline.addScene(act.id, { title: '追逐', locationId: place.id })
    const shot = repos.shots.create({ locationId: place.id })
    repos.locationCards.addConcept({
      locationId: place.id,
      round: 1,
      slot: 0,
      assetHash: HASH('a'),
      modelId: 'm',
    })
    history.record('刪除地點', () => {
      repos.outline.deleteLocation(place.id)
    })
    expect(repos.outline.listLocations()).toHaveLength(0)
    history.undo()
    expect(repos.outline.listLocations().map((l) => l.id)).toEqual([place.id])
    expect(repos.outline.listScenes().find((s) => s.id === scene.id)?.locationId).toBe(place.id)
    expect(repos.shots.get(shot.id)?.locationId).toBe(place.id)
    expect(repos.locationCards.listConcepts(place.id)).toHaveLength(1)
  })

  it('場景卡的參考圖：加上、拿掉、連地點一起刪掉，都能復原', () => {
    const { repos, history } = setup()
    const place = repos.outline.addLocation({ name: '舊倉庫' })
    const added = history.record('加上場景參考圖', () =>
      repos.locationCards.addReference({
        locationId: place.id,
        assetHash: HASH('a'),
        purpose: 'top_down',
        label: '格局',
      }),
    )
    expect(repos.locationCards.listReferences(place.id)).toHaveLength(1)
    history.undo()
    expect(repos.locationCards.listReferences(place.id)).toHaveLength(0)
    history.redo()
    expect(repos.locationCards.listReferences(place.id).map((r) => r.id)).toEqual([added.id])
    history.record('拿掉場景參考圖', () => {
      repos.locationCards.removeReference(place.id, added.id)
    })
    expect(repos.locationCards.listReferences(place.id)).toHaveLength(0)
    history.undo()
    expect(repos.locationCards.listReferences(place.id).map((r) => r.id)).toEqual([added.id])
    history.record('刪除地點', () => {
      repos.outline.deleteLocation(place.id)
    })
    history.undo()
    expect(repos.locationCards.listReferences(place.id)).toMatchObject([
      { id: added.id, purpose: 'top_down', label: '格局' },
    ])
  })
})

describe('StructureHistory：鏡頭的參考圖釘選', () => {
  it('指定、改順序、清掉、連鏡頭一起刪掉，都能復原', () => {
    const { repos, history } = setup()
    const shot = repos.shots.create({ description: '一' })
    history.record('指定參考圖', () => {
      repos.shots.setPins(shot.id, [HASH('a'), HASH('b')])
    })
    history.record('改順序', () => {
      repos.shots.setPins(shot.id, [HASH('b'), HASH('a')])
    })
    expect(repos.shots.listPins(shot.id)).toEqual([HASH('b'), HASH('a')])
    history.undo()
    expect(repos.shots.listPins(shot.id)).toEqual([HASH('a'), HASH('b')])
    history.undo()
    expect(repos.shots.listPins(shot.id)).toEqual([])
    history.redo()
    history.record('刪除鏡頭', () => {
      repos.shots.delete(shot.id)
    })
    expect(repos.shots.allPins().size).toBe(0)
    history.undo()
    expect(repos.shots.listPins(shot.id)).toEqual([HASH('a'), HASH('b')])
  })
})

describe('StructureHistory：分鏡表', () => {
  it('刪除鏡頭：連同它生成過的版本一起回來，其他鏡頭的鏡號也還原', () => {
    const { repos, history } = setup()
    const first = repos.shots.create({ description: '一' })
    const second = repos.shots.create({ description: '二' })
    const take = repos.shots.addTake({
      shotId: first.id,
      kind: 'video',
      assetHash: HASH('a'),
      modelId: 'm',
    })
    history.record('刪除鏡頭', () => {
      repos.shots.delete(first.id)
      repos.shots.reorder([second.id])
    })
    expect(repos.shots.list().map((s) => [s.description, s.number])).toEqual([['二', 1]])

    history.undo()
    expect(repos.shots.list().map((s) => [s.description, s.number])).toEqual([
      ['一', 1],
      ['二', 2],
    ])
    expect(repos.shots.listTakes(first.id)).toMatchObject([{ id: take.id, adopted: true }])
    expect(repos.shots.get(first.id)?.activeTakeId).toBe(take.id)

    history.redo()
    expect(repos.shots.list().map((s) => s.description)).toEqual(['二'])
    expect(repos.shots.listTakes(first.id)).toHaveLength(0)
  })

  it('重新排序：復原回到原本的順序與鏡號', () => {
    const { repos, history } = setup()
    const a = repos.shots.create({ description: 'a' })
    const b = repos.shots.create({ description: 'b' })
    const c = repos.shots.create({ description: 'c' })
    history.record('調整鏡頭順序', () => {
      repos.shots.reorder([c.id, a.id, b.id])
    })
    expect(repos.shots.list().map((s) => s.description)).toEqual(['c', 'a', 'b'])
    history.undo()
    expect(repos.shots.list().map((s) => [s.description, s.number])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('欄位保護：動作之後別的地方又改了同一個欄位，復原不會把它蓋回舊值；沒動過的欄位照常復原', () => {
    const { repos, handle, history } = setup()
    const shot = repos.shots.create({ description: '原本', dialogue: '你好' })
    history.record('修改鏡頭', () => {
      repos.shots.update(shot.id, { description: '改過', dialogue: '哈囉' })
    })
    // 動作之後：重新生成改了狀態；使用者又在別處改了台詞（沒有記進歷史）
    repos.shots.update(shot.id, { status: 'done', dialogue: '再改一次' })

    history.undo()
    const after = repos.shots.get(shot.id)
    expect(after?.description).toBe('原本')
    expect(after?.dialogue).toBe('再改一次')
    expect(after?.status).toBe('done')
    expect(handle.db.select().from(shots).where(eq(shots.id, shot.id)).get()?.status).toBe('done')
  })
})

describe('StructureHistory：recordCreation', () => {
  it('動作之前什麼都沒有：把目前的內容整個記成這個動作，復原後回到空的', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '序幕' })
    repos.outline.addScene(act.id, { title: '街角' })
    history.recordCreation('新增一幕')
    expect(history.state().undoLabel).toBe('新增一幕')
    history.undo()
    expect(repos.outline.listActs()).toHaveLength(0)
    expect(repos.outline.listScenes()).toHaveLength(0)
    history.redo()
    expect(repos.outline.listScenes()).toMatchObject([{ title: '街角', actId: act.id }])
  })

  it('什麼都沒有就不記', () => {
    const { history } = setup()
    history.recordCreation('空的')
    expect(history.state().canUndo).toBe(false)
  })
})

describe('StructureHistory：begin（背景跑一段時間的動作）', () => {
  it('結束時把整段的變化記成一筆；復原回到開始之前，重做再全部回來', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const keep = repos.shots.create({ description: '原本的' })
    const finish = history.begin('一句話生成')
    const scene = repos.outline.addScene(act.id, { title: '新的場' })
    const made = repos.shots.create({ description: '新的', sceneId: scene.id })
    repos.shots.addTake({
      shotId: made.id,
      kind: 'first_frame',
      assetHash: HASH('b'),
      modelId: 'm',
    })
    expect(history.state().canUndo).toBe(false)
    finish()
    expect(history.state()).toMatchObject({ undoLabel: '一句話生成', undoCount: 1 })

    history.undo()
    expect(repos.shots.list().map((s) => s.id)).toEqual([keep.id])
    expect(repos.outline.listScenes()).toHaveLength(0)
    history.redo()
    expect(repos.shots.list().map((s) => s.description)).toEqual(['原本的', '新的'])
    expect(repos.shots.listTakes(made.id)).toHaveLength(1)
  })

  it('取代全部（先刪掉舊的再長新的）也能整個復原', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '舊的幕' })
    const old = repos.shots.create({ description: '舊鏡頭' })
    repos.shots.addTake({ shotId: old.id, kind: 'video', assetHash: HASH('c'), modelId: 'm' })
    const finish = history.begin('一句話生成')
    repos.shots.delete(old.id)
    repos.outline.deleteAct(act.id)
    repos.shots.create({ description: '新鏡頭' })
    finish()
    history.undo()
    expect(repos.shots.list().map((s) => s.description)).toEqual(['舊鏡頭'])
    expect(repos.shots.listTakes(old.id)).toHaveLength(1)
    expect(repos.outline.listActs().map((a) => a.title)).toEqual(['舊的幕'])
  })

  it('期間另外記下的動作併進這一筆；之前的紀錄不受影響；結束函式只算第一次', () => {
    const { repos, history } = setup()
    const shot = repos.shots.create({ description: 'a' })
    history.record('改一', () => repos.shots.update(shot.id, { description: 'b' }))
    const finish = history.begin('一句話生成')
    repos.shots.create({ description: '長出來的' })
    history.record('生成中順手改', () => repos.shots.update(shot.id, { description: 'c' }))
    finish()
    finish()
    expect(history.state()).toMatchObject({ undoLabel: '一句話生成', undoCount: 2 })
    history.undo()
    expect(repos.shots.list().map((s) => s.description)).toEqual(['b'])
    history.undo()
    expect(repos.shots.list().map((s) => s.description)).toEqual(['a'])
  })

  it('什麼都沒改（例如一開始就失敗）不留紀錄', () => {
    const { history } = setup()
    history.begin('一句話生成')()
    expect(history.state().canUndo).toBe(false)
  })
})

describe('StructureHistory：紀錄的規則', () => {
  it('沒有改到任何東西、或編輯失敗，都不會留下紀錄', () => {
    const { repos, history } = setup()
    const shot = repos.shots.create({ description: 'x' })
    history.record('什麼都沒改', () => {
      repos.shots.update(shot.id, { description: 'x' })
    })
    expect(history.state().canUndo).toBe(false)
    expect(() =>
      history.record('會失敗', () => {
        throw new Error('壞了')
      }),
    ).toThrow('壞了')
    expect(history.state().canUndo).toBe(false)
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBeUndefined()
  })

  it('復原之後又做了新動作，重做的紀錄就清掉', () => {
    const { repos, history } = setup()
    const shot = repos.shots.create({ description: 'a' })
    history.record('改一', () => repos.shots.update(shot.id, { description: 'b' }))
    history.undo()
    expect(history.state().canRedo).toBe(true)
    history.record('改二', () => repos.shots.update(shot.id, { description: 'c' }))
    expect(history.state()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: '改二' })
  })

  it('最多記住 limit 個動作，更早的被丟掉；clear 全部清空', () => {
    const { repos, handle } = setup()
    const history = new StructureHistory(handle.db, handle.projectId, 3)
    const shot = repos.shots.create({ description: '0' })
    for (let i = 1; i <= 5; i++) {
      history.record(`第 ${String(i)} 次`, () =>
        repos.shots.update(shot.id, { description: String(i) }),
      )
    }
    let undone = 0
    while (history.undo()) undone++
    expect(undone).toBe(3)
    expect(repos.shots.get(shot.id)?.description).toBe('2')
    history.clear()
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false })
    expect(history.state()).toMatchObject({ undoCount: 0, redoCount: 0 })
  })

  it('資料已經和當時對不上（相關的場被別的動作刪掉了）：回報白話錯誤，這筆紀錄作廢，資料不變', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    history.record('刪除這個場', () => {
      repos.outline.deleteScene(scene.id)
    })
    // 別的動作（沒有記進歷史）把幕也刪了，場就沒辦法再放回去
    repos.outline.deleteAct(act.id)
    expect(() => history.undo()).toThrow(AppError)
    expect(history.state().canUndo).toBe(false)
    expect(repos.outline.listScenes()).toHaveLength(0)
  })
})

describe('StructureHistory：聲音', () => {
  it('同一筆動作裡新增鏡頭與它的旁白、配樂：復原一起退回，重做一起回來', () => {
    const { repos, history } = setup()
    let shotId = ''
    history.record('生成影片', () => {
      const shot = repos.shots.create({ description: 'A' })
      shotId = shot.id
      repos.sound.addClip({
        kind: 'narration',
        shotId: shot.id,
        assetHash: HASH('a'),
        modelId: 'mock/tts',
        text: '一句話',
      })
      repos.sound.addClip({ kind: 'music', assetHash: HASH('m'), modelId: 'mock/music' })
    })
    expect(repos.sound.listClips()).toHaveLength(2)

    history.undo()
    expect(repos.shots.list()).toHaveLength(0)
    expect(repos.sound.listClips()).toHaveLength(0)

    history.redo()
    expect(repos.shots.list().map((s) => s.id)).toEqual([shotId])
    const clips = repos.sound.listClips()
    expect(clips.map((c) => c.kind).sort()).toEqual(['music', 'narration'])
    expect(clips.find((c) => c.kind === 'narration')).toMatchObject({
      shotId,
      text: '一句話',
      adopted: true,
    })
  })

  it('刪除旁白與配樂（含舊版本）：復原整個找回來（採用中的還是原本那個），重做再刪掉；台詞全程不動', () => {
    const { repos, history } = setup()
    const shot = repos.shots.create({ description: 'A', dialogue: '黑藤爬滿了斷橋。' })
    const first = repos.sound.addClip({
      kind: 'narration',
      shotId: shot.id,
      assetHash: HASH('a'),
      modelId: 'mock/tts',
      text: '黑藤爬滿了斷橋。',
    })
    const second = repos.sound.addClip({
      kind: 'narration',
      shotId: shot.id,
      assetHash: HASH('b'),
      modelId: 'mock/tts',
      text: '黑藤爬滿了斷橋。',
    })
    repos.sound.addClip({ kind: 'music', assetHash: HASH('m'), modelId: 'mock/music' })
    history.clear()

    history.record('刪除旁白', () => repos.sound.removeAll({ kind: 'narration' }))
    history.record('刪除配樂', () => repos.sound.removeAll({ kind: 'music' }))
    expect(repos.sound.listClips()).toHaveLength(0)
    expect(repos.shots.get(shot.id)?.dialogue).toBe('黑藤爬滿了斷橋。')

    expect(history.undo()?.label).toBe('刪除配樂')
    expect(history.undo()?.label).toBe('刪除旁白')
    const back = repos.sound.listClips()
    expect(back.map((c) => c.kind).sort()).toEqual(['music', 'narration', 'narration'])
    expect(back.find((c) => c.id === second.id)?.adopted).toBe(true)
    expect(back.find((c) => c.id === first.id)?.adopted).toBe(false)

    history.redo()
    history.redo()
    expect(repos.sound.listClips()).toHaveLength(0)
    expect(repos.shots.get(shot.id)?.dialogue).toBe('黑藤爬滿了斷橋。')
  })
})

describe('StructureHistory：group（Claude 一輪的改動併成一步）', () => {
  it('組裡的編輯併成一步；使用者自己的編輯照舊各一步、排在後面，復原的順序是後來的先退', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    history.clear()
    const turn = history.openGroup('Claude 這一輪')
    // Claude 改了場的名字、加了一幕
    history.record('改名', () => repos.outline.updateScene(scene.id, { title: '巷口' }), turn)
    // 使用者在這段時間自己加了一幕（不屬於這一組）
    const mine = history.record('新增一幕', () => repos.outline.addAct({ title: '我加的' }))
    // Claude 又加了一幕、又改了一次名字
    history.record('新增一幕', () => repos.outline.addAct({ title: 'Claude 加的' }), turn)
    history.record('改名', () => repos.outline.updateScene(scene.id, { title: '碼頭' }), turn)
    expect(history.state()).toMatchObject({ undoCount: 2, undoLabel: '新增一幕' })
    expect(history.groupIsOnTop(turn)).toBe(false)

    // 第一次復原：只退使用者自己的那一步
    history.undo()
    expect(repos.outline.listActs().map((a) => a.title)).toEqual(['一', 'Claude 加的'])
    expect(repos.outline.listActs().some((a) => a.id === mine.id)).toBe(false)
    expect(repos.outline.listScenes()[0]?.title).toBe('碼頭')
    // 第二次：Claude 這一輪整個退（兩次改名回到最早的名字、它加的那一幕不見）
    expect(history.groupIsOnTop(turn)).toBe(true)
    expect(history.undo()?.label).toBe('Claude 這一輪')
    expect(repos.outline.listActs().map((a) => a.title)).toEqual(['一'])
    expect(repos.outline.listScenes()[0]?.title).toBe('街角')
    // 重做：回到 Claude 做完的樣子
    history.redo()
    expect(repos.outline.listScenes()[0]?.title).toBe('碼頭')
    expect(repos.outline.listActs().map((a) => a.title)).toEqual(['一', 'Claude 加的'])
  })

  it('組裡新增又刪掉的東西不留痕跡；改了又改回原值的欄位不算改', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    history.clear()
    const turn = history.openGroup('Claude 這一輪')
    const temp = history.record('新增一幕', () => repos.outline.addAct({ title: '暫時的' }), turn)
    history.record(
      '刪除這一幕',
      () => {
        repos.outline.deleteAct(temp.id)
      },
      turn,
    )
    // 全部抵銷：沒有留下任何一步
    expect(history.state().canUndo).toBe(false)
    history.record('改名', () => repos.outline.updateAct(act.id, { title: '二' }), turn)
    history.record('改回去', () => repos.outline.updateAct(act.id, { title: '一' }), turn)
    expect(history.state().canUndo).toBe(false)
  })

  it('組裡新增了鏡頭、又改了它、再刪掉別的：復原一次全部回到開始之前', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    const old = repos.shots.create({ sceneId: scene.id, description: '原本的鏡頭' })
    history.clear()
    const turn = history.openGroup('Claude 這一輪')
    const fresh = history.record(
      '新增鏡頭',
      () => repos.shots.create({ sceneId: scene.id, description: '新的' }),
      turn,
    )
    history.record(
      '改鏡頭',
      () => repos.shots.update(fresh.id, { description: '新的（改過）' }),
      turn,
    )
    history.record(
      '改鏡頭',
      () => repos.shots.update(old.id, { description: '原本的（改過）' }),
      turn,
    )
    history.record(
      '刪除鏡頭',
      () => {
        repos.shots.delete(old.id)
      },
      turn,
    )
    expect(history.state().undoCount).toBe(1)
    history.undo()
    const left = repos.shots.list()
    expect(left.map((x) => x.description)).toEqual(['原本的鏡頭'])
    history.redo()
    expect(repos.shots.list().map((x) => x.description)).toEqual(['新的（改過）'])
  })

  it('收掉的組不再併；沒給組的編輯（使用者）不併進開著的組', () => {
    const { repos, history } = setup()
    const turn = history.openGroup('Claude 這一輪')
    history.record('新增一幕', () => repos.outline.addAct({ title: 'A' }), turn)
    history.closeGroup(turn)
    history.record('新增一幕', () => repos.outline.addAct({ title: 'B' }), turn)
    expect(history.state().undoCount).toBe(2)
    expect(history.groupIsOnTop(turn)).toBe(false)
  })

  it('同一輪裡 Claude 和使用者改到同一列：Claude 改 A→B、使用者改 B→C、Claude 再改 C→D；連按兩次復原最後回到 A，中間不丟錯', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: 'A' })
    history.clear()
    const turn = history.openGroup('Claude 這一輪')
    history.record('改名', () => repos.outline.updateAct(act.id, { title: 'B' }), turn)
    history.record('改名', () => repos.outline.updateAct(act.id, { title: 'C' }))
    history.record('改名', () => repos.outline.updateAct(act.id, { title: 'D' }), turn)
    // 組那一筆是 A→D（排在下面），使用者那一筆 B→C 在上面
    expect(history.state().undoCount).toBe(2)
    expect(repos.outline.listActs()[0]?.title).toBe('D')
    // 第一次復原：使用者那一步。現在的值（D）已經不是他留下的值（C），欄位保護讓這一步不動它，也不丟錯
    expect(history.undo()).toMatchObject({ applied: 0, skipped: 1 })
    expect(repos.outline.listActs()[0]?.title).toBe('D')
    // 第二次：Claude 這一輪整個退，回到最早的 A
    const second = history.undo()
    expect(second).toMatchObject({ label: 'Claude 這一輪', skipped: 0 })
    expect(repos.outline.listActs()[0]?.title).toBe('A')
    expect(history.state().canUndo).toBe(false)
    // 重做兩次也不丟錯，最後回到 Claude 做完的 D
    expect(() => {
      history.redo()
      history.redo()
    }).not.toThrow()
    expect(repos.outline.listActs()[0]?.title).toBe('D')
  })

  it('Claude 建了一列、使用者改了它、Claude 又把它刪掉：組那一筆抵銷不見，使用者那一筆指向不存在的列，按復原不會壞', () => {
    const { repos, history } = setup()
    history.clear()
    const turn = history.openGroup('Claude 這一輪')
    const act = history.record('新增一幕', () => repos.outline.addAct({ title: '暫時的' }), turn)
    history.record('改名', () => repos.outline.updateAct(act.id, { title: '使用者改的' }))
    history.record(
      '刪除這一幕',
      () => {
        repos.outline.deleteAct(act.id)
      },
      turn,
    )
    // 組抵銷了（新增又刪掉），只剩使用者那一筆
    expect(repos.outline.listActs()).toHaveLength(0)
    expect(history.state().undoCount).toBe(1)
    // 復原：那一列已經不在，這一步什麼都不動、不丟錯、資料沒壞
    expect(history.undo()).toMatchObject({ applied: 0, skipped: 1 })
    expect(repos.outline.listActs()).toHaveLength(0)
    expect(history.state().canUndo).toBe(false)
    // 之後的新操作照常能記、能復原
    const again = history.record('新增一幕', () => repos.outline.addAct({ title: '之後的' }))
    history.undo()
    expect(repos.outline.listActs().some((a) => a.id === again.id)).toBe(false)
  })

  it('一步裡只有一部分欄位後來又被改過：動了能動的，略過的數量照實回報；整步都被改過就是 applied 0', () => {
    const { repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角', mood: '安靜' })
    history.clear()
    history.record('改場', () =>
      repos.outline.updateScene(scene.id, { title: '巷口', mood: '緊張' }),
    )
    // 之後別的地方又把氣氛改了
    repos.outline.updateScene(scene.id, { mood: '熱鬧' })
    const result = history.undo()
    expect(result).toMatchObject({ applied: 1, skipped: 1 })
    const [after] = repos.outline.listScenes()
    expect(after?.title).toBe('街角')
    expect(after?.mood).toBe('熱鬧')
    // 整步都被改過
    history.record('改名', () => repos.outline.updateScene(scene.id, { title: '碼頭' }))
    repos.outline.updateScene(scene.id, { title: '倉庫' })
    expect(history.undo()).toMatchObject({ applied: 0, skipped: 1 })
  })

  it('重做時也一樣：復原後這一列又被別處改過，重做整步略過（applied 0）；只有一部分被改過就動能動的', () => {
    const { repos, history } = setup()
    const scene = repos.outline.addScene(repos.outline.addAct({ title: '一' }).id, {
      title: '街角',
      mood: '安靜',
    })
    history.clear()
    history.record('改名', () => repos.outline.updateScene(scene.id, { title: '巷口' }))
    history.undo()
    // 復原後別的地方把標題改了：重做要把標題從「街角」改成「巷口」，但現在的值已經不是「街角」
    repos.outline.updateScene(scene.id, { title: '碼頭' })
    expect(history.redo()).toMatchObject({ label: '改名', applied: 0, skipped: 1 })
    expect(repos.outline.listScenes()[0]?.title).toBe('碼頭')
    // 這一步照樣回到復原堆疊，沒有卡住
    expect(history.state().canUndo).toBe(true)

    history.clear()
    history.record('改場', () =>
      repos.outline.updateScene(scene.id, { title: '倉庫', mood: '緊張' }),
    )
    history.undo()
    repos.outline.updateScene(scene.id, { mood: '熱鬧' })
    expect(history.redo()).toMatchObject({ applied: 1, skipped: 1 })
    const [after] = repos.outline.listScenes()
    expect(after?.title).toBe('倉庫')
    expect(after?.mood).toBe('熱鬧')
  })
})

describe('StructureHistory：角色參考圖', () => {
  it('加參考圖、拿掉參考圖都能復原與重做；刪掉角色再復原，參考圖一起回來', () => {
    const { repos, history } = setup()
    const hero = repos.characters.create('小饅頭')
    const ref = history.record('加上參考圖', () =>
      repos.characters.addReference({
        characterId: hero.id,
        assetHash: HASH('a'),
        purpose: 'face',
        label: '原版設定圖',
      }),
    )
    history.undo()
    expect(repos.characters.listReferences(hero.id)).toEqual([])
    history.redo()
    expect(repos.characters.listReferences(hero.id).map((r) => r.id)).toEqual([ref.id])

    history.record('拿掉參考圖', () => repos.characters.removeReference(hero.id, ref.id))
    expect(repos.characters.listReferences(hero.id)).toEqual([])
    history.undo()
    expect(repos.characters.listReferences(hero.id)).toMatchObject([
      { id: ref.id, purpose: 'face', label: '原版設定圖' },
    ])

    history.record('刪除角色', () => {
      repos.characters.delete(hero.id)
    })
    expect(repos.characters.listReferences(hero.id)).toEqual([])
    history.undo()
    expect(repos.characters.listReferences(hero.id).map((r) => r.id)).toEqual([ref.id])
  })
})
