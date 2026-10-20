import type { ChatPanelMessage, ChatStep } from '@svs/schema'
import { Check, Loader2, X } from 'lucide-react'

import { cn } from '../../lib/cn'

/** Claude 這一輪用過的工具：一行一個，進行中轉圈、做完打勾、失敗打叉；滑過看結果摘要。 */
function StepRow({ step }: { step: ChatStep }) {
  return (
    <li
      data-testid="chat-step"
      data-status={step.status}
      title={step.summary}
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
      <span>{step.label}</span>
    </li>
  )
}

/** 對話裡的一則訊息：使用者的話靠右；Claude 的回覆靠左，上面是它做的步驟，下面是文字。 */
export function MessageView({ message }: { message: ChatPanelMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="chat-message-user">
        <p className="wrap-zh max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-fg">
          {message.text}
        </p>
      </div>
    )
  }
  const streaming = message.state === 'streaming'
  const waiting = streaming && message.text === '' && message.steps.length === 0
  return (
    <div className="space-y-1.5" data-testid="chat-message-assistant" data-state={message.state}>
      {message.steps.length > 0 ? (
        <ul className="space-y-0.5 rounded-lg bg-surface-overlay px-2.5 py-2">
          {message.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ul>
      ) : null}
      {message.text !== '' ? (
        <p className="wrap-zh whitespace-pre-wrap text-sm">{message.text}</p>
      ) : null}
      {waiting ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Claude 正在想…
        </p>
      ) : null}
      {message.state === 'stopped' ? (
        <p className="text-xs text-fg-muted" data-testid="chat-stopped">
          已停止。已經送出去的生成任務不會跟著取消（到下方的生成佇列管理）。
        </p>
      ) : null}
      {message.state === 'error' ? (
        <p role="alert" className="text-sm text-danger" data-testid="chat-error">
          {message.error ?? 'Claude 這一輪沒有做完，請再試一次。'}
        </p>
      ) : null}
    </div>
  )
}
