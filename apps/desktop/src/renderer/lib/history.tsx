import type { HistoryState } from '@svs/schema'
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

import { useToast } from '../components/toast'
import { call, errorText } from './svs'

export interface HistoryApi {
  state: HistoryState
  /** 每復原或重做一次加一；頁面看到它變了就重新載入資料。 */
  revision: number
  undo: () => void
  redo: () => void
}

const IDLE: HistoryApi = {
  state: { canUndo: false, canRedo: false },
  revision: 0,
  undo: () => undefined,
  redo: () => undefined,
}

const HistoryContext = createContext<HistoryApi>(IDLE)

/** 大綱與分鏡表的復原／重做。沒有 HistoryProvider 時（單獨測試的頁面）什麼都不會發生。 */
export function useHistory(): HistoryApi {
  return useContext(HistoryContext)
}

/** 是文字輸入類的元素（它自己有文字復原）。 */
function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(target.type)
}

export const isMac = (): boolean => /mac/i.test(navigator.platform)

export interface HistoryProviderProps {
  /** 目前所在的頁面是不是用得到復原（大綱、分鏡表）；不是就不接管 Cmd／Ctrl+Z。 */
  enabled: boolean
  children: ReactNode
}

/**
 * 提供復原／重做，並接管 Cmd／Ctrl+Z（重做是加 Shift，Windows 也可以用 Ctrl+Y）。
 * 游標在輸入框裡、而且剛剛打了字還沒離開時，Cmd+Z 留給輸入框自己的文字復原；
 * 離開輸入框（內容已經存好）之後再按，才是復原整個動作。
 */
export function HistoryProvider({ enabled, children }: HistoryProviderProps) {
  const toast = useToast()
  const [state, setState] = useState<HistoryState>(IDLE.state)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let alive = true
    call('history.state', {})
      .then((next) => {
        if (alive) setState(next)
      })
      .catch(() => undefined)
    const off = window.svs.on('history.changed', ({ revision: next, ...rest }) => {
      setState(rest)
      setRevision(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const run = useCallback(
    (direction: 'undo' | 'redo'): void => {
      call(direction === 'undo' ? 'history.undo' : 'history.redo', {})
        .then((result) => {
          if (!result.applied) {
            toast.show({
              message: direction === 'undo' ? '沒有可以復原的動作' : '沒有可以重做的動作',
            })
            return
          }
          const other = direction === 'undo' ? 'redo' : 'undo'
          toast.show({
            key: 'history',
            message: `${direction === 'undo' ? '已復原' : '已重做'}：${result.label ?? ''}`,
            action: {
              label: direction === 'undo' ? '重做' : '復原',
              onAction: () => {
                run(other)
              },
            },
          })
        })
        .catch((e: unknown) => {
          toast.show({ message: errorText(e), tone: 'danger' })
        })
    },
    [toast],
  )

  // 輸入框獲得焦點時的內容：之後內容沒變，代表使用者還沒打字，Cmd+Z 就是要復原整個動作
  const focusValue = useRef(new WeakMap<Element, string>())
  useEffect(() => {
    if (!enabled) return undefined
    const onFocusIn = (event: FocusEvent): void => {
      if (isTextField(event.target)) focusValue.current.set(event.target, event.target.value)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return
      const mod = isMac() ? event.metaKey : event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !isMac())
      const undo = key === 'z' && !event.shiftKey
      if (!undo && !redo) return
      // 打開的對話框裡不接管
      if (document.querySelector('dialog[open]')) return
      const { target } = event
      if (isTextField(target) && target.value !== focusValue.current.get(target)) return
      event.preventDefault()
      run(redo ? 'redo' : 'undo')
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, run])

  const api = useMemo<HistoryApi>(
    () => ({
      state,
      revision,
      undo: () => {
        run('undo')
      },
      redo: () => {
        run('redo')
      },
    }),
    [state, revision, run],
  )

  return <HistoryContext.Provider value={api}>{children}</HistoryContext.Provider>
}
