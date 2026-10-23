import { Plus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { Mascot } from '../../brand/mascot'
import { Button } from '../../components/button'
import { useChatDock } from './chat-context'
import { continueText } from './continue-text'
import { MessageView } from './message-view'
import { PrereqCard } from './prereq-card'
import { t, msg } from '@svs/schema'

/**
 * 檢查通常很快就有結果（App 預熱過）。過了這麼久還沒有結果，才顯示「正在檢查」；
 * 一開始就顯示的話，結果在幾十毫秒內回來，這幾個字只會閃一下。
 */
export const CHECKING_NOTE_DELAY_MS = 400

function CheckingNote() {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setLate(true)
    }, CHECKING_NOTE_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [])
  if (!late) return null
  return (
    <p className="p-4 text-sm text-fg-muted" role="status" data-testid="chat-checking">
      {t('chat.checkingClaudeCode')}
    </p>
  )
}

/** 對話框空的時候給的幾個起手式：點一下填進輸入框，不會自己送出。 */
const STARTERS = [
  msg('chat.addThreeShotsAStreet'),
  msg('chat.lookAtTheShotsIn'),
  msg('chat.makeShot1SDescription'),
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
          aria-label={t('chat.tellClaudeWhatYouWant')}
          rows={2}
          value={text}
          maxLength={8000}
          placeholder={t('chat.tellClaudeWhatYouWant2')}
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
            aria-label={t('chat.stop')}
            title={t('chat.stopWhatClaudeIsDoing')}
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
            {t('chat.send')}
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-fg-muted">{t('chat.thisUsesYourOwnSigned')}</p>
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
    <ul className="flex flex-wrap gap-1.5" aria-label={t('chat.youCouldSay')}>
      {STARTERS.map((starter) => (
        <li key={starter.msgKey}>
          <button
            type="button"
            data-testid="chat-starter"
            className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-fg-muted hover:border-accent hover:text-fg"
            onClick={() => {
              onPick(t(starter))
              boxRef.current?.focus()
            }}
          >
            {t(starter)}
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
      aria-label={t('chat.claudeChat')}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Claude</h2>
        {conversations.length > 0 ? (
          <select
            data-testid="chat-conversation-select"
            aria-label={t('chat.switchChat')}
            value={activeId ?? ''}
            className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1 text-xs"
            onChange={(event) => {
              select(event.target.value)
            }}
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.running ? t('chat.inProgress') : ''}
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
            title={t('chat.startANewChatOld')}
            onClick={newConversation}
          >
            <Plus className="size-4" aria-hidden />
            {t('chat.newChat')}
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t('chat.closeClaudeChat')}
          data-testid="chat-close"
          onClick={() => {
            setOpen(false)
          }}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      {prereq === undefined || prereq === 'checking' ? (
        // key：還沒開始檢查（undefined）與開始檢查（'checking'）換成不同的元件，計時從開始檢查才算
        <CheckingNote key={prereq === undefined ? 'idle' : 'checking'} />
      ) : prereq.state !== 'ready' ? (
        <PrereqCard prereq={prereq} onRecheck={recheck} />
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3" data-testid="chat-messages">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 pt-4 text-center">
                <Mascot size={56} mood="idle" />
                <p className="text-sm text-fg-muted">{t('chat.tellClaudeWhatYouWant3')}</p>
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
