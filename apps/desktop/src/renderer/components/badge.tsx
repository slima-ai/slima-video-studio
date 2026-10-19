import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'premium'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-overlay text-fg-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  premium: 'bg-premium-soft text-premium',
}

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone
}

/** 小徽章：狀態、等級、標籤。 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}
