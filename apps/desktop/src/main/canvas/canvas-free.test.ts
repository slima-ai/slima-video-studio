import { afterEach, describe, expect, it } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

function setup() {
  const harness = createStudioHarness()
  harnesses.push(harness)
  const history = createHistoryService({ projects: harness.projects, broadcast: () => undefined })
  harness.projects.create(`${harness.root}/a.svsproj`, 'A')
  return { ...harness, history }
}

describe('便條與自訂群組（自由節點）', () => {
  it('新增便條：空白的黃色小卡；改字之後投影跟著變', () => {
    const { canvas } = setup()
    const added = canvas.add({ kind: 'note', x: 40, y: 80 })
    expect(added.key).toMatch(/^node:/)
    expect(added.title).toBe('便條')
    expect(canvas.get().nodes.find((n) => n.key === added.key)).toMatchObject({
      kind: 'note',
      x: 40,
      y: 80,
      title: '便條',
    })
    canvas.updateFree({ key: added.key, patch: { text: '第 3 鏡要更暗' } })
    expect(canvas.get().nodes.find((n) => n.key === added.key)?.summary).toBe('第 3 鏡要更暗')
  })

  it('新增群組：有給大小就用（框住選取的格子），名字、顏色可以改；預設灰色', () => {
    const { canvas } = setup()
    const added = canvas.add({ kind: 'group', x: 10, y: 20, width: 700, height: 400 })
    expect(canvas.get().nodes.find((n) => n.key === added.key)).toMatchObject({
      kind: 'group',
      x: 10,
      y: 20,
      width: 700,
      height: 400,
      title: '群組',
      color: 'slate',
    })
    canvas.updateFree({ key: added.key, patch: { title: '開場', color: 'rose' } })
    expect(canvas.get().nodes.find((n) => n.key === added.key)).toMatchObject({
      title: '開場',
      color: 'rose',
    })
    // 沒給大小：預設 480×300
    const empty = canvas.add({ kind: 'group' })
    expect(canvas.get().nodes.find((n) => n.key === empty.key)).toMatchObject({
      width: 480,
      height: 300,
    })
  })

  it('改錯種類：便條不能改名、群組沒有文字、一句話不能用這個改名；找不到的說清楚', () => {
    const { canvas } = setup()
    const note = canvas.add({ kind: 'note' })
    const group = canvas.add({ kind: 'group' })
    const oneliner = canvas.add({ kind: 'oneliner' })
    expect(() => {
      canvas.updateFree({ key: note.key, patch: { title: 'x' } })
    }).toThrow('便條只能改裡面的字')
    expect(() => {
      canvas.updateFree({ key: group.key, patch: { text: 'x' } })
    }).toThrow('群組沒有文字')
    expect(() => {
      canvas.updateFree({ key: oneliner.key, patch: { title: 'x' } })
    }).toThrow('群組才能改名')
    expect(() => {
      canvas.updateFree({ key: 'node:nope', patch: { text: 'x' } })
    }).toThrow('找不到這一格')
  })

  it('新增、改字、換色、刪除都能復原', () => {
    const { canvas, history } = setup()
    const added = history.record('新增群組', () => canvas.add({ kind: 'group' }))
    history.record('換群組顏色', () => {
      canvas.updateFree({ key: added.key, patch: { color: 'blue' } })
    })
    history.record('刪除', () => canvas.remove({ keys: [added.key] }))
    expect(canvas.get().nodes.some((n) => n.key === added.key)).toBe(false)
    history.undo()
    expect(canvas.get().nodes.find((n) => n.key === added.key)?.color).toBe('blue')
    history.undo()
    expect(canvas.get().nodes.find((n) => n.key === added.key)?.color).toBe('slate')
    history.undo()
    expect(canvas.get().nodes.some((n) => n.key === added.key)).toBe(false)
  })

  it('群組蓋在場上面也不會把場推開（便條會，因為它佔位置）', () => {
    const { canvas } = setup()
    canvas.add({ kind: 'scene' })
    canvas.add({ kind: 'shot' })
    const shotAt = () => {
      const shot = canvas.get().nodes.find((n) => n.kind === 'shot')
      return shot ? { x: shot.x, y: shot.y } : undefined
    }
    const before = shotAt()
    if (!before) throw new Error('沒有鏡頭')
    canvas.add({ kind: 'group', x: before.x - 40, y: before.y - 80, width: 400, height: 300 })
    expect(shotAt()).toEqual(before)
    canvas.add({ kind: 'note', x: before.x, y: before.y })
    expect(shotAt()?.y).toBeGreaterThan(before.y)
  })

  it('便條、群組不能接線', () => {
    const { canvas } = setup()
    expect(() =>
      canvas.add({ kind: 'note', from: { key: 'character:x', port: 'char-out', side: 'out' } }),
    ).toThrow()
  })
})
