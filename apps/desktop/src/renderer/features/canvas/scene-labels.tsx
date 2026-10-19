import { ViewportPortal } from '@xyflow/react'

import type { CanvasNode } from './canvas-model'

/**
 * 縮到最小（只畫色塊）時，「第 N 場」蓋在場框正中間。
 * 放在場框上方的話，字會比場和場之間的空隙大，被上一場的鏡頭擋住；
 * 畫在 ViewportPortal（所有格子上面），跟著平移縮放，不吃滑鼠事件。
 */
export function SceneLabels({ nodes }: { nodes: readonly CanvasNode[] }) {
  return (
    <ViewportPortal>
      {nodes
        .filter((n) => n.type === 'frame')
        .map((n) => (
          <div
            key={n.id}
            aria-hidden
            data-testid={`scene-label-${n.id}`}
            className="svs-scene-label"
            style={{
              transform: `translate(${String(n.position.x + (n.width ?? 0) / 2)}px, ${String(
                n.position.y + (n.height ?? 0) / 2,
              )}px) translate(-50%, -50%)`,
            }}
          >
            第 {n.data.sceneNo ?? ''} 場
          </div>
        ))}
    </ViewportPortal>
  )
}
