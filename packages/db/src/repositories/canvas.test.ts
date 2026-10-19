import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'
import { StructureHistory } from '../history'

const HASH = (c: string): string => c.repeat(64)

describe('CanvasRepository', () => {
  it('位置：沒移動過就沒有；移動會新增或更新；回到自動排版就刪掉', () => {
    const { repos } = newProject()
    expect(repos.canvas.positions().size).toBe(0)
    repos.canvas.move([
      { key: 'shot:a', x: 10, y: 20 },
      { key: 'cut', x: 5, y: 6 },
    ])
    repos.canvas.move([{ key: 'shot:a', x: 30, y: 40 }])
    expect([...repos.canvas.positions()]).toEqual([
      ['shot:a', { x: 30, y: 40 }],
      ['cut', { x: 5, y: 6 }],
    ])
    repos.canvas.resetPositions(['shot:a'])
    expect([...repos.canvas.positions().keys()]).toEqual(['cut'])
  })

  it('視角另外存，不會混進節點位置', () => {
    const { repos } = newProject()
    expect(repos.canvas.viewport()).toBeUndefined()
    repos.canvas.setViewport({ x: -120, y: 40, zoom: 0.75 })
    repos.canvas.setViewport({ x: -100, y: 40, zoom: 0.5 })
    expect(repos.canvas.viewport()).toEqual({ x: -100, y: 40, zoom: 0.5 })
    expect(repos.canvas.positions().size).toBe(0)
  })

  it('自由節點與連線可以存、可以讀', () => {
    const { repos } = newProject()
    const note = repos.canvas.addNode({ type: 'note', params: { text: '想法' }, x: 1, y: 2 })
    const one = repos.canvas.addNode({ type: 'oneliner', params: { text: '一隻貓' }, x: 3, y: 4 })
    repos.canvas.addEdge({
      sourceKey: `node:${one.id}`,
      sourcePort: 'story-out',
      targetKey: `node:${note.id}`,
      targetPort: 'in',
      kind: 'data',
    })
    expect(repos.canvas.listNodes().map((n) => n.type)).toEqual(['note', 'oneliner'])
    expect(repos.canvas.listEdges()).toHaveLength(1)
  })
})

describe('StructureHistory：畫布', () => {
  it('移動節點可以復原與重做；視角不算編輯，不進歷史', () => {
    const handle = newProject()
    const { repos } = handle
    const history = new StructureHistory(handle.db, handle.projectId)

    history.record('移動位置', () => {
      repos.canvas.move([{ key: 'shot:a', x: 10, y: 20 }])
    })
    history.record('移動位置', () => {
      repos.canvas.move([{ key: 'shot:a', x: 99, y: 88 }])
    })
    history.record('記視角', () => {
      repos.canvas.setViewport({ x: 1, y: 2, zoom: 1 })
    })
    expect(history.state().undoLabel).toBe('移動位置')

    history.undo()
    expect(repos.canvas.positions().get('shot:a')).toEqual({ x: 10, y: 20 })
    history.undo()
    expect(repos.canvas.positions().size).toBe(0)
    history.redo()
    history.redo()
    expect(repos.canvas.positions().get('shot:a')).toEqual({ x: 99, y: 88 })
    // 視角沒有被動到
    expect(repos.canvas.viewport()).toEqual({ x: 1, y: 2, zoom: 1 })
  })

  it('放進成品的開關與刪掉鏡頭（連同版本）都能復原；版本依擁有者讀取', () => {
    const handle = newProject()
    const { repos } = handle
    const history = new StructureHistory(handle.db, handle.projectId)
    const shot = repos.shots.create({ description: 'A' })
    const take = repos.shots.addTake({
      shotId: shot.id,
      kind: 'video',
      assetHash: HASH('a'),
      modelId: 'm',
    })
    expect(repos.shots.get(shot.id)?.inCut).toBe(true)

    history.record('不放進成品', () => repos.shots.update(shot.id, { inCut: false }))
    expect(repos.shots.get(shot.id)?.inCut).toBe(false)
    history.undo()
    expect(repos.shots.get(shot.id)?.inCut).toBe(true)

    history.record('刪除鏡頭', () => {
      repos.shots.delete(shot.id)
    })
    expect(repos.shots.listTakes(shot.id)).toHaveLength(0)
    history.undo()
    expect(repos.shots.listTakes(shot.id).map((t) => t.id)).toEqual([take.id])
  })

  it('自由連線：新增後可以復原與重做', () => {
    const handle = newProject()
    const { repos } = handle
    const history = new StructureHistory(handle.db, handle.projectId)
    const node = repos.canvas.addNode({ type: 'free_image', params: {}, x: 0, y: 0 })
    history.record('新增連線', () => {
      repos.canvas.addEdge({
        sourceKey: `node:${node.id}`,
        sourcePort: 'free-img-out',
        targetKey: 'shot:x',
        targetPort: 'img-first',
        kind: 'data',
      })
    })
    expect(repos.canvas.listEdges()).toHaveLength(1)
    history.undo()
    expect(repos.canvas.listEdges()).toHaveLength(0)
    history.redo()
    expect(repos.canvas.listEdges()).toHaveLength(1)
  })

  it('改自由節點的設定只覆蓋有給的欄位；刪節點連同它的連線與位置', () => {
    const { repos } = newProject()
    const one = repos.canvas.addNode({
      type: 'oneliner',
      params: { story: '一隻貓', shotCount: 4 },
      x: 0,
      y: 0,
    })
    expect(repos.canvas.updateNodeParams(one.id, { shotCount: 6 })).toBe(true)
    expect(repos.canvas.updateNodeParams('nope', { shotCount: 1 })).toBe(false)
    expect(repos.canvas.listNodes()[0]?.params).toEqual({ story: '一隻貓', shotCount: 6 })

    repos.canvas.move([{ key: `node:${one.id}`, x: 9, y: 9 }])
    repos.canvas.addEdge({
      sourceKey: `node:${one.id}`,
      sourcePort: 'story-out',
      targetKey: 'scene:a',
      targetPort: 'scene-story',
      kind: 'data',
    })
    repos.canvas.addEdge({
      sourceKey: 'scene:x',
      sourcePort: 'scene-out',
      targetKey: 'cut',
      targetPort: 'cut-slot-1',
      kind: 'data',
    })
    repos.canvas.removeNode(one.id)
    expect(repos.canvas.listNodes()).toHaveLength(0)
    expect(repos.canvas.positions().size).toBe(0)
    expect(repos.canvas.listEdges().map((e) => e.sourceKey)).toEqual(['scene:x'])
  })

  it('removeEdgesFrom 只刪從那個節點出發的線', () => {
    const { repos } = newProject()
    const link = (sourceKey: string) =>
      repos.canvas.addEdge({
        sourceKey,
        sourcePort: 'story-out',
        targetKey: 'scene:a',
        targetPort: 'scene-story',
        kind: 'data',
      })
    link('node:one')
    link('node:two')
    repos.canvas.removeEdgesFrom('node:one')
    expect(repos.canvas.listEdges().map((e) => e.sourceKey)).toEqual(['node:two'])
  })
})
