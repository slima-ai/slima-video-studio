import { AppError, DEFAULT_TRAILER_SETTINGS } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from '../__tests__/helpers'
import { StructureHistory } from '../history'
import { copyProject } from '../project-copy'
import { tempDir, env } from '../__tests__/helpers'
import { join } from 'node:path'

const HASH = (c: string): string => c.repeat(64)

describe('預告片設定（trailer_settings）', () => {
  it('一般專案沒有設定（get 回 undefined）；第一次更新就建立，沒給的欄位是預設值（30 秒、劇情型）', () => {
    const { repos } = newProject()
    expect(repos.trailer.get()).toBeUndefined()
    const created = repos.trailer.update({ title: '黑藤裂谷' })
    expect(created).toEqual({ ...DEFAULT_TRAILER_SETTINGS, title: '黑藤裂谷' })
    expect(created.targetSec).toBe(30)
    expect(repos.trailer.get()).toEqual(created)
  })

  it('逐項合併：只改一個欄位，其他欄位保持原樣（不會被蓋回預設）', () => {
    const { repos } = newProject()
    repos.trailer.update({ title: '黑藤裂谷', author: '某作者', targetSec: 45, kind: 'teaser' })
    const next = repos.trailer.update({ endLine: '12 月 1 日上市', claims: ['金鼎獎入圍'] })
    expect(next).toMatchObject({
      title: '黑藤裂谷',
      author: '某作者',
      targetSec: 45,
      kind: 'teaser',
      endLine: '12 月 1 日上市',
      claims: ['金鼎獎入圍'],
    })
    // 明確傳 undefined 也不能蓋掉原值
    expect(repos.trailer.update({ title: undefined }).title).toBe('黑藤裂谷')
  })

  it('封面：給雜湊就存；傳 null 就拿掉', () => {
    const { repos } = newProject()
    expect(repos.trailer.update({ coverAssetHash: HASH('a') }).coverAssetHash).toBe(HASH('a'))
    const removed = repos.trailer.update({ coverAssetHash: null })
    expect(removed.coverAssetHash).toBeUndefined()
    expect(repos.trailer.get()?.coverAssetHash).toBeUndefined()
  })

  it('不合格的值丟 AppError，原本的設定不變', () => {
    const { repos } = newProject()
    repos.trailer.update({ targetSec: 30 })
    for (const bad of [{ targetSec: 5 }, { targetSec: 500 }, { coverAssetHash: 'xyz' }]) {
      expect(() => repos.trailer.update(bad as never)).toThrow(AppError)
    }
    expect(repos.trailer.get()?.targetSec).toBe(30)
  })

  it('重開專案還在；remove 之後又變回一般專案', () => {
    const handle = newProject()
    handle.repos.trailer.update({ title: '黑藤裂谷', targetSec: 60 })
    handle.close()
    const again = reopen(handle)
    expect(again.repos.trailer.get()).toMatchObject({ title: '黑藤裂谷', targetSec: 60 })
    again.repos.trailer.remove()
    expect(again.repos.trailer.get()).toBeUndefined()
  })

  it('復原與重做：改設定、第一次建立設定都能一步退回', () => {
    const { repos, db, projectId } = newProject()
    const history = new StructureHistory(db, projectId)
    history.record('開始做預告片', () => repos.trailer.update({ title: '黑藤裂谷' }))
    history.record('改長度', () => repos.trailer.update({ targetSec: 60 }))
    expect(repos.trailer.get()?.targetSec).toBe(60)

    history.undo()
    expect(repos.trailer.get()).toMatchObject({ title: '黑藤裂谷', targetSec: 30 })
    history.undo()
    expect(repos.trailer.get()).toBeUndefined()
    history.redo()
    expect(repos.trailer.get()).toMatchObject({ title: '黑藤裂谷', targetSec: 30 })
    history.redo()
    expect(repos.trailer.get()?.targetSec).toBe(60)
  })

  it('另存為：預告片設定與鏡頭的格子種類一起帶到複本', async () => {
    const handle = newProject()
    handle.repos.trailer.update({ title: '黑藤裂谷', targetSec: 45 })
    handle.repos.shots.create({ beatKind: 'card', card: { text: '他回來了' } })
    const dest = join(tempDir(), '複本.svsproj')
    await copyProject(handle, dest, { name: '複本', env })
    const copy = reopen({ ...handle, dir: dest })
    expect(copy.repos.trailer.get()).toMatchObject({ title: '黑藤裂谷', targetSec: 45 })
    expect(copy.repos.shots.list()[0]).toMatchObject({
      beatKind: 'card',
      card: { text: '他回來了', subtext: '' },
    })
  })
})

describe('鏡頭的格子種類 beat_kind 與字卡 card', () => {
  it('沒指定就是 video、沒有字卡', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: '黑藤爬滿斷橋' })
    expect(shot.beatKind).toBe('video')
    expect(shot.card).toBeUndefined()
    expect(repos.shots.get(shot.id)).toMatchObject({ beatKind: 'video' })
    expect(repos.shots.get(shot.id)?.card).toBeUndefined()
  })

  it('字卡、片名卡、靜態鏡頭：存進去再讀出來一樣；改種類、改字、清掉字卡', () => {
    const { repos } = newProject()
    const card = repos.shots.create({
      beatKind: 'card',
      durationSec: 2.5,
      card: { text: '他回來了', subtext: '第一章' },
    })
    expect(repos.shots.get(card.id)).toMatchObject({
      beatKind: 'card',
      durationSec: 2.5,
      card: { text: '他回來了', subtext: '第一章' },
    })
    const title = repos.shots.create({ beatKind: 'title' })
    const still = repos.shots.create({ beatKind: 'still' })
    expect(repos.shots.list().map((s) => s.beatKind)).toEqual(['card', 'title', 'still'])
    expect(title.card).toBeUndefined()
    expect(still.card).toBeUndefined()

    repos.shots.update(card.id, { card: { text: '這一次', subtext: '' } })
    expect(repos.shots.get(card.id)?.card).toEqual({ text: '這一次', subtext: '' })
    repos.shots.update(card.id, { beatKind: 'video', card: undefined })
    const cleared = repos.shots.get(card.id)
    expect(cleared?.beatKind).toBe('video')
    expect(cleared?.card).toBeUndefined()
  })

  it('鏡頭的格子種類與字卡跟著復原與重做', () => {
    const { repos, db, projectId } = newProject()
    const history = new StructureHistory(db, projectId)
    const shot = repos.shots.create({})
    history.record('改成字卡', () =>
      repos.shots.update(shot.id, { beatKind: 'card', card: { text: '他回來了', subtext: '' } }),
    )
    history.undo()
    expect(repos.shots.get(shot.id)?.beatKind).toBe('video')
    expect(repos.shots.get(shot.id)?.card).toBeUndefined()
    history.redo()
    expect(repos.shots.get(shot.id)).toMatchObject({ beatKind: 'card', card: { text: '他回來了' } })
  })
})

describe('鏡頭的段落 segment（預告片腳本屬於模板的哪一段）', () => {
  it('沒指定就沒有段落；存進去再讀出來一樣；改掉、清掉', () => {
    const { repos } = newProject()
    const plain = repos.shots.create({ description: '黑藤爬滿斷橋' })
    expect(plain.segment).toBeUndefined()
    expect(repos.shots.get(plain.id)?.segment).toBeUndefined()
    const shot = repos.shots.create({ description: '燈熄了', segment: 'suspense' })
    expect(repos.shots.get(shot.id)?.segment).toBe('suspense')
    expect(repos.shots.update(shot.id, { segment: 'escalate' }).segment).toBe('escalate')
    expect(repos.shots.get(shot.id)?.segment).toBe('escalate')
    const cleared = repos.shots.update(shot.id, { segment: undefined })
    expect(cleared.segment).toBeUndefined()
  })

  it('復原與重做：段落跟著鏡頭一起退回', () => {
    const { repos, db, projectId } = newProject()
    const history = new StructureHistory(db, projectId)
    const shot = history.record('加一格', () =>
      repos.shots.create({ description: '燈熄了', segment: 'suspense' }),
    )
    history.undo()
    expect(repos.shots.get(shot.id)).toBeUndefined()
    history.redo()
    expect(repos.shots.get(shot.id)?.segment).toBe('suspense')
  })

  it('另存為：段落一起帶到複本', async () => {
    const handle = newProject()
    handle.repos.shots.create({ description: '燈熄了', segment: 'suspense' })
    const dest = join(tempDir(), '段落複本.svsproj')
    await copyProject(handle, dest, { name: '複本', env })
    const copy = reopen({ ...handle, dir: dest })
    expect(copy.repos.shots.list()[0]?.segment).toBe('suspense')
  })
})
