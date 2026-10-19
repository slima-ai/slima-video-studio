import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { timeAgo, usageLine } from '../../lib/usage'
import type { CardUsage } from './card-usage'
import { useEscape } from '../../lib/use-escape'

export interface CardFooterProps {
  shotId: string
  /** 鏡號（從 1 開始），給按鈕的無障礙名稱用。 */
  number: number
  usage: CardUsage
  /** 鏡頭正在生成：先不能再按重新生成。 */
  busy: boolean
}

/**
 * 鏡頭卡縮圖底下一行「耗時・花費・多久前」，加一個重新生成鈕。
 * 重新生成會再花錢，所以按下去先確認一次（舊版本都會保留）。
 */
export function CardFooter({ shotId, number, usage, busy }: CardFooterProps) {
  const [confirming, setConfirming] = useState(false)
  useEscape(confirming, () => {
    setConfirming(false)
  })
  const [problem, setProblem] = useState<string>()
  const line = usageLine({ durationMs: usage.durationMs, costUsd: usage.costUsd })
  const text = [
    line ? `${line}${usage.costEstimated ? '（估算）' : ''}` : undefined,
    timeAgo(usage.createdAt),
  ]
    .filter(Boolean)
    .join('・')

  const regenerate = (): void => {
    setConfirming(false)
    setProblem(undefined)
    call('shots.regenerate', { shotId, mode: 'all' }).catch((e: unknown) => {
      setProblem(errorText(e))
    })
  }

  return (
    <div className="space-y-1 border-t border-border px-2 py-1.5 text-xs text-fg-muted">
      <div className="flex items-center justify-between gap-2">
        <span data-testid="card-usage" className="truncate">
          {text}
        </span>
        {confirming ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            data-testid="card-regenerate"
            aria-label={`重新生成第 ${String(number)} 鏡`}
            disabled={busy}
            onClick={() => {
              setConfirming(true)
            }}
          >
            重新生成
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="card-confirm">
          <span>
            再生成一次
            {usage.regenerateUsd === undefined
              ? ''
              : `，大約再花 US$${usage.regenerateUsd.toFixed(2)}`}
            ；舊版本都會保留。
          </span>
          <Button
            size="sm"
            variant="primary"
            className="h-6 px-2 text-xs"
            data-testid="card-regenerate-confirm"
            onClick={regenerate}
          >
            確定
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            data-testid="card-regenerate-cancel"
            onClick={() => {
              setConfirming(false)
            }}
          >
            取消
          </Button>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" data-testid="card-problem" className="text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
