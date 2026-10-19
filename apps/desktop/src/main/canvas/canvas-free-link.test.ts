import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 兩張不一樣的 1×1 PNG（內容不同，雜湊就不同）。 */
const PNG = (n: number) => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  )
  return new Uint8Array([...bytes, n])
}

/** 跑完一次 3 鏡的快速開始，再放兩張獨立圖片。 */
async function setup() {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.runQuickStart()
  const history = createHistoryService({ projects: h.projects, broadcast: () => undefined })
  const put = async (n: number) => {
    const result = await h.canvas.importBytes({
      name: `圖${String(n)}.png`,
      mime: 'image/png',
      bytes: PNG(n),
    })
    const key = result.added[0]?.key ?? ''
    const node = h.canvas.get().nodes.find((x) => x.key === key)
    return { key, hash: node?.assetHash ?? '' }
  }
  return { h, history, a: await put(1), b: await put(2) }
}

const frameOf = (h: ReturnType<typeof createStudioHarness>, shotId: string) =>
  h.shots
    .list()
    .shots.find((s) => s.id === shotId)
    ?.firstFrames.find((f) => f.adopted)

describe('獨立圖片接到鏡頭的「第一張畫面」', { timeout: 30_000 }, () => {
  it('接上：這一鏡改用這張圖；影片標「需要重跑」，補跑只重生影片、不生圖，用的是這張圖', async () => {
    const { h, a } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const framesBefore = shot.firstFrames.length
    h.canvas.link({
      source: { key: a.key, port: 'free-img-out' },
      target: { key: `shot:${shot.id}:image`, port: 'img-first' },
    })
    expect(frameOf(h, shot.id)?.assetHash).toBe(a.hash)
    // 畫布上看得到這條線，圖格子底部寫「接上來的圖」
    const graph = h.canvas.get()
    expect(graph.edges.some((e) => e.source === a.key && e.targetPort === 'img-first')).toBe(true)
    expect(graph.nodes.find((n) => n.key === `shot:${shot.id}:image`)?.modelName).toBe('接上來的圖')
    expect(h.shots.staleness().get(shot.id)).toEqual({ image: false, video: true })

    await h.canvas.run({ keys: [`shot:${shot.id}:video`] })
    await vi.waitFor(
      () => {
        expect(h.shots.live().get(shot.id)?.error).toBeUndefined()
        expect(h.shots.list().shots.find((s) => s.id === shot.id)?.activity).toBeUndefined()
        expect(h.shots.staleness().get(shot.id) ?? { image: false, video: false }).toEqual({
          image: false,
          video: false,
        })
      },
      { timeout: 30_000, interval: 20 },
    )
    // 沒有生新的圖：第一張畫面還是接上來的那張
    const after = h.shots.list().shots.find((s) => s.id === shot.id)
    expect(after?.firstFrames).toHaveLength(framesBefore + 1)
    expect(frameOf(h, shot.id)?.assetHash).toBe(a.hash)
  })

  it('換接另一張：原本的線拿掉，影片又要重跑；剪掉線回到原本生成的圖', async () => {
    const { h, a, b } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const original = frameOf(h, shot.id)?.assetHash
    const target = { key: `shot:${shot.id}:image`, port: 'img-first' }
    h.canvas.link({ source: { key: a.key, port: 'free-img-out' }, target })
    h.canvas.link({ source: { key: b.key, port: 'free-img-out' }, target })
    expect(frameOf(h, shot.id)?.assetHash).toBe(b.hash)
    const into = h.canvas.get().edges.filter((e) => e.targetPort === 'img-first')
    expect(into.map((e) => e.source)).toEqual([b.key])

    h.canvas.unlink({ source: { key: b.key, port: 'free-img-out' }, target })
    expect(frameOf(h, shot.id)?.assetHash).toBe(original)
    expect(h.shots.staleness().get(shot.id) ?? { image: false, video: false }).toEqual({
      image: false,
      video: false,
    })
  })

  it('接上、剪掉都能復原；刪掉這張圖時鏡頭回到原本的第一張畫面', async () => {
    const { h, history, a } = await setup()
    const shot = h.shots.list().shots[1]
    if (!shot) throw new Error('沒有鏡頭')
    const original = frameOf(h, shot.id)?.assetHash
    const link = {
      source: { key: a.key, port: 'free-img-out' },
      target: { key: `shot:${shot.id}:image`, port: 'img-first' },
    }
    history.record('接上線', () => {
      h.canvas.link(link)
    })
    history.undo()
    expect(frameOf(h, shot.id)?.assetHash).toBe(original)
    history.redo()
    expect(frameOf(h, shot.id)?.assetHash).toBe(a.hash)

    history.record('刪除', () => h.canvas.remove({ keys: [a.key] }))
    expect(frameOf(h, shot.id)?.assetHash).toBe(original)
    history.undo()
    expect(frameOf(h, shot.id)?.assetHash).toBe(a.hash)
  })
})

describe('獨立圖片接到角色、地點的「參考圖」', { timeout: 30_000 }, () => {
  it('角色：加成一張概念圖；剪掉線就拿掉（已挑成主圖的留著）', async () => {
    const { h, a, b } = await setup()
    const hero = h.canvas.add({ kind: 'character' })
    const characterId = hero.key.replace('character:', '')
    const concepts = () => h.concepts.state(characterId).concepts.map((c) => c.assetHash)
    h.canvas.link({
      source: { key: a.key, port: 'free-img-out' },
      target: { key: hero.key, port: 'char-ref' },
    })
    h.canvas.link({
      source: { key: b.key, port: 'free-img-out' },
      target: { key: hero.key, port: 'char-ref' },
    })
    expect(concepts()).toEqual(expect.arrayContaining([a.hash, b.hash]))
    expect(() => {
      h.canvas.link({
        source: { key: a.key, port: 'free-img-out' },
        target: { key: hero.key, port: 'char-ref' },
      })
    }).toThrow('已經接在這裡了')

    // 把 b 挑成主圖之後剪掉線：b 留著；a 沒挑，剪掉就拿掉
    const picked = h.concepts.state(characterId).concepts.find((c) => c.assetHash === b.hash)
    if (!picked) throw new Error('沒有概念圖')
    h.characters.pickHero(characterId, picked.id)
    h.canvas.unlink({
      source: { key: a.key, port: 'free-img-out' },
      target: { key: hero.key, port: 'char-ref' },
    })
    h.canvas.unlink({
      source: { key: b.key, port: 'free-img-out' },
      target: { key: hero.key, port: 'char-ref' },
    })
    expect(concepts()).toEqual([b.hash])
  })

  it('地點：加成一張概念圖，剪掉線就拿掉', async () => {
    const { h, a } = await setup()
    const place = h.canvas.add({ kind: 'location' })
    const locationId = place.key.replace('location:', '')
    const link = {
      source: { key: a.key, port: 'free-img-out' },
      target: { key: place.key, port: 'loc-ref' },
    }
    h.canvas.link(link)
    expect(h.locations.images(locationId).concepts.map((c) => c.assetHash)).toEqual([a.hash])
    h.canvas.unlink(link)
    expect(h.locations.images(locationId).concepts).toEqual([])
  })

  it('接到不對的地方、或從影片拉出來：說明可以接到哪裡', async () => {
    const { h, a } = await setup()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    expect(() => {
      h.canvas.link({
        source: { key: a.key, port: 'free-img-out' },
        target: { key: `shot:${shot.id}:video`, port: 'vid-in' },
      })
    }).toThrow('第一張畫面')
  })

  it('從圖片的「＋」新增角色：新增之後這張圖直接接成它的參考圖', async () => {
    const { h, a } = await setup()
    const hero = h.canvas.add({
      kind: 'character',
      x: 0,
      y: 0,
      from: { key: a.key, port: 'free-img-out', side: 'out' },
    })
    const characterId = hero.key.replace('character:', '')
    expect(h.concepts.state(characterId).concepts.map((c) => c.assetHash)).toEqual([a.hash])
    expect(h.canvas.get().edges.some((e) => e.source === a.key && e.target === hero.key)).toBe(true)
  })
})

describe('從「第一張畫面」的「＋」選檔', { timeout: 30_000 }, () => {
  it('選好的圖放上畫布，也直接接成這一鏡的第一張畫面', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svs-pick-'))
    const file = join(dir, '雨夜.png')
    writeFileSync(file, PNG(7))
    const h = createStudioHarness({ pickFiles: () => Promise.resolve([file]) })
    harnesses.push(h)
    await h.runQuickStart()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const result = await h.canvas.importFiles({
      x: 0,
      y: 0,
      connectTo: { key: `shot:${shot.id}:image`, port: 'img-first' },
    })
    expect(result.connected).toBe(true)
    const node = h.canvas.get().nodes.find((n) => n.key === result.added[0]?.key)
    expect(frameOf(h, shot.id)?.assetHash).toBe(node?.assetHash)
  })

  it('選到影片：放在畫布上，說明影片還不能接到這裡', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svs-pick-'))
    const file = join(dir, '貓.mp4')
    writeFileSync(file, Buffer.from('fake video'))
    const h = createStudioHarness({ pickFiles: () => Promise.resolve([file]) })
    harnesses.push(h)
    await h.runQuickStart()
    const shot = h.shots.list().shots[0]
    if (!shot) throw new Error('沒有鏡頭')
    const original = frameOf(h, shot.id)?.assetHash
    const result = await h.canvas.importFiles({
      connectTo: { key: `shot:${shot.id}:image`, port: 'img-first' },
    })
    expect(result.added).toHaveLength(1)
    expect(result.connected).toBeUndefined()
    expect(result.notice).toContain('影片還不能接到這裡')
    expect(frameOf(h, shot.id)?.assetHash).toBe(original)
  })
})
