import { useReactFlow, useStoreApi, type Rect, type Viewport } from '@xyflow/react'
import { useCallback } from 'react'

import { FIT_OPTIONS, FIT_PADDING, sizeOf, type CanvasEdge, type CanvasNode } from './canvas-model'

/** 縮到這個以下卡片只剩標題與色塊、按鈕都不見（見 Lod）；「全部顯示」至少停在這裡。 */
export const READABLE_ZOOM = 0.5
/** 「放大到看得清楚」與開專案時定位到入口用的縮放：卡片上的字和按鈕都讀得出來。 */
export const ENTRY_ZOOM = 0.8

/** 第一個入口：一句話卡；沒有就是最上面最左邊的場；再沒有就是最前面的節點。 */
export function entryNode(nodes: readonly CanvasNode[]): CanvasNode | undefined {
  const first = (list: readonly CanvasNode[]): CanvasNode | undefined =>
    [...list].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0]
  return (
    first(nodes.filter((n) => n.data.kind === 'oneliner')) ??
    first(nodes.filter((n) => n.data.kind === 'scene')) ??
    first(nodes)
  )
}

/** 把入口節點的左上角放在節點面板與上方列的右下，用看得清楚的縮放。 */
export function entryViewport(node: CanvasNode, zoom = ENTRY_ZOOM): Viewport {
  return {
    x: FIT_PADDING.left - node.position.x * zoom,
    y: FIT_PADDING.top - node.position.y * zoom,
    zoom,
  }
}

/** 全部節點的外框（用我們自己知道的尺寸，不用等畫面量好）。 */
export function boundsOf(nodes: readonly CanvasNode[]): Rect {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const node of nodes) {
    const { w, h } = sizeOf(node)
    x1 = Math.min(x1, node.position.x)
    y1 = Math.min(y1, node.position.y)
    x2 = Math.max(x2, node.position.x + w)
    y2 = Math.max(y2, node.position.y + h)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/**
 * 開專案時的視角：全部放得進畫面（而且看得清楚）就全部顯示，否則定位到第一個入口，
 * 不要為了塞進畫面縮到只剩色塊。
 */
export function openViewport(
  nodes: readonly CanvasNode[],
  size: { width: number; height: number },
): Viewport | 'fit' | undefined {
  const entry = entryNode(nodes)
  if (!entry) return undefined
  return overflowViewport(boundsOf(nodes), size, READABLE_ZOOM) ? entryViewport(entry) : 'fit'
}

/**
 * 全部顯示裝不下時的視角：縮到最小（看得清楚的程度）、從左上角（第一場）開始看。
 * 裝得下就回傳 undefined，照一般的 fitView。
 */
export function overflowViewport(
  bounds: Rect,
  size: { width: number; height: number },
  minZoom: number,
): Viewport | undefined {
  const zoomX = (size.width - FIT_PADDING.left - FIT_PADDING.right) / Math.max(1, bounds.width)
  const zoomY = (size.height - FIT_PADDING.top - FIT_PADDING.bottom) / Math.max(1, bounds.height)
  if (Math.min(zoomX, zoomY) >= minZoom) return undefined
  return {
    x: FIT_PADDING.left - bounds.x * minZoom,
    y: FIT_PADDING.top - bounds.y * minZoom,
    zoom: minZoom,
  }
}

/**
 * 「全部顯示」：一般就是 fitView；裝不下（縮到看得清楚的程度也放不進畫面，例如 27 鏡、250 鏡）時，
 * 停在那個縮放、從第一場開始看，其他的往下、往右捲動或拖曳。
 */
export function useFitAll(): (duration?: number) => void {
  const rf = useReactFlow<CanvasNode, CanvasEdge>()
  const store = useStoreApi<CanvasNode, CanvasEdge>()
  return useCallback(
    (duration = 300) => {
      const nodes = rf.getNodes()
      const { width, height, minZoom } = store.getState()
      // 縮到只剩色塊就沒意思：最多縮到卡片按鈕還看得到的程度，裝不下的讓人捲動或拖曳
      const overflow =
        nodes.length > 0
          ? overflowViewport(
              rf.getNodesBounds(nodes),
              { width, height },
              Math.max(minZoom, READABLE_ZOOM),
            )
          : undefined
      if (overflow) void rf.setViewport(overflow, { duration })
      else void rf.fitView({ ...FIT_OPTIONS, duration })
    },
    [rf, store],
  )
}

/** 縮到看不清楚時用的「放大到看得清楚」：回到第一個入口，用 ENTRY_ZOOM 看。 */
export function useFocusEntry(): () => void {
  const rf = useReactFlow<CanvasNode, CanvasEdge>()
  return useCallback(() => {
    const entry = entryNode(rf.getNodes())
    if (entry) void rf.setViewport(entryViewport(entry), { duration: 300 })
  }, [rf])
}
