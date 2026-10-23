import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { call } from '../../lib/svs'
import { cn } from '../../lib/cn'
import type { CanvasRunChoice, CanvasRunChoices, ModelTier } from '@svs/schema'
import { lowerFirst, t } from '@svs/schema'
import type { ConfirmAnchor } from './run-confirm'

/** 「全部生成」旁邊選單裡的兩種：主按鈕是「生成空的」，這裡是另外兩個明確的做法。 */
export type RunAllChoice = 'stale' | 'regenerate'

const WIDTH = 360

const costOf = (choice: CanvasRunChoice): string =>
  lowerFirst(
    t(choice.estimateIsLowerBound ? 'canvas.costAtLeast' : 'canvas.costAbout', {
      value: choice.estimatedUsd.toFixed(2),
    }),
  )

/**
 * 「全部生成」旁 ▾ 的選單：除了主按鈕的「生成空的」，另外兩個明確的做法各寫出幾鏡、多少錢：
 * 重跑標了需要重跑的、全部重新生成（產生新版本並採用，舊版本保留）。
 * 沒有東西可動的（0 鏡）或現在做不了的灰掉。選了就交給上層貼出會動到哪幾鏡的確認視窗。
 * Esc 或點別處收起來；貼在按鈕下方（放不下就往上）。
 */
export function RunAllMenu({
  anchor,
  quality,
  onPick,
  onClose,
}: {
  anchor: ConfirmAnchor
  quality: ModelTier | undefined
  onPick: (choice: RunAllChoice) => void
  onClose: () => void
}) {
  const [choices, setChoices] = useState<CanvasRunChoices>()
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number }>()

  useEffect(() => {
    let alive = true
    call('canvas.runChoices', quality ? { quality } : {})
      .then((result) => {
        if (alive) setChoices(result)
      })
      .catch(() => {
        if (alive) onClose()
      })
    return () => {
      alive = false
    }
    // 開的時候問一次
  }, [])

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    const left = Math.max(12, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
    const below = anchor.bottom + 6
    const top =
      below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - 6 - height)
    setAt({ left, top })
  }, [anchor, choices])

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

  const rows: {
    id: RunAllChoice
    choice: CanvasRunChoice | undefined
    title: string
    detail: string
  }[] = [
    {
      id: 'stale',
      choice: choices?.stale,
      title: t('canvas.redoMarkedShots', {
        count: choices?.stale.shots ?? 0,
        cost: choices ? costOf(choices.stale) : '',
      }),
      detail: t('canvas.redoMarkedShotsDetail'),
    },
    {
      id: 'regenerate',
      choice: choices?.regenerate,
      title: t('canvas.regenerateAllShots', {
        count: choices?.regenerate.shots ?? 0,
        cost: choices ? costOf(choices.regenerate) : '',
      }),
      detail: t('canvas.regenerateAllShotsDetail'),
    },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('canvas.moreWaysToGenerate')}
      data-testid="run-all-menu"
      className="fixed z-50 flex flex-col gap-0.5 rounded-lg border border-border bg-surface-raised p-1.5 text-fg shadow-panel"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        width: WIDTH,
        ...(at ? {} : { opacity: 0 }),
      }}
    >
      {rows.map(({ id, choice, title, detail }) => {
        const nothing = choice !== undefined && choice.ok && choice.shots === 0
        const blocked = choice === undefined || nothing || !choice.ok
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            data-testid={`run-all-${id}`}
            aria-disabled={blocked || undefined}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
              blocked ? 'cursor-not-allowed opacity-50' : 'hover:bg-fg/10',
            )}
            onClick={() => {
              if (!blocked) onPick(id)
            }}
          >
            <span className="text-sm font-semibold" data-testid="run-all-title">
              {choice === undefined ? t('canvas.workingOutThePrice') : title}
            </span>
            <span className="text-xs text-fg-muted">
              {nothing ? t('canvas.nothingToDoHere') : detail}
            </span>
            {choice !== undefined && !choice.ok && choice.issue !== undefined ? (
              <span className="text-xs text-warning" data-testid="run-all-issue">
                {choice.issue}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
