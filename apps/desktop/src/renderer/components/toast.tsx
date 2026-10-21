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
  /**
   * 背景做完事的通知（不是使用者剛做的事）：畫面上有帶按鈕的提示（例如等著按「復原」）時先等著，
   * 那則收掉再顯示，不要把使用者剛做的事的回饋吃掉；等著的只留最新一則。
   */
  background?: boolean
}

interface ToastItem extends ToastOptions {
  id: number
}

export interface ToastApi {
  show: (toast: ToastOptions) => void
  /**
   * 對話框開著的時候先把提示收起來（不蓋在框上）、計時也暫停；回傳「放開」的函式，
   * 框關掉之後還沒到時間的提示就回來（「復原」找得回來）。可以同時有好幾個人在暫停，都放開才回來。
   */
  suspend: () => () => void
}

/** 提示停留的時間。 */
export const TOAST_MS = 5000

/** 要讓人來得及看完、動手的提示（例如匯出完成、要找檔案）停留的時間。 */
export const LONG_TOAST_MS = 12_000

/** 提示被收起來又回來之後，至少再停這麼久（剩下不到這個時間也給足，來得及按「復原」）。 */
export const RESUME_MIN_MS = 3000

const ToastContext = createContext<ToastApi>({
  show: () => undefined,
  suspend: () => () => undefined,
})

/** 顯示一則短暫的提示（沒有 ToastProvider 的地方，例如單獨測試的元件，什麼都不做）。 */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}

/**
 * 對話框（確認框、Modal）開著的時候，提示不蓋在它上面：提示先收起來、計時暫停，框關掉再回來。
 * 放在對話框元件裡呼叫，掛著就是暫停、卸載就放開。
 */
export function useSuspendToasts(): void {
  const { suspend } = useToast()
  useEffect(() => suspend(), [suspend])
}

/**
 * 畫面右下角的提示區（在佇列與縮放按鈕上方，不擋住畫布中間的東西）：幾秒後自己消失，螢幕閱讀器會念出來。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  /** 畫面上現在這一則，和等著輪到的背景通知。 */
  const shown = useRef<ToastItem | undefined>(undefined)
  const waiting = useRef<ToastOptions | undefined>(undefined)
  const dismissRef = useRef<(id: number) => void>(() => undefined)

  /** 每則提示什麼時候到期；暫停中的提示還剩多久。 */
  const due = useRef(new Map<number, number>())
  const paused = useRef(new Map<number, number>())
  const suspended = useRef(0)
  const [hidden, setHidden] = useState(false)

  const startTimer = useCallback((id: number, ms: number): void => {
    if (suspended.current > 0) {
      paused.current.set(id, ms)
      return
    }
    due.current.set(id, Date.now() + ms)
    timers.current.set(
      id,
      setTimeout(() => {
        dismissRef.current(id)
      }, ms),
    )
  }, [])

  const present = useCallback(
    (toast: ToastOptions): void => {
      const id = nextId.current++
      // 一次只顯示一則：新的提示直接取代畫面上的舊提示，不會疊在一起
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
      paused.current.clear()
      const item: ToastItem = { ...toast, id }
      shown.current = item
      setToasts([item])
      startTimer(id, toast.ms ?? TOAST_MS)
    },
    [startTimer],
  )

  const suspend = useCallback((): (() => void) => {
    suspended.current++
    if (suspended.current === 1) {
      for (const [id, timer] of timers.current) {
        clearTimeout(timer)
        paused.current.set(id, Math.max(0, (due.current.get(id) ?? Date.now()) - Date.now()))
      }
      timers.current.clear()
      setHidden(true)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      suspended.current--
      if (suspended.current > 0) return
      setHidden(false)
      const waitingToRun = [...paused.current]
      paused.current.clear()
      for (const [id, ms] of waitingToRun) startTimer(id, Math.max(ms, RESUME_MIN_MS))
    }
  }, [startTimer])

  const dismiss = useCallback(
    (id: number): void => {
      const timer = timers.current.get(id)
      if (timer) clearTimeout(timer)
      timers.current.delete(id)
      setToasts((current) => current.filter((t) => t.id !== id))
      if (shown.current?.id !== id) return
      shown.current = undefined
      const next = waiting.current
      waiting.current = undefined
      if (next) present(next)
    },
    [present],
  )
  dismissRef.current = dismiss

  const show = useCallback(
    (toast: ToastOptions): void => {
      if (toast.background === true && shown.current?.action) {
        waiting.current = toast
        return
      }
      present(toast)
    },
    [present],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, suspend }), [show, suspend])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        data-testid="toast-region"
        data-suspended={hidden}
        className={`svs-toast-region pointer-events-none fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 transition-[right] duration-300 ${hidden ? 'invisible' : ''}`}
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
