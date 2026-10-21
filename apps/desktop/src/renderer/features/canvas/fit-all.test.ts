import { describe, expect, it } from 'vitest'

import { FIT_PADDING } from './canvas-model'
import type { CanvasNode } from './canvas-model'
import {
  ENTRY_ZOOM,
  GROW_MIN_ZOOM,
  READABLE_ZOOM,
  entryNode,
  entryViewport,
  growView,
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

describe('growView：一句話長完之後視角怎麼動', () => {
  // 兩欄的小專案：全部放得進 1440×844，而且縮放不低於 GROW_MIN_ZOOM
  const small = [
    node('node:a', 'oneliner', 0, 0),
    { ...node('scene:1', 'scene', 400, 0), width: 500, height: 400 } as CanvasNode,
    node('shot:1', 'shot', 420, 40),
  ]
  // 整串放得進畫面（縮放 0.5 以上），但要縮到比 GROW_MIN_ZOOM 小才放得下（4 鏡的一句話就是這樣）
  const chain = [
    node('node:a', 'oneliner', 0, 0),
    node('scene:1', 'scene', 400, 0),
    node('shot:1', 'shot', 420, 40),
  ]
  // 很大的專案：舊的 12 個場排成一長串、右邊很遠（全部顯示在可讀縮放裝不下）
  const big = (): CanvasNode[] => [
    node('node:a', 'oneliner', 0, 0),
    ...Array.from({ length: 12 }, (_, i) =>
      node(`scene:old${String(i)}`, 'scene', 400 + i * 1100, 0),
    ),
  ]

  it('放得進畫面，但要縮到卡上的字讀不到才行（4 鏡）：不縮，停在可讀的最小縮放、鏈的開頭對齊左邊', () => {
    const before = new Set(['node:a'])
    const result = growView(before, chain, SCREEN)
    expect(result.kind).toBe('new')
    if (result.kind !== 'new') throw new Error('應該是框新長的')
    // 以前（縮放下限只有 READABLE_ZOOM）這裡會是 { kind: 'all' }、縮到 0.8 以下；
    // 鏈的開頭是一句話卡（長之前就在了）：一起框進來、對齊左邊，不是只框新長的場
    expect(result.ids).toEqual(['node:a', 'scene:1', 'shot:1'])
    expect(result.overflow).toEqual({
      x: FIT_PADDING.left - 0 * GROW_MIN_ZOOM,
      y: FIT_PADDING.top - 0 * GROW_MIN_ZOOM,
      zoom: GROW_MIN_ZOOM,
    })
  })

  it('裝得下：全部顯示', () => {
    const before = new Set(['node:a'])
    expect(growView(before, small, SCREEN)).toEqual({ kind: 'all' })
  })

  it('裝不下：只框這次新長出來的節點（舊的在看不到的地方也沒關係）', () => {
    const old = big()
    const before = new Set(old.map((n) => n.id))
    const grown = [
      { ...node('scene:new', 'scene', 400 + 12 * 1100, 0), width: 700, height: 500 } as CanvasNode,
      node('shot:new', 'shot', 13_700, 40),
    ]
    const result = growView(before, [...old, ...grown], SCREEN)
    expect(result).toEqual({ kind: 'new', ids: ['scene:new', 'shot:new'] })
  })

  it('裝不下、而且新長的自己也裝不下：看得清楚的縮放、從新長的左上角看起', () => {
    const old = big()
    const before = new Set(old.map((n) => n.id))
    const grown = Array.from({ length: 30 }, (_, i) =>
      node(`shot:new${String(i)}`, 'shot', 20_000 + i * 1000, 0),
    )
    const result = growView(before, [...old, ...grown], SCREEN)
    expect(result).toMatchObject({ kind: 'new' })
    if (result.kind !== 'new') throw new Error('應該是框新長的')
    expect(result.ids).toHaveLength(30)
    expect(result.overflow).toEqual({
      x: FIT_PADDING.left - 20_000 * GROW_MIN_ZOOM,
      y: FIT_PADDING.top - 0 * GROW_MIN_ZOOM,
      zoom: GROW_MIN_ZOOM,
    })
  })

  it('什麼都沒長出來（例如一開始就失敗）：視角不動', () => {
    const before = new Set(small.map((n) => n.id))
    expect(growView(before, small, SCREEN)).toEqual({ kind: 'none' })
    expect(growView(new Set(), [], SCREEN)).toEqual({ kind: 'none' })
  })

  it('長之後有舊節點被換掉（整個重長）：新的 id 算新長出來的', () => {
    const before = new Set(['node:a', 'scene:old'])
    const after = [
      node('node:a', 'oneliner', 0, 0),
      { ...node('scene:new', 'scene', 400, 0), width: 500, height: 400 } as CanvasNode,
    ]
    expect(growView(before, after, SCREEN)).toEqual({ kind: 'all' })
  })
})
