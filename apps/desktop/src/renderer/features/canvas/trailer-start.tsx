import type { TrailerKind, TrailerPlanCheck } from '@svs/schema'
import { Clapperboard } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { useToast } from '../../components/toast'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'

const TEXTAREA =
  'resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal placeholder:text-fg-subtle'
const FIELD =
  'rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-normal placeholder:text-fg-subtle'

/** 長度選單：常用的四種（寫預告片的目標秒數）。 */
export const TRAILER_LENGTHS = [15, 30, 60, 90] as const

/** 估價要等使用者停手這麼久才問（打字時不連續呼叫）。 */
const CHECK_DEBOUNCE_MS = 400

/** 按鈕上寫的字：示範模式不花錢，真的模型寫出約多少美元。 */
export function trailerGoLabel(check: TrailerPlanCheck | undefined): string {
  if (check === undefined) return t('trailer.start.go')
  if (check.demoMode) return t('trailer.start.goDemo')
  return t('trailer.start.goReal', { usd: check.estimatedUsd.toFixed(2) })
}

/**
 * 空白畫布的第 4 個起點：貼書的文字，選長度與類型，先產生腳本（只用文字模型，不生成圖片和影片）。
 * 腳本被檢查器擋下時，那則錯誤直接寫在卡片上（不只是一閃而過的提示）。
 */
export function TrailerStartCard({ onDone }: { onDone?: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [length, setLength] = useState<number>(30)
  const [kind, setKind] = useState<TrailerKind>('story')
  const [check, setCheck] = useState<TrailerPlanCheck>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const busyRef = useRef(false)
  const empty = text.trim() === ''

  // 有字就問一次預估花費與有沒有文字模型；沒字就不問
  useEffect(() => {
    if (empty) {
      setCheck(undefined)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      call('trailer.check', { text: text.trim() })
        .then((next) => {
          if (!stale) setCheck(next)
        })
        .catch(() => undefined)
    }, CHECK_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [text, empty])

  const blocked = check !== undefined && !check.ok
  const go = (): void => {
    if (busyRef.current || empty) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    call('trailer.plan', {
      text: text.trim(),
      targetSec: length,
      kind,
      ...(title.trim() === '' ? {} : { title: title.trim() }),
    })
      .then((result) => {
        toast.show({
          message: t('trailer.start.done', {
            count: result.beatCount,
            sec: result.scriptSec.toFixed(1),
          }),
        })
        onDone?.()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }

  return (
    <section
      data-testid="trailer-start"
      className="flex w-[264px] flex-col gap-2.5 rounded-2xl border border-border bg-surface-raised p-5 shadow-panel"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Clapperboard className="size-4 text-accent" aria-hidden />
        {t('trailer.start.title')}
      </h3>
      <p className="text-sm leading-snug text-fg-muted">{t('trailer.start.intro')}</p>
      <p data-testid="trailer-start-cost" className="text-xs leading-snug text-fg-subtle">
        {check === undefined || check.demoMode
          ? t('trailer.start.costDemo')
          : t('trailer.start.costReal', { usd: check.estimatedUsd.toFixed(2) })}
      </p>
      <textarea
        data-testid="trailer-text"
        rows={3}
        value={text}
        maxLength={60_000}
        disabled={busy}
        placeholder={t('trailer.start.textPlaceholder')}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className={TEXTAREA}
      />
      <input
        data-testid="trailer-title"
        value={title}
        maxLength={80}
        disabled={busy}
        placeholder={t('trailer.start.titlePlaceholder')}
        aria-label={t('trailer.panel.titleLabel')}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
        className={FIELD}
      />
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="shrink-0">{t('trailer.start.length')}</span>
        <div className="min-w-0 flex-1">
          <SimpleSelect
            testId="trailer-length"
            label={t('trailer.start.length')}
            value={String(length)}
            disabled={busy}
            options={TRAILER_LENGTHS.map((n) => ({
              value: String(n),
              label: t('trailer.lengthSec', { n }),
            }))}
            onChange={(value) => {
              setLength(Number(value))
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="shrink-0">{t('trailer.start.kind')}</span>
        <div className="min-w-0 flex-1">
          <SimpleSelect
            testId="trailer-kind"
            label={t('trailer.start.kind')}
            value={kind}
            disabled={busy}
            options={[
              { value: 'story', label: t('trailer.kindStory') },
              { value: 'teaser', label: t('trailer.kindTeaser') },
            ]}
            onChange={(value) => {
              setKind(value === 'teaser' ? 'teaser' : 'story')
            }}
          />
        </div>
      </div>
      <Button
        variant="primary"
        data-testid="trailer-go"
        disabled={busy || empty || blocked}
        onClick={go}
      >
        {busy ? t('trailer.start.going') : trailerGoLabel(check)}
      </Button>
      {empty ? (
        <p data-testid="trailer-reason" className="text-xs text-fg-subtle">
          {t('trailer.start.needText')}
        </p>
      ) : blocked ? (
        <p data-testid="trailer-reason" className="text-xs text-danger">
          {check.issue ?? ''}
        </p>
      ) : null}
      {error !== undefined ? (
        <div
          role="alert"
          data-testid="trailer-error"
          className="rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs leading-snug text-danger"
        >
          <p className="font-semibold">{t('trailer.start.failed')}</p>
          <p className="mt-1 whitespace-pre-wrap">{error}</p>
        </div>
      ) : null}
    </section>
  )
}
