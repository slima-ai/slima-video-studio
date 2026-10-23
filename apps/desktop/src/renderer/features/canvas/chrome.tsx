import { useReactFlow, useStore } from '@xyflow/react'
import { Sparkles } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'

import { Spinner } from '../../components/skeleton'
import { cn } from '../../lib/cn'
import { applyTheme, useResolvedTheme } from '../../lib/theme'
import { ChatLauncher } from '../chat/chat-launcher'
import { READABLE_ZOOM, useFitAll, useFocusEntry } from './fit-all'
import { KindBadge } from './kind-icon'
import { anchorOf, type ConfirmAnchor } from './run-confirm'
import { ADD_ITEMS } from './menus'
import { t } from '@svs/schema'

export const DRAG_MIME = 'application/x-svs-node'

/** 別的東西開著（右側面板、選單、對話框）時，Esc 先留給它們收起。 */
const OVERLAY_OPEN =
  '[data-testid="canvas-panel"][data-open="true"], [role="menu"], [role="dialog"]'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * 左側節點面板：預設展開，可以收起；點擊新增，或拖到畫布上。
 * 收起有兩個入口：標題列的「收起 ‹」，和面板右緣的把手；按 Esc 也會收起（沒有別的東西要先收的時候）。
 * 視窗最小 1024 寬，面板 224 寬不到四分之一，所以不依視窗寬度預設收起——收起的話新手就看不到能新增什麼。
 */
export function NodePalette({
  onAdd,
  kinds,
}: {
  onAdd: (kind: string) => void
  /** 這個畫布能新增的種類；沒給就是全部。 */
  kinds?: readonly string[]
}) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTyping(event.target)) return
      if (document.querySelector(OVERLAY_OPEN)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
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
        {t('canvas.add2')}
      </button>
    )
  }
  return (
    <aside
      data-testid="node-palette"
      aria-label={t('canvas.addPanel')}
      className="absolute left-3 top-[68px] z-20 flex w-56 flex-col gap-1 rounded-2xl border border-border bg-surface-raised p-3 shadow-panel animate-scale-in"
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <h2 className="text-xs font-semibold text-fg-muted">{t('canvas.addTab')}</h2>
        <button
          type="button"
          data-testid="palette-close-text"
          title={t('canvas.closeThisPanelEsc')}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-fg/10 hover:text-fg"
          onClick={() => {
            setOpen(false)
          }}
        >
          {t('canvas.close')}
        </button>
      </div>
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
            <b className="text-[13px] font-medium">{t(item.label)}</b>
            <small className="text-[11px] leading-tight text-fg-muted">{t(item.desc)}</small>
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label={t('canvas.closeTheAddPanel')}
        title={t('canvas.closeTheAddPanelEsc')}
        data-testid="palette-close"
        className="absolute -right-4 top-1/2 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-fg/30 bg-surface-raised text-base font-semibold text-fg shadow-card hover:border-accent hover:text-accent"
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
        aria-label={props.undoLabel ?? t('canvas.undo')}
        title={
          props.undoLabel
            ? t('canvas.undoWithKey', { label: props.undoLabel })
            : t('canvas.nothingToUndo')
        }
        data-testid="undo"
        onClick={props.onUndo}
      >
        ↶ <span data-testid="undo-count">{(props.undoCount ?? 0) > 0 ? props.undoCount : ''}</span>
      </button>
      <button
        type="button"
        className={button}
        disabled={!canRedo}
        aria-label={props.redoLabel ?? t('canvas.redo2')}
        title={
          props.redoLabel
            ? t('canvas.redoWithKey', { label: props.redoLabel })
            : t('canvas.nothingToRedo')
        }
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
          data-tip={t('canvas.putMovedCellsBackIn')}
          onClick={props.onTidy}
        >
          {t('canvas.tidy')}
        </button>
      ) : null}
      {props.steps ? (
        <button
          type="button"
          className={button}
          data-testid="steps-all"
          aria-pressed={props.steps.allExpanded}
          title={t('canvas.betweenEachShotAndIts')}
          onClick={props.steps.onToggle}
        >
          {props.steps.allExpanded ? t('canvas.collapseAllSteps') : t('canvas.expandAllSteps')}
        </button>
      ) : null}
      <span className="flex-1" />
      {props.running !== undefined ? (
        <span
          role="status"
          data-testid="run-progress"
          className="flex items-center gap-2 rounded-lg bg-accent/15 py-1 pl-3 pr-1 text-[13px] font-semibold text-accent"
        >
          <Spinner label={t('canvas.generating')} />
          {props.running === 'grow'
            ? t('canvas.generating')
            : t('canvas.generating2', {
                value: String(props.running.done),
                value2: String(props.running.total),
              })}
          {props.onStop ? (
            <button
              type="button"
              data-testid="run-stop"
              className="rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs font-normal text-fg hover:border-danger hover:text-danger"
              onClick={props.onStop}
            >
              {t('canvas.stop')}
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
            ? t('canvas.everythingIsGenerated')
            : props.joinOnly === true
              ? t('canvas.joinIntoFilm')
              : pending === undefined
                ? t('canvas.generateAll')
                : t('canvas.generateAllAboutUs', { value: pending.toFixed(2) })}
        </button>
      ) : null}
      {props.onHelp ? (
        <button
          type="button"
          className={button}
          aria-label={t('canvas.helpAndTools')}
          title={t('canvas.howToStartKeyboardShortcuts')}
          data-testid="help-menu"
          onClick={(event) => {
            props.onHelp?.(anchorOf(event.currentTarget))
          }}
        >
          {t('canvas.helpGlyph')}
        </button>
      ) : null}
      <button
        type="button"
        className={button}
        aria-label={t('canvas.changeTheme')}
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
export function ZoomControls({
  right = 12,
  aiFollow,
}: {
  right?: number
  /** AI 工具改過東西之後才出現：畫面要不要跟著 AI 移動。 */
  aiFollow?: { on: boolean; onChange: (next: boolean) => void }
}) {
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
      <ChatLauncher />
      {aiFollow ? (
        <button
          type="button"
          role="switch"
          aria-checked={aiFollow.on}
          data-testid="follow-ai"
          title={t('canvas.whenAiEditsSomethingThe')}
          className={cn(
            button,
            'flex items-center gap-1',
            aiFollow.on ? 'border-accent/50 bg-accent/10 text-accent' : 'text-fg-muted',
          )}
          onClick={() => {
            aiFollow.onChange(!aiFollow.on)
          }}
        >
          <Sparkles aria-hidden className="size-3.5" />
          {aiFollow.on ? t('canvas.followAiOn') : t('canvas.followAiOff')}
        </button>
      ) : null}
      {unreadable ? (
        <button
          type="button"
          className={cn(button, 'border-accent/50 text-accent')}
          data-testid="zoom-readable"
          title={t('canvas.zoomedOutTooFarTo')}
          onClick={focusEntry}
        >
          {t('canvas.zoomInToRead')}
        </button>
      ) : null}
      <button
        type="button"
        className={button}
        aria-label={t('canvas.zoomIn')}
        onClick={() => {
          void zoomIn({ duration: 200 })
        }}
      >
        ＋
      </button>
      <button
        type="button"
        className={button}
        aria-label={t('canvas.zoomOut')}
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
        {t('canvas.showAll')}
      </button>
    </div>
  )
}
