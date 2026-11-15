import type { AspectRatio } from '@svs/schema'
import { t } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../../lib/cn'
import { call, errorText } from '../../lib/svs'

/** 預告片只做這兩種比例；專案是別的比例（1:1 之類，只有 Claude 設得到）時兩個都不亮。 */
const CHOICES = [
  { value: '16:9', key: 'landscape', label: 'trailer.aspect.landscape' },
  { value: '9:16', key: 'portrait', label: 'trailer.aspect.portrait' },
] as const satisfies readonly { value: AspectRatio; key: string; label: string }[]

/**
 * 目前專案的畫面比例（橫式 16:9／直式 9:16）。`choose` 立刻改專案（之後生成的畫面才用新比例，
 * 已經做好的不會跟著變）；失敗時退回原本的選擇並給一句話。`pending` 期間不要往下做事。
 * 還沒有開著的專案（空畫布、首頁：寫腳本時才建專案）：預設亮橫式，選了先記在這裡，
 * 寫好腳本、專案建好之後由 `commit` 套上去（寫失敗不留空專案，所以不能先建）。
 */
export function useProjectAspect(): {
  aspect: AspectRatio | undefined
  choose: (next: AspectRatio) => void
  commit: () => Promise<void>
  pending: boolean
  error: string | undefined
} {
  const [projectAspect, setAspect] = useState<AspectRatio>()
  const [hasProject, setHasProject] = useState<boolean>()
  const [wanted, setWanted] = useState<AspectRatio>()
  const wantedRef = useRef<AspectRatio | undefined>(undefined)
  const aspect = hasProject === false ? (wanted ?? '16:9') : projectAspect
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const latest = useRef(0)

  useEffect(() => {
    let stale = false
    call('project.current', {})
      .then((info) => {
        if (stale) return
        setHasProject(Boolean(info))
        if (info) setAspect(info.aspectRatio)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [])

  const choose = useCallback(
    (next: AspectRatio): void => {
      if (next === aspect) return
      if (hasProject === false) {
        wantedRef.current = next
        setWanted(next)
        return
      }
      const before = aspect
      const mine = ++latest.current
      setAspect(next)
      setError(undefined)
      setPending(true)
      call('project.configure', { aspectRatio: next })
        .then((result) => {
          if (mine === latest.current) setAspect(result.aspectRatio)
        })
        .catch((e: unknown) => {
          if (mine !== latest.current) return
          setAspect(before)
          setError(errorText(e))
        })
        .finally(() => {
          if (mine === latest.current) setPending(false)
        })
    },
    [aspect, hasProject],
  )

  const commit = useCallback(async (): Promise<void> => {
    const next = wantedRef.current
    if (next === undefined) return
    wantedRef.current = undefined
    const result = await call('project.configure', { aspectRatio: next })
    setAspect(result.aspectRatio)
    setHasProject(true)
  }, [])

  return { aspect, choose, commit, pending, error }
}

/** 「橫式｜直式」兩選一。`testIdPrefix` 讓起手卡與設定面板各有自己的 testid。 */
export function AspectChoice({
  testIdPrefix,
  aspect,
  disabled,
  onChoose,
}: {
  testIdPrefix: string
  aspect: AspectRatio | undefined
  disabled?: boolean
  onChoose: (next: AspectRatio) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={t('trailer.aspect.label')}
      data-testid={`${testIdPrefix}-aspect`}
      className="flex rounded-lg border border-border bg-surface p-0.5 text-sm"
    >
      {CHOICES.map((choice) => {
        const on = aspect === choice.value
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled === true}
            data-testid={`${testIdPrefix}-aspect-${choice.key}`}
            onClick={() => {
              onChoose(choice.value)
            }}
            className={cn(
              'min-w-0 flex-1 rounded-md px-2 py-1 transition-colors disabled:opacity-50',
              on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/5',
            )}
          >
            {t(choice.label)}
          </button>
        )
      })}
    </div>
  )
}
