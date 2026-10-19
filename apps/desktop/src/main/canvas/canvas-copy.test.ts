import { afterEach, describe, expect, it } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 跑完一次 3 鏡的快速開始（有場、鏡頭、圖和影片）。 */
async function setup() {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.runQuickStart()
  const history = createHistoryService({ projects: h.projects, broadcast: () => undefined })
  return { h, history }
}

const nodesOf = (h: ReturnType<typeof createStudioHarness>, kind: string) =>
  h.canvas.get().nodes.filter((n) => n.kind === kind)

describe('貼上複製的格子', { timeout: 30_000 }, () => {
  it('鏡頭：在原鏡頭後面新增一鏡，帶描述、台詞、出場角色、景別，不帶圖和影片', async () => {
    const { h } = await setup()
    const [first, second] = h.shots.list().shots
    if (!first || !second) throw new Error('沒有鏡頭')
    h.shots.update(first.id, { dialogue: '你好', characters: ['小貓'], size: 'close_up' })
    const result = h.canvas.paste({ keys: [`shot:${first.id}`] })
    expect(result.added).toHaveLength(1)
    const shots = h.shots.list().shots
    expect(shots.map((s) => s.number)).toEqual([1, 2, 3, 4])
    const copy = shots[1]
    expect(`shot:${copy?.id ?? ''}`).toBe(result.added[0]?.key)
    expect(copy).toMatchObject({
      description: first.description,
      dialogue: '你好',
      characters: ['小貓'],
      size: 'close_up',
    })
    expect(copy?.firstFrames).toEqual([])
    expect(copy?.videos).toEqual([])
    // 原本的第 2 鏡變成第 3 鏡
    expect(shots[2]?.id).toBe(second.id)
  })

  it('圖、影片：貼成獨立的圖片、影片（用採用中的版本），往右下挪一點', async () => {
    const { h } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const image = h.canvas.get().nodes.find((n) => n.key === `shot:${shot.id}:image`)
    const video = h.canvas.get().nodes.find((n) => n.key === `shot:${shot.id}:video`)
    const result = h.canvas.paste({
      keys: [`shot:${shot.id}:image`, `shot:${shot.id}:video`],
      dx: 40,
      dy: 40,
    })
    expect(result.added.map((a) => a.title)).toEqual(['第 1 鏡的圖', '第 1 鏡的影片'])
    const [freeImage] = nodesOf(h, 'free_image')
    const [freeVideo] = nodesOf(h, 'free_video')
    expect(freeImage).toMatchObject({ assetHash: image?.assetHash, x: (image?.x ?? 0) + 40 })
    expect(freeVideo).toMatchObject({ assetHash: video?.assetHash, y: (video?.y ?? 0) + 40 })
    // 鏡頭本身沒變
    expect(h.shots.list().shots).toHaveLength(3)
  })

  it('還沒有版本的圖：跳過並說明原因', async () => {
    const { h } = await setup()
    const created = h.shots.create({})
    const result = h.canvas.paste({ keys: [`shot:${created.id}:image`] })
    expect(result.added).toEqual([])
    expect(result.skipped[0]?.reason).toContain('還沒有圖或影片')
  })

  it('角色、地點：複製一份「副本」，帶外觀與描述，不帶定稿圖；放在原本的旁邊', async () => {
    const { h } = await setup()
    const hero = h.canvas.add({ kind: 'character', x: 100, y: 200 })
    const heroId = hero.key.replace('character:', '')
    h.characters.update(heroId, { appearance: '橘色短毛', outfit: '紅色圍巾' })
    const place = h.canvas.add({ kind: 'location', x: 100, y: 500 })
    const placeId = place.key.replace('location:', '')
    h.outline.edit({
      op: 'updateLocation',
      locationId: placeId,
      patch: { name: '巷口', description: '下雨的巷口' },
    })

    const result = h.canvas.paste({ keys: [hero.key, place.key], dx: 40, dy: 40 })
    expect(result.added.map((a) => a.title)).toEqual([`${hero.title} 副本`, '巷口 副本'])
    const copy = h.characters.list().find((c) => c.name === `${hero.title} 副本`)
    expect(copy).toMatchObject({ appearance: '橘色短毛', outfit: '紅色圍巾' })
    expect(copy?.heroAssetHash).toBeUndefined()
    expect(h.outline.get().locations.find((l) => l.name === '巷口 副本')?.description).toBe(
      '下雨的巷口',
    )
    const graph = h.canvas.get()
    expect(graph.nodes.find((n) => n.key === result.added[0]?.key)).toMatchObject({
      x: 140,
      y: 240,
    })
    // 再貼一次：名字不會撞
    const again = h.canvas.paste({ keys: [hero.key] })
    expect(again.added[0]?.title).toBe(`${hero.title} 副本 2`)
  })

  it('場：連同裡面的鏡頭（不帶版本）整場複製到最後；同時選到的鏡頭不會多複製一次', async () => {
    const { h } = await setup()
    const added = h.canvas.add({ kind: 'scene' })
    const sceneId = added.key.replace('scene:', '')
    h.outline.edit({ op: 'updateScene', sceneId, patch: { title: '雨夜', mood: '安靜' } })
    // 把快速開始的三鏡放進這一場
    const shotsBefore = h.shots.list().shots
    h.shots.assignScene(
      shotsBefore.map((s) => s.id),
      sceneId,
    )
    const result = h.canvas.paste({
      keys: [added.key, ...shotsBefore.map((s) => `shot:${s.id}`)],
    })
    expect(result.added.map((a) => a.title)).toEqual(['雨夜 副本'])
    const scenes = h.outline.get().acts.flatMap((a) => a.scenes)
    expect(scenes).toHaveLength(2)
    expect(scenes.at(-1)).toMatchObject({ title: '雨夜 副本', mood: '安靜' })
    const copied = h.shots.list().shots.filter((s) => s.sceneId === scenes.at(-1)?.id)
    expect(copied.map((s) => s.description)).toEqual(shotsBefore.map((s) => s.description))
    expect(copied.every((s) => s.videos.length === 0 && s.firstFrames.length === 0)).toBe(true)
    expect(h.shots.list().shots).toHaveLength(shotsBefore.length * 2)
  })

  it('自由格子（便條）原樣複製；整批貼上一步復原', async () => {
    const { h, history } = await setup()
    const note = h.canvas.add({ kind: 'note', x: 0, y: 0 })
    h.canvas.updateFree({ key: note.key, patch: { text: '更暗一點' } })
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    history.record('貼上', () => h.canvas.paste({ keys: [note.key, `shot:${shot.id}`] }))
    const notes = nodesOf(h, 'note')
    expect(notes).toHaveLength(2)
    expect(notes.map((n) => n.summary)).toEqual(['更暗一點', '更暗一點'])
    expect(h.shots.list().shots).toHaveLength(4)
    history.undo()
    expect(nodesOf(h, 'note')).toHaveLength(1)
    expect(h.shots.list().shots).toHaveLength(3)
  })

  it('剪輯不能複製：說明原因', async () => {
    const { h } = await setup()
    const result = h.canvas.paste({ keys: ['cut'] })
    expect(result.added).toEqual([])
    expect(result.skipped[0]?.reason).toContain('剪輯只有一個')
  })
})

describe('刪掉鏡頭的圖或影片', { timeout: 30_000 }, () => {
  it('清掉採用中的版本（版本還在），鏡頭留著；可以復原', async () => {
    const { h, history } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const graph = () => h.canvas.get().nodes
    const imageKey = `shot:${shot.id}:image`
    const videoKey = `shot:${shot.id}:video`
    const before = graph().find((n) => n.key === imageKey)?.assetHash
    expect(before).toBeDefined()

    history.record('刪除', () => h.canvas.remove({ keys: [imageKey, videoKey] }))
    expect(graph().find((n) => n.key === imageKey)?.assetHash).toBeUndefined()
    expect(graph().find((n) => n.key === videoKey)?.assetHash).toBeUndefined()
    const after = h.shots.list().shots.find((s) => s.id === shot.id)
    expect(after?.firstFrames.length).toBe(shot.firstFrames.length)
    expect(after?.firstFrames.some((f) => f.adopted)).toBe(false)
    expect(h.shots.list().shots).toHaveLength(3)

    history.undo()
    expect(graph().find((n) => n.key === imageKey)?.assetHash).toBe(before)
  })

  it('同時刪鏡頭：鏡頭整個刪掉，不用另外清', async () => {
    const { h } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const result = h.canvas.remove({ keys: [`shot:${shot.id}`, `shot:${shot.id}:image`] })
    expect(result.removed).toBe(1)
    expect(h.shots.list().shots).toHaveLength(2)
  })
})
