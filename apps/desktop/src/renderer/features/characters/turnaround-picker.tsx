import type { CharacterView, TurnaroundCuts, TurnaroundView } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { useTurnarounds } from './use-turnarounds'
import { t, msg } from '@svs/schema'

export interface TurnaroundPickerProps {
  character: CharacterView
  onChanged: (character: CharacterView) => void
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

const VIEWS = [
  { key: 'front', label: msg('chat.front') },
  { key: 'side', label: msg('chat.side') },
  { key: 'back', label: msg('chat.back') },
] as const

function byRound(items: readonly TurnaroundView[]): { round: number; items: TurnaroundView[] }[] {
  const rounds = new Map<number, TurnaroundView[]>()
  for (const item of items) rounds.set(item.round, [...(rounds.get(item.round) ?? []), item])
  return [...rounds.entries()]
    .sort(([a], [b]) => b - a)
    .map(([round, list]) => ({ round, items: list }))
}

const sliceHashes = (t: TurnaroundView): [string, string, string] => [
  t.frontHash,
  t.sideHash,
  t.backHash,
]

interface CardProps {
  turnaround: TurnaroundView
  adopted: boolean
  index: number
  onAdopt: () => void
  onResliced: (updated: TurnaroundView) => void
  characterId: string
}

/** 一組候選：設定稿（上面畫著切線）、切好的三張，可以採用或調整切線。 */
function TurnaroundCard({
  turnaround,
  adopted,
  index,
  onAdopt,
  onResliced,
  characterId,
}: CardProps) {
  const [adjusting, setAdjusting] = useState(false)
  const [cuts, setCuts] = useState<TurnaroundCuts>(turnaround.cuts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const valid = cuts.b - cuts.a >= 0.1
  const changed = cuts.a !== turnaround.cuts.a || cuts.b !== turnaround.cuts.b

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      onResliced(
        await call('characters.reslice', { characterId, turnaroundId: turnaround.id, cuts }),
      )
      setAdjusting(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="space-y-2 rounded-md border border-border p-2"
      data-testid={`turnaround-${turnaround.id}`}
      data-adopted={adopted}
    >
      <div className="relative">
        <img
          src={assetUrl(turnaround.sheetHash)}
          alt={t('chat.turnaroundSheet', { value: String(index + 1) })}
          className="aspect-video w-full rounded object-cover"
        />
        {[adjusting ? cuts.a : turnaround.cuts.a, adjusting ? cuts.b : turnaround.cuts.b].map(
          (position, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-accent"
              style={{ left: `${String(position * 100)}%` }}
            />
          ),
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {sliceHashes(turnaround).map((hash, i) => {
          const view = VIEWS[i]
          return (
            <figure key={view?.key} className="text-center text-xs text-fg-muted">
              <img
                src={assetUrl(hash)}
                alt={view ? t(view.label) : ''}
                className="h-28 w-full rounded bg-white object-contain"
              />
              {view ? t(view.label) : null}
            </figure>
          )
        })}
      </div>

      {adjusting ? (
        <div className="space-y-1 text-xs" data-testid="turnaround-adjust">
          <label className="flex items-center gap-2">
            {t('chat.leftCutLine')}
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(cuts.a * 100)}
              aria-label={t('chat.leftCutLinePosition')}
              data-testid="turnaround-cut-a"
              onChange={(event) => {
                setCuts((current) => ({ ...current, a: Number(event.target.value) / 100 }))
              }}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-2">
            {t('chat.rightCutLine')}
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(cuts.b * 100)}
              aria-label={t('chat.rightCutLinePosition')}
              data-testid="turnaround-cut-b"
              onChange={(event) => {
                setCuts((current) => ({ ...current, b: Number(event.target.value) / 100 }))
              }}
              className="flex-1"
            />
          </label>
          {!valid ? <p className="text-warning">{t('chat.keepTheTwoCutLines')}</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={adopted ? 'secondary' : 'primary'}
          data-testid={`turnaround-adopt-${turnaround.id}`}
          aria-pressed={adopted}
          disabled={adopted}
          onClick={onAdopt}
        >
          {adopted ? t('chat.inUse') : t('chat.useThisOne')}
        </Button>
        {adjusting ? (
          <>
            <Button
              size="sm"
              data-testid="turnaround-reslice"
              disabled={busy || !valid || !changed}
              onClick={() => void apply()}
            >
              {t('chat.cutAgain')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdjusting(false)
                setCuts(turnaround.cuts)
              }}
            >
              {t('chat.cancelAdjusting')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            data-testid="turnaround-adjust-open"
            onClick={() => {
              setAdjusting(true)
            }}
          >
            {t('chat.cutOffAdjustTheLines')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 三視圖：以主圖為準，一次生成 4 組（正面・側面・背面），挑一組採用；切得不準可以調整切線。 */
export function TurnaroundPicker({ character, onChanged }: TurnaroundPickerProps) {
  const { state, check, error, generate, cancel } = useTurnarounds(
    character.id,
    character.heroAssetHash,
  )
  const [localError, setLocalError] = useState<string>()
  const [overrides, setOverrides] = useState<ReadonlyMap<string, TurnaroundView>>(new Map())
  const generating = state?.generating
  const turnarounds = (state?.turnarounds ?? []).map((t) => overrides.get(t.id) ?? t)
  const adoptedFront = character.turnaround?.front

  const adopt = async (turnaround: TurnaroundView): Promise<void> => {
    setLocalError(undefined)
    try {
      onChanged(
        await call('characters.adoptTurnaround', {
          characterId: character.id,
          turnaroundId: turnaround.id,
        }),
      )
    } catch (e) {
      setLocalError(errorText(e))
    }
  }

  const costText = check
    ? check.demoMode
      ? t('chat.demoModeSampleResultsNothing')
      : check.modelName
        ? t('chat.estimateAbout', { value: usd(check.estimatedUsd), modelName: check.modelName })
        : t('chat.estimateAbout2', { value: usd(check.estimatedUsd) })
    : ''
  const problem = localError ?? error ?? state?.error

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="turnaround-section">
      <h3 className="text-sm font-medium">{t('chat.turnaroundFrontSideBack')}</h3>
      <p className="text-xs text-fg-muted">{t('chat.basedOnTheMainPicture')}</p>

      {character.turnaround ? (
        <div className="grid grid-cols-3 gap-2" data-testid="turnaround-adopted">
          {VIEWS.map((view) => (
            <figure key={view.key} className="text-center text-xs text-fg-muted">
              <img
                src={assetUrl(character.turnaround?.[view.key] ?? '')}
                alt={t('chat.text2', { name: character.name, label: t(view.label) })}
                className="h-40 w-full rounded bg-white object-contain"
              />
              {t(view.label)}
            </figure>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {generating ? (
          <>
            <span className="text-sm" data-testid="turnaround-progress">
              {t('chat.generatingOfDone', {
                value: String(generating.done),
                value2: String(generating.total),
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="turnaround-cancel"
              onClick={() => void cancel()}
            >
              {t('chat.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              data-testid="turnaround-generate"
              disabled={!check?.ok}
              onClick={() => void generate()}
            >
              {turnarounds.length > 0 ? t('chat.redoAll4Sets') : t('chat.generate4Turnarounds')}
            </Button>
            <span className="text-xs text-fg-muted" data-testid="turnaround-cost">
              {check && !check.ok ? check.issue : costText}
            </span>
          </>
        )}
      </div>

      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}

      {byRound(turnarounds).map(({ round, items }) => (
        <div key={round} data-testid={`turnaround-round-${String(round)}`}>
          <p className="mb-1 text-xs text-fg-muted">{t('chat.round', { value: String(round) })}</p>
          <div className="space-y-3">
            {items.map((turnaround, index) => (
              <TurnaroundCard
                key={turnaround.id}
                turnaround={turnaround}
                index={index}
                characterId={character.id}
                adopted={adoptedFront === turnaround.frontHash}
                onAdopt={() => void adopt(turnaround)}
                onResliced={(updated) => {
                  setOverrides((current) => new Map(current).set(updated.id, updated))
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
