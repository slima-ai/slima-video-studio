import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 1×1 的 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
)

function setup(picked: () => string[] = () => []) {
  const harness = createStudioHarness({ pickFiles: () => Promise.resolve(picked()) })
  harnesses.push(harness)
  const history = createHistoryService({ projects: harness.projects, broadcast: () => undefined })
  harness.projects.create(`${harness.root}/a.svsproj`, 'A')
  return { ...harness, history }
}

describe('放上圖片或影片（獨立格子）', () => {
  it('拖進來的圖片：存進專案素材，放成一格獨立的圖片，名字是檔名（不含副檔名）', async () => {
    const { canvas, projects } = setup()
    const result = await canvas.importBytes({
      name: '雨夜的巷子.png',
      mime: 'image/png',
      bytes: new Uint8Array(PNG),
      x: 100,
      y: 200,
    })
    expect(result.skipped).toEqual([])
    const [added] = result.added
    const node = canvas.get().nodes.find((n) => n.key === added?.key)
    expect(node).toMatchObject({ kind: 'free_image', title: '雨夜的巷子', x: 100, y: 200 })
    expect(node?.assetHash).toMatch(/^[0-9a-f]{64}$/)
    const handle = projects.current()
    expect(handle?.assets.has(node?.assetHash ?? '')).toBe(true)
  })

  it('「上傳」選了好幾個檔案：圖片、影片各放一格、往右並排；不支援的格式說明原因跳過', async () => {
    let dir = ''
    const { canvas, root } = setup(() => [
      join(dir, 'a.png'),
      join(dir, 'b.mp4'),
      join(dir, 'notes.txt'),
      join(dir, 'gone.png'),
    ])
    dir = join(root, 'pick')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.png'), PNG)
    writeFileSync(join(dir, 'b.mp4'), Buffer.from('not really a video'))
    writeFileSync(join(dir, 'notes.txt'), 'x')
    const result = await canvas.importFiles({ x: 0, y: 0 })
    expect(result.added.map((a) => a.title)).toEqual(['a', 'b'])
    expect(result.skipped.map((s) => s.name)).toEqual(['notes.txt', 'gone.png'])
    expect(result.skipped[0]?.reason).toContain('不支援')
    const nodes = canvas.get().nodes
    const [a, b] = result.added.map((r) => nodes.find((n) => n.key === r.key))
    expect(a).toMatchObject({ kind: 'free_image', x: 0, y: 0 })
    expect(b).toMatchObject({ kind: 'free_video', x: 240, y: 0 })
  })

  it('放上來的圖片蓋在場上面也不會把場推開', async () => {
    const { canvas } = setup()
    canvas.add({ kind: 'scene' })
    canvas.add({ kind: 'shot' })
    const shotAt = () => {
      const shot = canvas.get().nodes.find((n) => n.kind === 'shot')
      return shot ? { x: shot.x, y: shot.y } : undefined
    }
    const before = shotAt()
    if (!before) throw new Error('沒有鏡頭')
    await canvas.importBytes({
      name: 'a.png',
      mime: 'image/png',
      bytes: new Uint8Array(PNG),
      x: before.x,
      y: before.y,
    })
    expect(shotAt()).toEqual(before)
  })

  it('取消選檔：什麼都不加', async () => {
    const { canvas } = setup(() => [])
    expect(await canvas.importFiles({})).toEqual({ added: [], skipped: [] })
    expect(canvas.get().nodes).toHaveLength(0)
  })

  it('整批放上去算一步，可以復原；刪除也可以復原', async () => {
    const { canvas, history } = setup()
    const finish = history.begin('放上圖片或影片')
    const result = await canvas.importBytes({
      name: 'a.png',
      mime: 'image/png',
      bytes: new Uint8Array(PNG),
    })
    finish()
    const key = result.added[0]?.key ?? ''
    history.record('刪除', () => canvas.remove({ keys: [key] }))
    expect(canvas.get().nodes).toHaveLength(0)
    history.undo()
    expect(canvas.get().nodes.map((n) => n.key)).toEqual([key])
    history.undo()
    expect(canvas.get().nodes).toHaveLength(0)
  })

  it('還沒有專案時放不上去，說明要先開專案', async () => {
    const harness = createStudioHarness()
    harnesses.push(harness)
    await expect(
      harness.canvas.importBytes({ name: 'a.png', mime: 'image/png', bytes: new Uint8Array(PNG) }),
    ).rejects.toThrow('請先開啟或建立一個專案')
  })
})
