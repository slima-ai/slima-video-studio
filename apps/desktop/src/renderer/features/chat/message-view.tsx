import { chatStepLabel, retranslate, type ChatPanelMessage, type ChatStep } from '@svs/schema'
import { Check, Loader2, X } from 'lucide-react'

import { Mascot, type MascotMood } from '../../brand/mascot'
import { Button } from '../../components/button'
import { cn } from '../../lib/cn'
import { Markdown } from './markdown'
import { t } from '@svs/schema'

/** Claude 這次用過的工具：一行一個，進行中轉圈、做完打勾、失敗打叉；滑過看結果摘要。 */
function StepRow({ step }: { step: ChatStep }) {
  return (
    <li
      data-testid="chat-step"
      data-status={step.status}
      title={step.interrupted === true ? t('chat.didnTFinish') : step.summary}
      className={cn(
        'flex items-center gap-1.5 text-xs',
        step.status === 'error' ? 'text-danger' : 'text-fg-muted',
      )}
    >
      {step.status === 'running' ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      ) : step.status === 'done' ? (
        <Check className="size-3 shrink-0 text-success" aria-hidden />
      ) : (
        <X className="size-3 shrink-0" aria-hidden />
      )}
      <span>{chatStepLabel(step)}</span>
    </li>
  )
}

const MOOD: Record<NonNullable<ChatPanelMessage['state']>, MascotMood> = {
  streaming: 'working',
  done: 'done',
  error: 'error',
  stopped: 'blocked',
}

/** 對話裡的一則訊息：使用者的話靠右；Claude 的回覆靠左，上面是它做的步驟，下面是文字。 */
export function MessageView({
  message,
  onContinue,
}: {
  message: ChatPanelMessage
  /** 這則因為用量到上限停下來、而且是最後一則時，給「繼續」按鈕用。 */
  onContinue?: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="chat-message-user">
        <p className="break-words max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-fg">
          {message.text}
        </p>
      </div>
    )
  }
  const streaming = message.state === 'streaming'
  const waiting = streaming && message.text === '' && message.steps.length === 0
  return (
    <div className="flex gap-2" data-testid="chat-message-assistant" data-state={message.state}>
      <Mascot size={28} mood={MOOD[message.state ?? 'done']} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        {message.steps.length > 0 ? (
          <ul className="space-y-0.5 rounded-lg bg-surface-overlay px-2.5 py-2">
            {message.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        ) : null}
        {message.notes !== undefined && message.notes.length > 0 ? (
          <details className="text-xs text-fg-muted" data-testid="chat-notes">
            <summary className="cursor-pointer select-none">
              {t('chat.claudeSWorkingNotesCollapsed')}
            </summary>
            {message.notes.map((note, index) => (
              <p key={index} className="mt-1 whitespace-pre-wrap break-words">
                {note}
              </p>
            ))}
          </details>
        ) : null}
        {message.text !== '' ? <Markdown text={message.text} /> : null}
        {waiting ? (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t('chat.claudeIsThinking')}
          </p>
        ) : null}
        {message.state === 'stopped' ? (
          <p className="text-xs text-fg-muted" data-testid="chat-stopped">
            {t('chat.stoppedGenerationsAlreadySentAre')}
          </p>
        ) : null}
        {message.state === 'error' ? (
          <p role="alert" className="text-sm text-danger" data-testid="chat-error">
            {message.error === undefined
              ? t('chat.claudeDidnTFinishThis')
              : retranslate(message.error)}
          </p>
        ) : null}
        {message.state === 'error' && message.resumable === true && onContinue ? (
          <Button size="sm" variant="primary" data-testid="chat-continue" onClick={onContinue}>
            {t('chat.continue')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
