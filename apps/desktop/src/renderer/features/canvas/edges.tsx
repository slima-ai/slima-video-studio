import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from '@xyflow/react'
import { memo, useState } from 'react'

import { useToast } from '../../components/toast'
import { useCanvasActions } from './canvas-actions'
import type { CanvasEdge } from './canvas-model'
import { FIXED_EDGE_REASON } from './delete-plan'
import { t } from '@svs/schema'

/** 滑過線的中點出現的「×」：點了就剪掉這條線。只在滑過或選取時才畫，平常不佔任何繪製成本。 */
function DeleteDot({
  id,
  x,
  y,
  cuttable,
}: {
  id: string
  x: number
  y: number
  cuttable: boolean
}) {
  const { deleteEdge } = useCanvasActions()
  const toast = useToast()
  if (!deleteEdge) return null
  // 固定的線（鏡頭→圖→影片…）剪不掉：× 照樣顯示但標淡，滑過寫原因，按下去也會說明
  return (
    <EdgeLabelRenderer>
      <button
        type="button"
        // 名字分開：「剪掉這條線」只有真的剪得掉的線才有，固定的線是另一個名字（找按鈕的人才不會碰到停用的）
        aria-label={cuttable ? t('canvas.cutThisLine') : t('canvas.thisLineIsFixedAnd')}
        aria-disabled={cuttable ? undefined : true}
        data-testid={`edge-delete-${id}`}
        data-tip={cuttable ? t('canvas.cutThisLineCanBe') : t(FIXED_EDGE_REASON)}
        className={`svs-edge-cut nodrag nopan pointer-events-auto absolute flex size-6 items-center justify-center rounded-full border-2 bg-surface-raised text-sm font-bold leading-none shadow-card ${
          cuttable
            ? 'border-danger text-danger hover:bg-danger hover:text-surface'
            : 'cursor-not-allowed border-border text-fg-subtle'
        }`}
        style={{ transform: `translate(-50%, -50%) translate(${String(x)}px, ${String(y)}px)` }}
        onClick={() => {
          if (cuttable) deleteEdge(id)
          else toast.show({ message: t(FIXED_EDGE_REASON) })
        }}
      >
        ×
      </button>
    </EdgeLabelRenderer>
  )
}

/**
 * 線的樣式（粗細、虛線、顏色）全部寫在 canvas.css，用 data-state 切換，不用行內 style：
 * 縮小時要換成細的實線，靠 CSS 一次對所有線生效，不必每條線各自重畫。
 */
type EdgeState = 'selected' | 'hot' | 'hover' | 'rest'

const stateOf = (selected: boolean | undefined, hot: boolean, hover: boolean): EdgeState =>
  selected === true ? 'selected' : hot ? 'hot' : hover ? 'hover' : 'rest'

/** 主線：漸層（起點淡、終點深，用來表示方向），選取時主色。 */
function FlowEdgeImpl(props: EdgeProps<CanvasEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } =
    props
  const [hover, setHover] = useState(false)
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const gradient = `svs-grad-${id}`
  return (
    <g
      onMouseEnter={() => {
        setHover(true)
      }}
      onMouseLeave={() => {
        setHover(false)
      }}
    >
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0" style={{ stopColor: 'var(--edge-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--edge-to)' }} />
        </linearGradient>
      </defs>
      <BaseEdge
        path={path}
        interactionWidth={20}
        stroke={`url(#${gradient})`}
        className="svs-edge-flow"
        data-state={stateOf(selected, data?.hot === true, hover)}
        data-flowing={data?.flowing === true}
        data-born={data?.born === true}
        pathLength={data?.born === true ? 1 : undefined}
      />
      {/* 滑到線上、選取這條線、或選取它連著的格子時，線中點出現「×」 */}
      {data?.display !== true && (hover || selected === true || data?.hot === true) ? (
        <DeleteDot id={id} x={midX} y={midY} cuttable={data?.cuttable === true} />
      ) : null}
    </g>
  )
}
export const FlowEdge = memo(FlowEdgeImpl)

/** 參考線：灰色虛線，淡一點，跟主線分開。 */
function RefEdgeImpl(props: EdgeProps<CanvasEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } =
    props
  const [hover, setHover] = useState(false)
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  return (
    <g
      onMouseEnter={() => {
        setHover(true)
      }}
      onMouseLeave={() => {
        setHover(false)
      }}
    >
      <BaseEdge
        path={path}
        interactionWidth={20}
        className="svs-edge-ref"
        data-state={stateOf(selected, data?.hot === true, hover)}
      />
      {/* 滑到線上、選取這條線、或選取它連著的格子時，線中點出現「×」 */}
      {data?.display !== true && (hover || selected === true || data?.hot === true) ? (
        <DeleteDot id={id} x={midX} y={midY} cuttable={data?.cuttable === true} />
      ) : null}
    </g>
  )
}
export const RefEdge = memo(RefEdgeImpl)

export const EDGE_TYPES = { flow: FlowEdge, ref: RefEdge }

/** 拉線中的預覽線：跟完成的線同樣粗，用主色。 */
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  })
  return (
    <g>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={toX} cy={toY} r={4} fill="var(--accent)" />
    </g>
  )
}
