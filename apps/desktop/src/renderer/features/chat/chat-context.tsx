import type { ChatConversation, ChatEvent, ChatPanelMessage, ChatPrereq } from '@svs/schema'
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

import { useToast } from '../../components/toast'
import { call, errorText } from '../../lib/svs'

export interface ChatDock {
  /** 這個版本／設定有沒有打開 Claude 對話（沒打開就不顯示畫布右下角的按鈕）。 */
  enabled: boolean
  /** 重新問一次有沒有打開（設定頁改完回到畫布時）。 */
  refreshEnabled: () => void
  open: boolean
  setOpen: (open: boolean) => void
  /** 現在能不能開始；`checking` 是正在檢查。 */
  prereq: ChatPrereq | 'checking' | undefined
  /** 重新檢查：預設一定重新問一次 claude；`fresh:false` 用主程序已經查好的結果。 */
  recheck: (options?: { fresh?: boolean }) => void
  conversations: ChatConversation[]
  activeId: string | undefined
  active: ChatConversation | undefined
  messages: ChatPanelMessage[]
  select: (id: string) => void
  newConversation: () => void
  send: (text: string) => Promise<boolean>
  stop: () => void
}

const noop = (): void => undefined
const OFF: ChatDock = {
  enabled: false,
  refreshEnabled: noop,
  open: false,
  setOpen: noop,
  prereq: undefined,
  recheck: noop,
  conversations: [],
  activeId: undefined,
  active: undefined,
  messages: [],
  select: noop,
  newConversation: noop,
  send: () => Promise.resolve(false),
  stop: noop,
}

const ChatContext = createContext<ChatDock>(OFF)

export const useChatDock = (): ChatDock => useContext(ChatContext)

/** 依 id 取代或加進清單（訊息一路長出來時，主程序每次都推整則最新的）。 */
function upsert<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const at = list.findIndex((x) => x.id === item.id)
  if (at < 0) return [...list, item]
  const next = [...list]
  next[at] = item
  return next
}

/**
 * 右下角 Claude 對話的狀態：開關、能不能開始、對話清單、訊息。對話本身在主程序（一個對話一個 claude 行程），
 * 這裡只是它的畫面：主程序用 `chat.event` 推整則訊息過來，照 id 取代。
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpenState] = useState(false)
  const [prereq, setPrereq] = useState<ChatPrereq | 'checking'>()
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [byConversation, setByConversation] = useState<Record<string, ChatPanelMessage[]>>({})
  const loaded = useRef(new Set<string>())
  const resetRef = useRef<() => void>(() => undefined)

  const refreshEnabled = useCallback((): void => {
    // 設定的開關沒設時，開發版開、打包版關（跟主程序同一個規則）
    Promise.all([call('settings.get', {}), call('app.getInfo', {})])
      .then(([settings, info]) => {
        setEnabled(settings.experiments.claudeChat ?? !info.packaged)
      })
      .catch(() => {
        setEnabled(false)
      })
  }, [])
  useEffect(refreshEnabled, [refreshEnabled])

  useEffect(
    () =>
      window.svs.on('chat.event', (event: ChatEvent) => {
        if (event.type === 'reset') {
          // 專案換了：這個專案有它自己的對話，重讀
          resetRef.current()
        } else if (event.type === 'conversation') {
          setConversations((list) => upsert(list, event.conversation))
        } else {
          setByConversation((all) => ({
            ...all,
            [event.conversationId]: upsert(all[event.conversationId] ?? [], event.message),
          }))
        }
      }),
    [],
  )

  const loadMessages = useCallback((id: string): void => {
    if (loaded.current.has(id)) return
    loaded.current.add(id)
    call('chat.messages', { conversationId: id })
      .then(({ messages }) => {
        // 載入的途中可能已經有新事件推過來：以事件為準，只補沒有的
        setByConversation((all) => {
          const have = all[id] ?? []
          const merged = messages.filter((m) => !have.some((h) => h.id === m.id))
          return { ...all, [id]: [...merged, ...have] }
        })
      })
      .catch(() => {
        loaded.current.delete(id)
      })
  }, [])

  const select = useCallback(
    (id: string): void => {
      setActiveId(id)
      loadMessages(id)
    },
    [loadMessages],
  )

  const newConversation = useCallback((): void => {
    call('chat.create', {})
      .then((conversation) => {
        setConversations((list) => upsert(list, conversation))
        loaded.current.add(conversation.id)
        setActiveId(conversation.id)
      })
      .catch((error: unknown) => {
        toast.show({ message: errorText(error), tone: 'danger' })
      })
  }, [toast])

  // fresh=false：第一次打開用 App 預熱好的結果（主程序有就立刻回，沒有才真的去問）；使用者自己按重新檢查、
  // 或上次不能用之後再打開（多半是剛去設定頁處理過）一定重新問
  const check = useCallback(
    (fresh: boolean): void => {
      setPrereq('checking')
      call('chat.status', { fresh })
        .then((status) => {
          setPrereq(status)
          if (status.state !== 'ready') return undefined
          return call('chat.list', {}).then(({ conversations: list }) => {
            setConversations(list)
            const [latest] = list
            if (latest) select(latest.id)
            else newConversation()
          })
        })
        .catch((error: unknown) => {
          setPrereq(undefined)
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [newConversation, select, toast],
  )
  const recheck = useCallback(
    (options?: { fresh?: boolean }): void => {
      check(options?.fresh !== false)
    },
    [check],
  )

  // 專案換了（開另一個、另存為、Claude 建了新專案）：清掉畫面上的對話；面板開著或之前開過，就重讀這個專案的清單
  useEffect(() => {
    resetRef.current = (): void => {
      loaded.current.clear()
      setByConversation({})
      setActiveId(undefined)
      setConversations([])
      if (prereq !== undefined && prereq !== 'checking' && prereq.state === 'ready') check(false)
    }
  }, [prereq, check])

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next)
      // 打開時才檢查（檢查要啟動一次 claude，不在 App 一開就做）；已經可以用就不重做
      if (next && prereq !== 'checking' && prereq?.state !== 'ready') check(prereq !== undefined)
    },
    [prereq, check],
  )

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (activeId === undefined) return false
      try {
        await call('chat.send', { conversationId: activeId, text })
        return true
      } catch (error) {
        toast.show({ message: errorText(error), tone: 'danger' })
        return false
      }
    },
    [activeId, toast],
  )

  const stop = useCallback((): void => {
    if (activeId === undefined) return
    call('chat.stop', { conversationId: activeId }).catch(() => undefined)
  }, [activeId])

  const value = useMemo<ChatDock>(
    () => ({
      enabled,
      refreshEnabled,
      open,
      setOpen,
      prereq,
      recheck,
      conversations,
      activeId,
      active: conversations.find((c) => c.id === activeId),
      messages: activeId === undefined ? [] : (byConversation[activeId] ?? []),
      select,
      newConversation,
      send,
      stop,
    }),
    [
      enabled,
      refreshEnabled,
      open,
      setOpen,
      prereq,
      recheck,
      conversations,
      activeId,
      byConversation,
      select,
      newConversation,
      send,
      stop,
    ],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
