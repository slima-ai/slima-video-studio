import {
  CAMERA_MOVES,
  TRAILER_TEMPLATES,
  beatKindLabel,
  cameraMoveLabel,
  secLabel,
  t,
  type BeatKind,
  type ShotEdit,
  type ShotView,
  type TrailerStatus,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { call, errorText } from '../../lib/svs'
import { cardCount, narrationCount, type Count } from './beat-limits'
import { kindOf, segmentLabel } from './script-strip'

const STEP_SEC = 0.25
const MIN_SEC = 0.25
const MAX_SEC = 15
const AREA =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal placeholder:text-fg-subtle'

const countText = (count: Count): string =>
  t(count.chars ? 'trailer.edit.countChars' : 'trailer.edit.countWords', {
    n: count.n,
    max: count.max,
  })

/** 一個文字欄位：離開欄位才存（沒改就不存）；格子的內容從外面變了（復原、重排）就跟著換。 */
function Field({
  testId,
  label,
  value,
  rows,
  count,
  placeholder,
  disabled,
  onSave,
  onDraft,
}: {
  testId: string
  label: string
  value: string
  rows?: number
  count?: (draft: string) => Count
  placeholder?: string
  disabled: boolean
  onSave: (next: string) => void
  onDraft?: (draft: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  const shown = count?.(draft)
  const props = {
    'data-testid': testId,
    value: draft,
    placeholder,
    disabled,
    className: AREA,
    onChange: (event: { target: { value: string } }): void => {
      setDraft(event.target.value)
      onDraft?.(event.target.value)
    },
    onBlur: (): void => {
      if (draft.trim() !== value) onSave(draft.trim())
    },
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      <span className="flex items-baseline justify-between">
        {label}
        {shown ? (
          <span
            data-testid={`${testId}-count`}
            data-over={shown.over}
            className={shown.over ? 'text-warning' : ''}
          >
            {countText(shown)}
          </span>
        ) : null}
      </span>
      {rows ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />}
    </label>
  )
}

/**
 * 點一格就在腳本條下面改：種類三選一、依種類顯示的欄位（沒有用的不出現）、秒數（改了其他格讓時間，總長不變）、段落。
 * 欄位與存檔沿用 `shots.update`；秒數走 `trailer.setBeatSeconds`。景別、Prompt、版本這些進階的還在畫布的鏡頭面板。
 */
export function BeatEditor({ beat, status }: { beat: ShotView; status: TrailerStatus }) {
  const kind = kindOf(beat)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // 想改成字卡、但還沒有字：先顯示字卡的欄位，字填好離開欄位時才一起存（字卡沒有字不能存）
  const [wantCard, setWantCard] = useState(false)
  const [secDraft, setSecDraft] = useState(String(beat.durationSec))
  useEffect(() => {
    setWantCard(false)
  }, [beat.id])
  useEffect(() => {
    setSecDraft(secLabel(beat.durationSec))
  }, [beat.durationSec])
  const shownKind: BeatKind = wantCard ? 'card' : kind

  const run = (work: Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(false)
      })
  }
  const save = (patch: ShotEdit): void => {
    run(call('shots.update', { shotId: beat.id, patch }))
  }
  const setSeconds = (sec: number): void => {
    if (!Number.isFinite(sec)) return
    const next = Math.min(MAX_SEC, Math.max(MIN_SEC, sec))
    if (Math.abs(next - beat.durationSec) < 1e-6) return
    run(call('trailer.setBeatSeconds', { shotId: beat.id, durationSec: next }))
  }
  const pickKind = (next: BeatKind): void => {
    if (next === 'card') {
      if (kind === 'card') return
      // 沒有字就先等使用者填
      if (beat.card?.text) save({ beatKind: 'card' })
      else setWantCard(true)
      return
    }
    setWantCard(false)
    if (next !== kind) save({ beatKind: next })
  }

  const known = TRAILER_TEMPLATES[status.settings.kind].segments.map((s) => s.key)
  // 目前的段落不在模板裡（之後新增的類型、別的模板）：照原樣列出，不要悄悄換掉
  const keys = beat.segment && !known.includes(beat.segment) ? [...known, beat.segment] : known
  const segmentOptions = [
    { value: '', label: t('trailer.edit.noSegment') },
    ...keys.map((key) => ({ value: key, label: segmentLabel(key) })),
  ]
  const hasPicture = shownKind === 'video' || shownKind === 'still'

  return (
    <section
      data-testid="beat-editor"
      data-kind={shownKind}
      aria-label={t('trailer.edit.beat', { n: beat.number })}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold">{t('trailer.edit.beat', { n: beat.number })}</h2>
        {kind === 'title' ? (
          <span className="text-xs text-fg-muted">{beatKindLabel('title')}</span>
        ) : (
          <div
            role="radiogroup"
            aria-label={t('trailer.beatKindLabel')}
            className="flex rounded-lg border border-border bg-surface p-0.5 text-sm"
          >
            {(['video', 'still', 'card'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={shownKind === choice}
                disabled={busy}
                data-testid={`beat-kind-${choice}`}
                onClick={() => {
                  pickKind(choice)
                }}
                className={`rounded-md px-2.5 py-1 transition-colors disabled:opacity-50 ${shownKind === choice ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/5'}`}
              >
                {beatKindLabel(choice)}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1" data-testid="beat-seconds">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('trailer.edit.shorter')}
            data-testid="beat-seconds-minus"
            disabled={busy || beat.durationSec <= MIN_SEC + 1e-6}
            onClick={() => {
              setSeconds(beat.durationSec - STEP_SEC)
            }}
          >
            −
          </Button>
          <input
            type="text"
            inputMode="decimal"
            aria-label={t('trailer.edit.seconds')}
            data-testid="beat-seconds-input"
            value={secDraft}
            disabled={busy}
            className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-center text-sm"
            onChange={(event) => {
              setSecDraft(event.target.value)
            }}
            onBlur={() => {
              const n = Number(secDraft)
              // 沒改（顯示的字還是原本那串）就不送：每格秒數是 1/24 的整數倍，顯示會四捨五入
              if (secDraft === secLabel(beat.durationSec)) return
              if (Number.isFinite(n) && secDraft.trim() !== '') setSeconds(n)
              else setSecDraft(secLabel(beat.durationSec))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          <span className="text-xs text-fg-muted">{t('trailer.edit.secondsUnit')}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('trailer.edit.longer')}
            data-testid="beat-seconds-plus"
            disabled={busy || beat.durationSec >= MAX_SEC - 1e-6}
            onClick={() => {
              setSeconds(beat.durationSec + STEP_SEC)
            }}
          >
            ＋
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          {t('trailer.edit.segment')}
          <div className="w-32">
            <SimpleSelect
              testId="beat-segment"
              label={t('trailer.edit.segment')}
              value={beat.segment ?? ''}
              disabled={busy}
              options={segmentOptions}
              onChange={(value) => {
                save({ segment: value })
              }}
            />
          </div>
        </div>
      </div>

      {shownKind === 'title' ? (
        <p data-testid="beat-title-note" className="text-xs text-fg-muted">
          {t('trailer.edit.titleNote')}
        </p>
      ) : null}
      {shownKind === 'card' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            testId="beat-card-text"
            label={t('trailer.cardText')}
            value={wantCard ? '' : (beat.card?.text ?? '')}
            count={(draft) => cardCount(draft)}
            placeholder={t('trailer.cardTextPlaceholder')}
            disabled={busy}
            onSave={(text) => {
              if (text === '') return
              save({
                ...(wantCard ? { beatKind: 'card' as const } : {}),
                card: { text, subtext: beat.card?.subtext ?? '' },
              })
            }}
          />
          <Field
            testId="beat-card-subtext"
            label={t('trailer.cardSubtext')}
            value={beat.card?.subtext ?? ''}
            disabled={busy || (wantCard && !beat.card)}
            onSave={(subtext) => {
              if (beat.card) save({ card: { text: beat.card.text, subtext } })
            }}
          />
        </div>
      ) : null}
      {hasPicture ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            testId="beat-description"
            label={t('shots.whatHappensInThisShot')}
            value={beat.description}
            rows={2}
            disabled={busy}
            onSave={(description) => {
              if (description !== '') save({ description })
            }}
          />
          {shownKind === 'video' ? (
            <Field
              testId="beat-action"
              label={t('trailer.edit.action')}
              value={beat.action}
              rows={2}
              disabled={busy}
              onSave={(action) => {
                save({ action })
              }}
            />
          ) : (
            <div className="flex flex-col gap-1 text-xs text-fg-muted">
              {t('shots.cameraMove')}
              <SimpleSelect
                testId="beat-camera"
                label={t('shots.cameraMove')}
                value={beat.cameraMove ?? ''}
                disabled={busy}
                options={[
                  { value: '', label: t('shots.notSet') },
                  ...CAMERA_MOVES.map((move) => ({
                    value: move.id,
                    label: cameraMoveLabel(move.id),
                  })),
                ]}
                onChange={(value) => {
                  save({ cameraMove: value === '' ? null : value })
                }}
              />
            </div>
          )}
          <Field
            testId="beat-narration"
            label={t('trailer.edit.narration')}
            value={beat.dialogue}
            rows={2}
            count={(draft) => narrationCount(draft, beat.durationSec)}
            disabled={busy}
            onSave={(dialogue) => {
              save({ dialogue })
            }}
          />
        </div>
      ) : null}
      {error !== undefined ? (
        <p
          role="alert"
          data-testid="beat-error"
          className="whitespace-pre-wrap text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
