import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/** 面板寬度：一般的詳情用 24rem，內容比較多的編輯用 34rem。 */
export const PANEL_WIDTHS = { normal: '24rem', wide: '34rem' } as const
export type PanelWidth = keyof typeof PANEL_WIDTHS

/** 滑出動畫的時間（毫秒），要跟 AppLayout 面板的 CSS 過渡一致。 */
export const PANEL_MS = 300

/** AppLayout 提供的「右側面板」位置：頁面把內容丟進來，AppLayout 負責滑入滑出。 */
export interface PanelHost {
  element: HTMLElement | null
  /** 面板要的寬度；`undefined` 表示收起。 */
  setWidth: (width: PanelWidth | undefined) => void
}

export const PanelHostContext = createContext<PanelHost | undefined>(undefined)

export interface SidePanelProps {
  /** 有選取才打開；沒有就收起，中央工作區占滿寬度。 */
  open: boolean
  onClose: () => void
  width?: PanelWidth
  children: ReactNode
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * 右側詳細面板：只有選取時才滑入（300ms），Esc 或「關閉」收起。
 * 放在 AppLayout 裡會滑進右側；單獨渲染（例如元件測試）就直接顯示在原位。
 */
export function SidePanel({ open, onClose, width = 'normal', children }: SidePanelProps) {
  const host = useContext(PanelHostContext)
  const setWidth = host?.setWidth

  // 收起的動畫期間內容還要留著：記住最後一次有內容的樣子
  const [shown, setShown] = useState(children)
  if (open && shown !== children) setShown(children)

  // 是否還掛在畫面上（收起後等動畫播完才拿掉）
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    setWidth?.(open ? width : undefined)
    if (open) return undefined
    const timer = setTimeout(() => {
      setMounted(false)
    }, PANEL_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [open, width, setWidth])

  // 離開頁面時把位置還給中央工作區
  useEffect(
    () => () => {
      setWidth?.(undefined)
    },
    [setWidth],
  )

  // 面板一出現就要能按 Esc 收起（畫出來之前就掛好監聽）
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

  if (!host) {
    return open ? (
      <div className="rounded-lg border border-border bg-surface-raised shadow-card">
        {children}
      </div>
    ) : null
  }
  if (!host.element || !mounted) return null
  return createPortal(
    <div
      className="h-full overflow-y-auto overscroll-contain"
      style={{ width: PANEL_WIDTHS[width] }}
    >
      {open ? children : shown}
    </div>,
    host.element,
  )
}
