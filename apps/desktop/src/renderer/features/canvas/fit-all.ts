import { useReactFlow, useStoreApi, type Rect, type Viewport } from '@xyflow/react'
import { useCallback } from 'react'

import { FIT_OPTIONS, FIT_PADDING, type CanvasEdge, type CanvasNode } from './canvas-model'

/**
 * 全部顯示裝不下時的視角：縮到最小、從左上角（第一場）開始看。
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
 * 「全部顯示」：一般就是 fitView；格子多到縮到最小也裝不下時（例如 250 鏡），
 * fitView 會停在中間某一段，改成從第一場開始看。
 */
export function useFitAll(): (duration?: number) => void {
  const rf = useReactFlow<CanvasNode, CanvasEdge>()
  const store = useStoreApi<CanvasNode, CanvasEdge>()
  return useCallback(
    (duration = 300) => {
      const nodes = rf.getNodes()
      const { width, height, minZoom } = store.getState()
      const overflow =
        nodes.length > 0
          ? overflowViewport(rf.getNodesBounds(nodes), { width, height }, minZoom)
          : undefined
      if (overflow) void rf.setViewport(overflow, { duration })
      else void rf.fitView({ ...FIT_OPTIONS, duration })
    },
    [rf, store],
  )
}
