import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

import type { NodeKind } from './canvas-model'
import { KindIcon } from './kind-icon'
import { t } from '@svs/schema'

/** 面板寬度與離畫布邊緣的距離（uiux-spec §12.12：384px，右、上、下各 12px）。 */
export const FLOAT_PANEL = { width: 384, inset: 12 } as const
/** 滑入滑出的時間，跟第 1 節的動畫曲線一致。 */
const SLIDE_MS = 300

export type PanelTab = 'edit' | 'trial'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * 畫布右側的浮動面板：蓋在畫布上、不推擠畫布。標題列有種類圖示、名字與關閉鈕（×），
 * 生成類的格子下面多一排「編輯／試跑」分頁。Esc 或 × 收起；收起的動畫期間內容留著。
 */
export function FloatingPanel({
  open,
  top = FLOAT_PANEL.inset,
  kind,
  title,
  tabs,
  tab,
  onTab,
  onClose,
  children,
}: {
  open: boolean
  /** 離畫布上緣的距離（畫布上方有一排工具列時要讓開）。 */
  top?: number | undefined
  kind: NodeKind | undefined
  title: string
  /** 有試跑的格子才有分頁。 */
  tabs: boolean
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onClose: () => void
  children: ReactNode
}) {
  // 收起的動畫期間，內容與標題維持最後一次打開的樣子
  const [shown, setShown] = useState({ kind, title, tabs, children })
  if (open && (shown.children !== children || shown.title !== title || shown.kind !== kind)) {
    setShown({ kind, title, tabs, children })
  }
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  // 剛掛上時先畫在畫面外，下一格才滑進來（不然一出現就在原位，沒有滑入）
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return undefined
    }
    const frame = requestAnimationFrame(() => {
      setEntered(true)
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [open])
  useEffect(() => {
    if (open) return undefined
    const timer = setTimeout(() => {
      setMounted(false)
    }, SLIDE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [open])

  // 一打開就要能按 Esc 收起（畫出來之前就掛好監聽）；正在輸入時 Esc 留給輸入框
  useLayoutEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isEditable(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!mounted) return null
  const view = open ? { kind, title, tabs, children } : shown
  return (
    <aside
      aria-label={view.title}
      data-testid="canvas-panel"
      data-open={open}
      inert={!open}
      style={{
        top,
        right: FLOAT_PANEL.inset,
        bottom: FLOAT_PANEL.inset,
        width: FLOAT_PANEL.width,
        transform:
          open && entered
            ? 'translateX(0)'
            : `translateX(calc(100% + ${String(FLOAT_PANEL.inset)}px))`,
      }}
      className="nowheel absolute z-30 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-panel transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {view.kind ? <KindIcon kind={view.kind} /> : null}
        <h2
          className="min-w-0 flex-1 truncate text-base font-semibold"
          data-testid="canvas-panel-title"
        >
          {view.title}
        </h2>
        <button
          type="button"
          aria-label={t('canvas.close2')}
          data-testid="canvas-panel-close"
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-overlay hover:text-fg"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </header>
      {view.tabs ? (
        <div
          role="tablist"
          aria-label={t('canvas.panelTabs')}
          className="flex shrink-0 gap-1 px-4 pt-2"
        >
          {(
            [
              ['edit', t('canvas.edit')],
              ['trial', t('canvas.trialRun')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`canvas-panel-tab-${id}`}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === id
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-fg-muted hover:bg-surface-overlay hover:text-fg'
              }`}
              onClick={() => {
                onTab(id)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel">
        {view.children}
      </div>
    </aside>
  )
}
