import { useReactFlow, useStore } from '@xyflow/react'
import { useState, type DragEvent } from 'react'

import { Spinner } from '../../components/skeleton'
import { cn } from '../../lib/cn'
import { applyTheme, useResolvedTheme } from '../../lib/theme'
import { READABLE_ZOOM, useFitAll, useFocusEntry } from './fit-all'
import { KindBadge } from './kind-icon'
import { anchorOf, type ConfirmAnchor } from './run-confirm'
import { ADD_ITEMS } from './menus'

export const DRAG_MIME = 'application/x-svs-node'

/** 左側節點面板：預設展開，可以收起；點擊新增，或拖到畫布上。 */
export function NodePalette({
  onAdd,
  kinds,
}: {
  onAdd: (kind: string) => void
  /** 這個畫布能新增的種類；沒給就是全部。 */
  kinds?: readonly string[]
}) {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button
        type="button"
        data-testid="palette-open"
        className="absolute left-3 top-[68px] z-20 rounded-xl border border-border bg-surface-raised px-3 py-1.5 text-[13px] shadow-card"
        onClick={() => {
          setOpen(true)
        }}
      >
        ＋ 新增
      </button>
    )
  }
  return (
    <aside
      data-testid="node-palette"
      aria-label="新增面板"
      className="absolute left-3 top-[68px] z-20 flex w-56 flex-col gap-1 rounded-2xl border border-border bg-surface-raised p-3 shadow-panel animate-scale-in"
    >
      <h2 className="px-1 pb-1 text-xs font-semibold text-fg-muted">新增{'\u3000'}（Tab）</h2>
      {ADD_ITEMS.filter((item) => kinds === undefined || kinds.includes(item.kind)).map((item) => (
        <button
          key={item.kind}
          type="button"
          draggable
          data-testid={`palette-${item.kind}`}
          onDragStart={(event: DragEvent) => {
            event.dataTransfer.setData(DRAG_MIME, item.kind)
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => {
            onAdd(item.kind)
          }}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/10"
        >
          <KindBadge kind={item.kind} />
          <span className="flex flex-col">
            <b className="text-[13px] font-medium">{item.label}</b>
            <small className="text-[11px] leading-tight text-fg-muted">{item.desc}</small>
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label="收起新增面板"
        data-testid="palette-close"
        className="absolute -right-3.5 top-1/2 flex h-10 w-[22px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-raised text-xs text-fg-muted"
        onClick={() => {
          setOpen(false)
        }}
      >
        ‹
      </button>
    </aside>
  )
}

export interface TopBarProps {
  /** 復原／重做的筆數（雛形用）；沒給就只看 canUndo／canRedo。 */
  undoCount?: number
  redoCount?: number
  canUndo?: boolean
  canRedo?: boolean
  undoLabel?: string
  redoLabel?: string
  onUndo: () => void
  onRedo: () => void
  /** 沒給就不顯示該按鈕（對應功能還沒接上）。 */
  onTidy?: () => void
  /** 「全部展開步驟／全部收合」；沒有鏡頭時不給。 */
  steps?: { allExpanded: boolean; onToggle: () => void }
  onRunAll?: (anchor: ConfirmAnchor) => void
  /** 還沒生成的部分預估多少錢；沒給是現在算不出來。 */
  pendingCostUsd?: number | undefined
  /** 所有鏡頭都生成好了，沒有要補跑的。 */
  allDone?: boolean
  /** 素材都生成好了，只剩把成品接起來（或重新接）。 */
  joinOnly?: boolean
  /** 正在生成：做完幾步／共幾步（一句話生成時沒有步數）；有值時「全部生成」換成進度與停止。 */
  running?: { done: number; total: number } | 'grow' | undefined
  onStop?: () => void
  /** 「？」：怎麼開始、鍵盤快捷鍵、效能自測。 */
  onHelp?: (anchor: ConfirmAnchor) => void
}

/** 上方列：專案名、復原／重做、整理、全部生成（約 US$x）、本次花費、主題切換。 */
export function TopBar(props: TopBarProps) {
  const theme = useResolvedTheme()
  const button =
    'rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-[13px] disabled:opacity-40'
  const canUndo = props.canUndo ?? (props.undoCount ?? 0) > 0
  const canRedo = props.canRedo ?? (props.redoCount ?? 0) > 0
  const pending = props.pendingCostUsd
  const allDone = props.allDone ?? false
  return (
    <header
      data-testid="canvas-topbar"
      className="absolute inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface-raised/80 px-4 backdrop-blur"
    >
      {/* 復原／重做：數字是還可以退幾步、進幾步 */}
      <button
        type="button"
        className={button}
        disabled={!canUndo}
        aria-label={props.undoLabel ?? '復原'}
        title={props.undoLabel ? `${props.undoLabel}（Ctrl/Cmd+Z）` : '沒有可以復原的'}
        data-testid="undo"
        onClick={props.onUndo}
      >
        ↶ <span data-testid="undo-count">{(props.undoCount ?? 0) > 0 ? props.undoCount : ''}</span>
      </button>
      <button
        type="button"
        className={button}
        disabled={!canRedo}
        aria-label={props.redoLabel ?? '重做'}
        title={props.redoLabel ? `${props.redoLabel}（Ctrl/Cmd+Shift+Z）` : '沒有可以重做的'}
        data-testid="redo"
        onClick={props.onRedo}
      >
        ↷ <span data-testid="redo-count">{(props.redoCount ?? 0) > 0 ? props.redoCount : ''}</span>
      </button>
      {props.onTidy ? (
        <button
          type="button"
          className={button}
          data-testid="tidy"
          title="拖過的格子回到自動排好的位置（可以復原）"
          onClick={props.onTidy}
        >
          整理
        </button>
      ) : null}
      {props.steps ? (
        <button
          type="button"
          className={button}
          data-testid="steps-all"
          aria-pressed={props.steps.allExpanded}
          title="在每個鏡頭和第一張畫面之間，顯示整理 Prompt、挑參考圖、送出模型這三步"
          onClick={props.steps.onToggle}
        >
          {props.steps.allExpanded ? '全部收合步驟' : '全部展開步驟'}
        </button>
      ) : null}
      <span className="flex-1" />
      {props.running !== undefined ? (
        <span
          role="status"
          data-testid="run-progress"
          className="flex items-center gap-2 rounded-lg bg-accent/15 py-1 pl-3 pr-1 text-[13px] font-semibold text-accent"
        >
          <Spinner label="生成中" />
          {props.running === 'grow'
            ? '生成中'
            : `生成中 ${String(props.running.done)}/${String(props.running.total)}`}
          {props.onStop ? (
            <button
              type="button"
              data-testid="run-stop"
              className="rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs font-normal text-fg hover:border-danger hover:text-danger"
              onClick={props.onStop}
            >
              停止
            </button>
          ) : null}
        </span>
      ) : props.onRunAll ? (
        <button
          type="button"
          data-testid="run-all"
          disabled={allDone}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
          onClick={(event) => {
            props.onRunAll?.(anchorOf(event.currentTarget))
          }}
        >
          {allDone
            ? '全部都生成好了'
            : props.joinOnly === true
              ? '接成成品'
              : pending === undefined
                ? '全部生成'
                : `全部生成（約 US$${pending.toFixed(2)}）`}
        </button>
      ) : null}
      {props.onHelp ? (
        <button
          type="button"
          className={button}
          aria-label="說明與工具"
          title="怎麼開始、鍵盤快捷鍵、效能自測"
          data-testid="help-menu"
          onClick={(event) => {
            props.onHelp?.(anchorOf(event.currentTarget))
          }}
        >
          ？
        </button>
      ) : null}
      <button
        type="button"
        className={button}
        aria-label="切換主題"
        onClick={() => {
          applyTheme(theme === 'dark' ? 'light' : 'dark')
        }}
      >
        {theme === 'dark' ? '☾' : '☀'}
      </button>
    </header>
  )
}

/** 右下角縮放控制：＋、－、全部顯示。右側面板開著時往左讓開（`right` 是離畫布右邊的距離）。 */
export function ZoomControls({ right = 12 }: { right?: number }) {
  const { zoomIn, zoomOut } = useReactFlow()
  const fitAll = useFitAll()
  const focusEntry = useFocusEntry()
  const unreadable = useStore((s) => s.transform[2] < READABLE_ZOOM)
  const button = cn(
    'rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-xs shadow-card hover:bg-accent/10',
  )
  return (
    <div
      className="absolute bottom-3 z-20 flex gap-1.5 transition-[right] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ right }}
    >
      {unreadable ? (
        <button
          type="button"
          className={cn(button, 'border-accent/50 text-accent')}
          data-testid="zoom-readable"
          title="縮太小，卡片上的字和按鈕都看不到：回到第一個入口，放大到看得清楚"
          onClick={focusEntry}
        >
          放大到看得清楚
        </button>
      ) : null}
      <button
        type="button"
        className={button}
        aria-label="放大"
        onClick={() => {
          void zoomIn({ duration: 200 })
        }}
      >
        ＋
      </button>
      <button
        type="button"
        className={button}
        aria-label="縮小"
        onClick={() => {
          void zoomOut({ duration: 200 })
        }}
      >
        －
      </button>
      <button
        type="button"
        className={button}
        data-testid="fit-view"
        onClick={() => {
          fitAll()
        }}
      >
        全部顯示
      </button>
    </div>
  )
}
