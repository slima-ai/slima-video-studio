import { ViewportPortal } from '@xyflow/react'

import type { CanvasNode } from './canvas-model'
import type { Guide } from './geometry'

/** 畫在所有節點上面（場框本身在最底層，會被蓋住）。 */
const OVERLAY_Z = 2000

/** 拖動中的對齊輔助線，與拖進別的場框時釘在目標框右上角的提示。 */
export function DragOverlay({
  guides,
  dropTarget,
}: {
  guides: readonly Guide[]
  dropTarget: CanvasNode | undefined
}) {
  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: OVERLAY_Z,
        }}
        width={1}
        height={1}
      >
        {guides.map((guide) => (
          <line
            key={`${guide.axis}${String(guide.at)}`}
            className="svs-guide"
            data-testid="guide"
            x1={guide.axis === 'x' ? guide.at : guide.from}
            x2={guide.axis === 'x' ? guide.at : guide.to}
            y1={guide.axis === 'x' ? guide.from : guide.at}
            y2={guide.axis === 'x' ? guide.to : guide.at}
          />
        ))}
      </svg>
      {dropTarget ? (
        <p
          data-testid="drop-hint"
          className="pointer-events-none absolute flex items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2 text-base font-semibold text-accent-fg shadow-panel"
          style={{
            left: dropTarget.position.x + (dropTarget.width ?? 0) / 2,
            top: dropTarget.position.y - 12,
            transform: 'translate(-50%, -100%)',
            zIndex: OVERLAY_Z,
          }}
        >
          <span aria-hidden>⤓</span>
          {dropTarget.data.hint}
        </p>
      ) : null}
    </ViewportPortal>
  )
}
