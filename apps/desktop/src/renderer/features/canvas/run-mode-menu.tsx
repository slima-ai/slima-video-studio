import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '../../lib/cn'
import type { RunEstimate, RunScope } from './canvas-actions'
import type { ConfirmAnchor } from './run-confirm'

/** 選單裡的一列：只跑這個／這個和後面的／整條，各寫它會做什麼。 */
interface Choice {
  scope: RunScope
  title: string
  detail: string
}

/** 圖的 ▾：只跑這張圖，或者連影片一起（再接成品；「整條」對圖來說就是「這個和後面的」，不重複列）。 */
const IMAGE_CHOICES: readonly Choice[] = [
  { scope: 'this', title: '只跑這個', detail: '只重做這張第一張畫面' },
  { scope: 'from-here', title: '這個和後面的', detail: '第一張畫面、影片，再接成品' },
]

const VIDEO_CHOICES: readonly Choice[] = [
  { scope: 'this', title: '只跑這個', detail: '只重做這支影片' },
  { scope: 'from-here', title: '這個和後面的', detail: '這支影片，再接成品' },
  { scope: 'chain', title: '整條', detail: '第一張畫面、影片，再接成品' },
]

export const choicesOf = (kind: 'image' | 'video'): readonly Choice[] =>
  kind === 'image' ? IMAGE_CHOICES : VIDEO_CHOICES

const WIDTH = 260

/**
 * ▶ 旁的 ▾ 選單：「只跑這個／這個和後面的／整條」各列出會做什麼與預估花費；
 * 還不能跑的（例如影片還沒有第一張畫面）灰掉並寫原因。選了就交給上層貼出花費確認。
 * Esc 或點別處收起來。貼在 ▾ 的下方（放不下就往上）。
 */
export function RunModeMenu({
  kind,
  anchor,
  estimate,
  onPick,
  onClose,
}: {
  kind: 'image' | 'video'
  anchor: ConfirmAnchor
  estimate: (scope: RunScope) => Promise<RunEstimate | undefined>
  onPick: (scope: RunScope) => void
  onClose: () => void
}) {
  const choices = choicesOf(kind)
  const [estimates, setEstimates] = useState<Partial<Record<RunScope, RunEstimate>>>({})
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number }>()

  useEffect(() => {
    let alive = true
    for (const choice of choices) {
      void estimate(choice.scope).then((result) => {
        if (alive && result) setEstimates((now) => ({ ...now, [choice.scope]: result }))
      })
    }
    return () => {
      alive = false
    }
    // 開的時候問一次
  }, [])

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - WIDTH - 12))
    const below = anchor.bottom + 6
    const top =
      below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - 6 - height)
    setAt({ left, top })
  }, [anchor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="選要跑多少"
      data-testid="run-mode-menu"
      className="fixed z-50 flex flex-col gap-0.5 rounded-lg border border-border bg-surface-raised p-1.5 text-fg shadow-panel"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        width: WIDTH,
        ...(at ? {} : { opacity: 0 }),
      }}
    >
      {choices.map((choice) => {
        const result = estimates[choice.scope]
        const blocked = result?.issue !== undefined
        return (
          <button
            key={choice.scope}
            type="button"
            role="menuitem"
            data-testid={`run-mode-${choice.scope}`}
            aria-disabled={blocked || undefined}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
              blocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-fg/10',
            )}
            onClick={() => {
              if (blocked) return
              onPick(choice.scope)
            }}
          >
            <span className="flex w-full items-baseline justify-between gap-2 text-sm font-semibold">
              {choice.title}
              <span className="text-xs font-normal text-fg-muted" data-testid="run-mode-cost">
                {result === undefined
                  ? '…'
                  : result.issue !== undefined
                    ? ''
                    : result.nothing
                      ? '都生成好了'
                      : `約 US$${result.usd.toFixed(2)}${result.lowerBound ? '（至少）' : ''}`}
              </span>
            </span>
            <span className="text-xs text-fg-muted">{choice.detail}</span>
            {result?.issue !== undefined ? (
              <span className="text-xs text-warning" data-testid="run-mode-issue">
                {result.issue}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
