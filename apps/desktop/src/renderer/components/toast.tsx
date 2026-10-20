import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { Button } from './button'

export interface ToastOptions {
  message: string
  tone?: 'info' | 'danger'
  /** 提示旁的一顆按鈕，例如復原之後的「重做」。 */
  action?: { label: string; onAction: () => void }
  /** 這則提示停留多久（毫秒）；沒給是 `TOAST_MS`。 */
  ms?: number
  /** 這則提示是哪一類（例如連續復原）；畫面上一次只留一則，key 只是標記。 */
  key?: string
}

interface ToastItem extends ToastOptions {
  id: number
}

export interface ToastApi {
  show: (toast: ToastOptions) => void
}

/** 提示停留的時間。 */
export const TOAST_MS = 5000

/** 要讓人來得及看完、動手的提示（例如匯出完成、要找檔案）停留的時間。 */
export const LONG_TOAST_MS = 12_000

const ToastContext = createContext<ToastApi>({ show: () => undefined })

/** 顯示一則短暫的提示（沒有 ToastProvider 的地方，例如單獨測試的元件，什麼都不做）。 */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}

/**
 * 畫面右下角的提示區（在佇列與縮放按鈕上方，不擋住畫布中間的東西）：幾秒後自己消失，螢幕閱讀器會念出來。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number): void => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (toast: ToastOptions): void => {
      const id = nextId.current++
      // 一次只顯示一則：新的提示直接取代畫面上的舊提示，不會疊在一起
      setToasts((current) => {
        for (const t of current) {
          const timer = timers.current.get(t.id)
          if (timer) clearTimeout(timer)
          timers.current.delete(t.id)
        }
        return [{ ...toast, id }]
      })
      timers.current.set(
        id,
        setTimeout(() => {
          dismiss(id)
        }, toast.ms ?? TOAST_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        data-testid="toast-region"
        className="svs-toast-region pointer-events-none fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 transition-[right] duration-300"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            data-tone={toast.tone ?? 'info'}
            className={`pointer-events-auto flex max-w-md animate-dialog-in items-center gap-3 rounded-lg border bg-surface-overlay px-4 py-2 text-sm shadow-card ${
              toast.tone === 'danger' ? 'border-danger text-danger' : 'border-border text-fg'
            }`}
          >
            <span className="wrap-zh">{toast.message}</span>
            {toast.action ? (
              <Button
                size="sm"
                variant="ghost"
                data-testid="toast-action"
                // 提示的字很長時，按鈕的字不要被擠成好幾行
                className="shrink-0 whitespace-nowrap"
                onClick={() => {
                  toast.action?.onAction()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
