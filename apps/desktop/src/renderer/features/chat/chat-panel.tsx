import { Plus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { Mascot } from '../../brand/mascot'
import { Button } from '../../components/button'
import { useChatDock } from './chat-context'
import { continueText } from './continue-text'
import { MessageView } from './message-view'
import { PrereqCard } from './prereq-card'

/** 對話框空的時候給的幾個起手式：點一下填進輸入框，不會自己送出。 */
const STARTERS = [
  '幫我新增三個鏡頭：清晨的街角、公車進站、主角抬頭看天空',
  '看一下目前專案有哪些鏡頭，哪些還沒生成圖片或影片？',
  '把第 1 鏡的描述改得更有電影感',
]

/** 輸入框：Enter 送出、Shift+Enter 換行（中文輸入法選字時的 Enter 不算送出）；Claude 做事時變成停止鈕，Esc 也能停。 */
function Composer() {
  const { active, send, stop } = useChatDock()
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const running = active?.running === true
  const submit = (): void => {
    const value = text.trim()
    if (value === '' || running) return
    void send(value).then((sent) => {
      if (sent) setText('')
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }
  return (
    <div className="space-y-1.5 border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          data-testid="chat-input"
          aria-label="跟 Claude 說你想做什麼"
          rows={2}
          value={text}
          maxLength={8000}
          placeholder="跟 Claude 說你想做什麼…（Enter 送出，Shift+Enter 換行）"
          className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <Button
            variant="danger"
            size="icon"
            data-testid="chat-stop"
            aria-label="停止"
            title="停止 Claude 現在做的事（Esc）"
            onClick={stop}
          >
            <Square className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="primary"
            data-testid="chat-send"
            disabled={text.trim() === ''}
            onClick={submit}
          >
            送出
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-fg-muted">
        用的是你自己登入的 Claude Code，App 不碰你的登入資料，對話會用到你自己的 Claude 用量。Claude
        能做的事限於這個 App 的工具，會花錢的步驟它會先問你。
      </p>
      <StarterFill visible={text === '' && !running} onPick={setText} boxRef={box} />
    </div>
  )
}

function StarterFill({
  visible,
  onPick,
  boxRef,
}: {
  visible: boolean
  onPick: (text: string) => void
  boxRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const { messages } = useChatDock()
  // 對話裡已經有內容就不再給起手式
  if (!visible || messages.length > 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="可以這樣說">
      {STARTERS.map((starter) => (
        <li key={starter}>
          <button
            type="button"
            data-testid="chat-starter"
            className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-fg-muted hover:border-accent hover:text-fg"
            onClick={() => {
              onPick(starter)
              boxRef.current?.focus()
            }}
          >
            {starter}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 右邊滑出的對話面板內容：上面是對話切換與新對話，中間是訊息，下面是輸入框。 */
export function ChatPanel() {
  const {
    prereq,
    recheck,
    setOpen,
    conversations,
    activeId,
    select,
    newConversation,
    messages,
    active,
    send,
  } = useChatDock()
  const running = active?.running === true
  const end = useRef<HTMLDivElement>(null)
  // 有新內容就捲到最底
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages])
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="chat-panel"
      aria-label="Claude 對話"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Claude</h2>
        {conversations.length > 0 ? (
          <select
            data-testid="chat-conversation-select"
            aria-label="切換對話"
            value={activeId ?? ''}
            className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1 text-xs"
            onChange={(event) => {
              select(event.target.value)
            }}
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.running ? '（進行中）' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1" />
        )}
        {prereq !== undefined && prereq !== 'checking' && prereq.state === 'ready' ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="chat-new"
            title="開一個新對話（舊的對話還在、可以切回去）"
            onClick={newConversation}
          >
            <Plus className="size-4" aria-hidden />
            新對話
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="收起 Claude 對話"
          data-testid="chat-close"
          onClick={() => {
            setOpen(false)
          }}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      {prereq === undefined || prereq === 'checking' ? (
        <p className="p-4 text-sm text-fg-muted" role="status" data-testid="chat-checking">
          正在檢查 Claude Code…
        </p>
      ) : prereq.state !== 'ready' ? (
        <PrereqCard prereq={prereq} onRecheck={recheck} />
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3" data-testid="chat-messages">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 pt-4 text-center">
                <Mascot size={56} mood="idle" />
                <p className="text-sm text-fg-muted">
                  跟 Claude 說你想做什麼，它會直接改你現在開著的專案，你看得到它用了哪些步驟。
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <MessageView
                  key={message.id}
                  message={message}
                  {...(index === messages.length - 1 && !running
                    ? { onContinue: () => void send(continueText(messages, index)) }
                    : {})}
                />
              ))
            )}
            <div ref={end} />
          </div>
          <Composer />
        </>
      )}
    </section>
  )
}
