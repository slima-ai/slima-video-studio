import { AppError } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

describe('OutlineRepository：幕與場', () => {
  it('新增幕與場：依加入的順序排列，場屬於指定的幕', () => {
    const { repos } = newProject()
    const { outline } = repos
    const a1 = outline.addAct({ title: '開場' })
    const a2 = outline.addAct({ title: '高潮', summary: '雨夜' })
    const s1 = outline.addScene(a1.id, { title: '街角', mood: '安靜' })
    const s2 = outline.addScene(a2.id, { title: '屋頂' })
    const s3 = outline.addScene(a1.id, { title: '咖啡店' })

    expect(outline.listActs().map((a) => a.title)).toEqual(['開場', '高潮'])
    expect(outline.listActs()[1]?.summary).toBe('雨夜')
    // 排序是「幕的順序 → 場的順序」
    expect(outline.listScenes().map((s) => s.title)).toEqual(['街角', '咖啡店', '屋頂'])
    expect(s1).toMatchObject({ actId: a1.id, mood: '安靜' })
    expect([s2.actId, s3.actId]).toEqual([a2.id, a1.id])
  })

  it('修改欄位；選填欄位傳 null 代表清掉；搬到另一幕會排在那一幕最後', () => {
    const { repos } = newProject()
    const { outline } = repos
    const a1 = outline.addAct({ title: '一' })
    const a2 = outline.addAct({ title: '二' })
    const where = outline.addLocation({ name: '舊倉庫' })
    const scene = outline.addScene(a1.id, { title: '追逐' })
    outline.addScene(a2.id, { title: '對峙' })

    expect(
      outline.updateScene(scene.id, {
        title: '大追逐',
        locationId: where.id,
        timeOfDay: '深夜',
        mood: '緊張',
      }),
    ).toMatchObject({ title: '大追逐', locationId: where.id, timeOfDay: '深夜', mood: '緊張' })
    expect(outline.updateScene(scene.id, { mood: null, locationId: null })).toMatchObject({
      timeOfDay: '深夜',
    })
    const cleared = outline.listScenes().find((s) => s.id === scene.id)
    expect(cleared?.mood).toBeUndefined()
    expect(cleared?.locationId).toBeUndefined()

    outline.updateScene(scene.id, { actId: a2.id })
    expect(outline.listScenes().map((s) => [s.title, s.actId === a2.id])).toEqual([
      ['對峙', true],
      ['大追逐', true],
    ])
    expect(outline.updateAct(a1.id, { title: '序幕' }).title).toBe('序幕')
  })

  it('調整順序：同一幕裡的場、整幕的前後；已經在邊界就不動', () => {
    const { repos } = newProject()
    const { outline } = repos
    const a1 = outline.addAct({ title: 'A' })
    const a2 = outline.addAct({ title: 'B' })
    const x = outline.addScene(a1.id, { title: 'x' })
    outline.addScene(a1.id, { title: 'y' })
    outline.addScene(a2.id, { title: 'z' })

    outline.moveScene(x.id, 'down')
    expect(outline.listScenes().map((s) => s.title)).toEqual(['y', 'x', 'z'])
    outline.moveScene(x.id, 'down') // 已經是這一幕最後一個：不會跑到下一幕
    expect(outline.listScenes().map((s) => s.title)).toEqual(['y', 'x', 'z'])
    outline.moveScene(x.id, 'up')
    expect(outline.listScenes().map((s) => s.title)).toEqual(['x', 'y', 'z'])

    outline.moveAct(a2.id, 'up')
    expect(outline.listActs().map((a) => a.title)).toEqual(['B', 'A'])
    expect(outline.listScenes().map((s) => s.title)).toEqual(['z', 'x', 'y'])
    outline.moveAct(a2.id, 'up')
    expect(outline.listActs().map((a) => a.title)).toEqual(['B', 'A'])
  })

  it('刪除一幕連同它的場；刪場不影響其他；鏡頭保留但不再屬於任何場', () => {
    const { repos } = newProject()
    const { outline, shots } = repos
    const a1 = outline.addAct({ title: 'A' })
    const a2 = outline.addAct({ title: 'B' })
    const s1 = outline.addScene(a1.id, { title: 'x' })
    outline.addScene(a1.id, { title: 'y' })
    outline.addScene(a2.id, { title: 'z' })
    const shot = shots.create({ description: '一個鏡頭', sceneId: s1.id })

    outline.deleteScene(s1.id)
    expect(outline.listScenes().map((s) => s.title)).toEqual(['y', 'z'])
    expect(shots.get(shot.id)?.sceneId).toBeUndefined()

    outline.deleteAct(a1.id)
    expect(outline.listActs().map((a) => a.title)).toEqual(['B'])
    expect(outline.listScenes().map((s) => s.title)).toEqual(['z'])
  })

  it('找不到的幕或場回報白話錯誤', () => {
    const { repos } = newProject()
    expect(() => repos.outline.updateAct('nope', { title: 'x' })).toThrow(AppError)
    expect(() => repos.outline.addScene('nope', { title: 'x' })).toThrow(AppError)
    expect(() => {
      repos.outline.moveScene('nope', 'up')
    }).toThrow(AppError)
    expect(() => {
      repos.outline.moveAct('nope', 'up')
    }).toThrow(AppError)
  })

  it('clear 清掉所有的幕與場，地點保留', () => {
    const { repos } = newProject()
    const { outline } = repos
    const act = outline.addAct({ title: 'A' })
    outline.addScene(act.id, { title: 'x' })
    outline.addLocation({ name: '海邊' })
    outline.clear()
    expect(outline.listActs()).toEqual([])
    expect(outline.listScenes()).toEqual([])
    expect(outline.listLocations().map((l) => l.name)).toEqual(['海邊'])
  })
})

describe('OutlineRepository：地點', () => {
  it('新增、修改、依建立順序列出', () => {
    const { repos } = newProject()
    const { outline } = repos
    const a = outline.addLocation({ name: '海邊', description: '黃昏的沙灘' })
    outline.addLocation({ name: '舊倉庫' })
    expect(outline.listLocations().map((l) => l.name)).toEqual(['海邊', '舊倉庫'])
    expect(outline.updateLocation(a.id, { name: '海灘' })).toMatchObject({
      name: '海灘',
      description: '黃昏的沙灘',
    })
    expect(() => outline.updateLocation('nope', { name: 'x' })).toThrow(AppError)
  })

  it('刪除地點：用到它的場與鏡頭只是不再指定地點', () => {
    const { repos } = newProject()
    const { outline, shots } = repos
    const place = outline.addLocation({ name: '海邊' })
    const act = outline.addAct({ title: 'A' })
    const scene = outline.addScene(act.id, { title: 'x', locationId: place.id })
    const shot = shots.create({ description: 's', locationId: place.id })

    outline.deleteLocation(place.id)
    expect(outline.listLocations()).toEqual([])
    expect(outline.listScenes().find((s) => s.id === scene.id)?.locationId).toBeUndefined()
    expect(shots.get(shot.id)?.locationId).toBeUndefined()
  })
})
