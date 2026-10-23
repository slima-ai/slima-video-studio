import { Loader2 } from 'lucide-react'
import { t } from '@svs/schema'

/** 載入中的骨架：一條淡色的長條，會慢慢明暗閃動。 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-overlay ${className}`} />
}

/** 一整塊載入中的卡片骨架（幾條長條），讓使用者知道內容正在來，而不是整片空白。 */
export function SkeletonCards({
  count = 3,
  testId = 'loading',
}: {
  count?: number
  testId?: string
}) {
  return (
    <div role="status" aria-label={t('shell.loading')} data-testid={testId} className="space-y-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
        >
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** 小小的轉圈圈，放在按鈕或一行文字旁邊表示「進行中」。 */
export function Spinner({ label = t('shell.working') }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 aria-hidden className="size-4 animate-spin" />
    </span>
  )
}
