import { describe, expect, it } from 'vitest'

import { FIT_PADDING } from './canvas-model'
import type { CanvasNode } from './canvas-model'
import {
  ENTRY_ZOOM,
  READABLE_ZOOM,
  entryNode,
  entryViewport,
  openViewport,
  overflowViewport,
} from './fit-all'

const SCREEN = { width: 1440, height: 844 }

describe('overflowViewport', () => {
  it('縮到最小裝得下：照一般的全部顯示（undefined）', () => {
    expect(overflowViewport({ x: 0, y: 0, width: 3000, height: 2000 }, SCREEN, 0.1)).toBeUndefined()
  })

  it('裝不下（例如 250 鏡）：縮到最小、內容的左上角對齊上方列與節點面板的右下', () => {
    const view = overflowViewport({ x: 60, y: 90, width: 9000, height: 27_000 }, SCREEN, 0.1)
    expect(view).toEqual({ x: FIT_PADDING.left - 6, y: FIT_PADDING.top - 9, zoom: 0.1 })
  })

  it('只有寬度裝不下也算裝不下', () => {
    expect(overflowViewport({ x: 0, y: 0, width: 20_000, height: 100 }, SCREEN, 0.1)?.zoom).toBe(
      0.1,
    )
  })
})

const node = (id: string, kind: string, x: number, y: number): CanvasNode =>
  ({
    id,
    type: kind,
    position: { x, y },
    ...(kind === 'scene' ? { width: 1000, height: 800 } : {}),
    data: { kind, title: id },
  }) as unknown as CanvasNode

describe('開專案時的視角', () => {
  it('入口：有一句話卡就是它；沒有就是最上面最左邊的場', () => {
    const nodes = [
      node('s2', 'scene', 0, 900),
      node('s1', 'scene', 40, 0),
      node('c', 'character', 0, 0),
    ]
    expect(entryNode(nodes)?.id).toBe('s1')
    expect(entryNode([...nodes, node('o', 'oneliner', 500, 500)])?.id).toBe('o')
    expect(entryNode([])).toBeUndefined()
  })

  it('入口的左上角放在節點面板與上方列的右下，用看得清楚的縮放', () => {
    const view = entryViewport(node('s1', 'scene', 100, 200))
    expect(view).toEqual({
      x: FIT_PADDING.left - 100 * ENTRY_ZOOM,
      y: FIT_PADDING.top - 200 * ENTRY_ZOOM,
      zoom: ENTRY_ZOOM,
    })
    expect(ENTRY_ZOOM).toBeGreaterThan(READABLE_ZOOM)
  })

  it('全部放得進畫面（縮放不低於看得清楚的程度）：全部顯示', () => {
    expect(openViewport([node('s1', 'scene', 0, 0)], SCREEN)).toBe('fit')
  })

  it('放不進去（27 鏡的大專案）：定位到第一個入口，不縮成色塊', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`s${String(i)}`, 'scene', 0, i * 900))
    const view = openViewport(nodes, SCREEN)
    expect(view).not.toBe('fit')
    expect(view).toMatchObject({ zoom: ENTRY_ZOOM })
  })
})
