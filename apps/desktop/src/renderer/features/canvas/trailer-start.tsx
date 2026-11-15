import { TEASER_MAX_SEC, type TrailerKind, type TrailerPlanCheck } from '@svs/schema'
import { Clapperboard } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'
import { AspectChoice, useProjectAspect } from './aspect-choice'

const TEXTAREA =
  'resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal placeholder:text-fg-subtle'
const FIELD =
  'rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-normal placeholder:text-fg-subtle'

/** 長度選單：常用的四種（寫預告片的目標秒數）。 */
export const TRAILER_LENGTHS = [15, 30, 60, 90] as const

/** 寫腳本最多讀這麼多字（schema 的上限）；貼得更長的，多的不會被用。 */
export const TRAILER_TEXT_MAX = 60_000

/** 只留前 60,000 字（不把一個表情符號從中間切開）。 */
export function clipTrailerText(text: string): string {
  if (text.length <= TRAILER_TEXT_MAX) return text
  const cut = text.slice(0, TRAILER_TEXT_MAX)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** 懸念短版是給社群看的 15～30 秒；選它的時候長度只留這兩個。劇情型四個都有。 */
export const lengthsFor = (kind: TrailerKind): readonly number[] =>
  kind === 'teaser' ? TRAILER_LENGTHS.filter((n) => n <= TEASER_MAX_SEC) : TRAILER_LENGTHS

/** 估價要等使用者停手這麼久才問（打字時不連續呼叫）。 */
const CHECK_DEBOUNCE_MS = 400

/** 按鈕上寫的字：示範模式不花錢，真的模型寫出約多少美元。 */
export function trailerGoLabel(check: TrailerPlanCheck | undefined): string {
  if (check === undefined) return t('trailer.start.go')
  if (check.demoMode) return t('trailer.start.go')
  return t('trailer.start.goReal', { usd: check.estimatedUsd.toFixed(2) })
}

/**
 * 空白畫布的第 4 個起點：貼書的文字，選長度與類型，先產生腳本（只用文字模型，不生成圖片和影片）。
 * 腳本被檢查器擋下時，那則錯誤直接寫在卡片上（不只是一閃而過的提示）。
 */
export function TrailerStartCard({
  onDone,
  wide = false,
  beforePlan,
  restore,
}: {
  onDone?: () => void
  /** 首頁的大卡：撐滿寬度、文字框高一點（畫布上的是 264 px 的小卡）。 */
  wide?: boolean
  /** 寫腳本之前先做的事（首頁：先關掉開著的專案，腳本寫進新專案，不寫進舊的）。失敗就不寫。 */
  beforePlan?: () => Promise<void>
  /** 寫腳本前關掉了別的專案、寫失敗時：卡片上多一顆「重新打開《舊專案名》」，作者回得去原本的地方。 */
  restore?: { name: string; reopen: () => Promise<void> }
}) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [length, setLength] = useState<number>(30)
  const [kind, setKind] = useState<TrailerKind>('story')
  const [check, setCheck] = useState<TrailerPlanCheck>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const ratio = useProjectAspect()
  const busyRef = useRef(false)
  const empty = text.trim() === ''
  // 貼得比上限長也讓他貼（不默默截掉）：下面寫字數，超過就說只會用前面那些
  const chars = text.trim().length
  const tooLong = chars > TRAILER_TEXT_MAX

  // 有字就問一次預估花費與有沒有文字模型；沒字就不問
  useEffect(() => {
    if (empty) {
      setCheck(undefined)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      call('trailer.check', { text: clipTrailerText(text.trim()) })
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
    ;(beforePlan?.() ?? Promise.resolve())
      .then(() =>
        call('trailer.plan', {
          text: clipTrailerText(text.trim()),
          targetSec: length,
          kind,
          ...(title.trim() === '' ? {} : { title: title.trim() }),
        }),
      )
      // 沒有專案時選的橫式／直式，專案是寫腳本時才建的，建好之後才套得上去
      .then(() => ratio.commit().catch(() => undefined))
      .then(() => {
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
      className={`pointer-events-auto flex flex-col gap-2.5 rounded-2xl border border-border bg-surface-raised p-5 shadow-panel ${wide ? 'w-full' : 'w-[264px]'}`}
    >
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Clapperboard className="size-4 text-accent" aria-hidden />
        {t('trailer.start.title')}
      </h3>
      <textarea
        data-testid="trailer-text"
        rows={wide ? 6 : 3}
        value={text}
        disabled={busy}
        placeholder={t('trailer.start.textPlaceholder')}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className={TEXTAREA}
      />
      {empty ? null : (
        <p
          data-testid="trailer-count"
          className={tooLong ? 'text-xs text-warning' : 'text-xs text-fg-subtle'}
        >
          {t('trailer.start.count', {
            used: chars.toLocaleString('en-US'),
            max: TRAILER_TEXT_MAX.toLocaleString('en-US'),
          })}
          {tooLong ? (
            <span className="block">
              {t('trailer.start.onlyFirst', { max: TRAILER_TEXT_MAX.toLocaleString('en-US') })}
            </span>
          ) : null}
        </p>
      )}
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
            options={lengthsFor(kind).map((n) => ({
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
              { value: 'idea', label: t('trailer.kindIdea') },
            ]}
            onChange={(value) => {
              const next = value === 'teaser' || value === 'idea' ? value : 'story'
              setKind(next)
              // 60、90 秒不能用在懸念短版：已經選了就改回 30 秒
              if (!lengthsFor(next).includes(length)) setLength(30)
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="shrink-0">{t('trailer.aspect.label')}</span>
        <div className="min-w-0 flex-1">
          <AspectChoice
            testIdPrefix="trailer"
            aspect={ratio.aspect}
            disabled={busy}
            onChoose={ratio.choose}
          />
        </div>
      </div>
      {ratio.error !== undefined ? (
        <p role="alert" data-testid="trailer-aspect-error" className="text-xs text-danger">
          {ratio.error}
        </p>
      ) : null}
      <Button
        variant="primary"
        data-testid="trailer-go"
        disabled={busy || empty || blocked || ratio.pending}
        onClick={go}
      >
        {busy ? t('trailer.start.going') : trailerGoLabel(check)}
      </Button>
      {blocked ? (
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
          {restore ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              data-testid="trailer-reopen"
              onClick={() => {
                restore.reopen().catch((e: unknown) => {
                  setError(errorText(e))
                })
              }}
            >
              {t('trailer.start.reopen', { name: restore.name })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
