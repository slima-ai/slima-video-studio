import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { cn } from '../lib/cn'
import { StatusLight, type StatusLightProps } from './status-light'

export interface SettingCardProps {
  /** 圖示（lucide 元件）：畫在卡左上的圓形底上。 */
  icon: LucideIcon
  /** 一個詞到一句短話。 */
  title: string
  /** 狀態燈（已填／沒填／連線中…）。 */
  status?: Pick<StatusLightProps, 'tone' | 'label'>
  /** 一句白話：使用者需要知道的那一件事。太長的放進 `details`。 */
  summary: string
  /** 卡右上角的主要動作（開關或按鈕），最多一個；其他操作放進 `details`。 */
  action?: ReactNode
  /** 「更多」展開後才看得到的設定細節；沒給就沒有「更多」。 */
  details?: ReactNode
  /** 一開始就展開（例如需要使用者馬上處理的卡）。 */
  defaultOpen?: boolean
  testId?: string
  className?: string
}

/**
 * 設定頁的卡片：圖示、標題、狀態燈、一句白話、一個動作；細節收在「更多」裡（卡內展開，不跳頁）。
 * 整張卡不是可以點的按鈕，只有右上角的動作和「更多」可以操作（避免誤觸）。
 */
export function SettingCard({
  icon: Icon,
  title,
  status,
  summary,
  action,
  details,
  defaultOpen = false,
  testId,
  className,
}: SettingCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const detailsId = useId()
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold">{title}</h3>
            {status ? <StatusLight tone={status.tone} label={status.label} /> : null}
          </div>
          <p className="wrap-zh mt-1 text-sm text-fg-muted">{summary}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {details ? (
        <div>
          <button
            type="button"
            data-testid="setting-card-more"
            aria-expanded={open}
            aria-controls={detailsId}
            className="inline-flex items-center gap-1 rounded-md text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
            {open ? '收起' : '更多'}
          </button>
          <div id={detailsId} hidden={!open} className="mt-3 border-t border-border pt-3">
            {open ? details : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
