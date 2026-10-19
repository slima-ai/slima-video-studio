import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon: LucideIcon
  /** 一句白話：現在是什麼狀況。 */
  message: ReactNode
  /** 主要按鈕。 */
  action?: ReactNode
  testId?: string
  className?: string
}

/** 空狀態：圖示、一句話、一顆主要按鈕。 */
export function EmptyState({
  icon: Icon,
  message,
  action,
  testId,
  className = 'py-6',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center gap-3 text-center ${className}`}
      data-testid={testId}
    >
      <Icon className="size-10 text-fg-muted/60" aria-hidden />
      <p className="max-w-sm text-sm text-fg-muted">{message}</p>
      {action}
    </div>
  )
}
