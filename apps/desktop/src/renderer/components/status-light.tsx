import { cn } from '../lib/cn'

export type StatusTone = 'ok' | 'warn' | 'off' | 'error'

const DOT: Record<StatusTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  off: 'bg-fg-muted',
  error: 'bg-danger',
}

const TEXT: Record<StatusTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  off: 'text-fg-muted',
  error: 'text-danger',
}

export interface StatusLightProps {
  tone: StatusTone
  /** 一定要有文字：不能只靠顏色（色盲、深淺色都要看得懂）。 */
  label: string
  className?: string
}

/** 狀態燈：一顆小圓點加一小段字（「已填」「沒填」「連線中」…）。 */
export function StatusLight({ tone, label, className }: StatusLightProps) {
  return (
    <span
      data-testid="status-light"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium',
        TEXT[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', DOT[tone])} />
      {label}
    </span>
  )
}
