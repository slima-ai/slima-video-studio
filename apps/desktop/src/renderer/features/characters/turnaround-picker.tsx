import type { CharacterView, TurnaroundCuts, TurnaroundView } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { useTurnarounds } from './use-turnarounds'

export interface TurnaroundPickerProps {
  character: CharacterView
  onChanged: (character: CharacterView) => void
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

const VIEWS = [
  { key: 'front', label: '正面' },
  { key: 'side', label: '側面' },
  { key: 'back', label: '背面' },
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
          alt={`第 ${String(index + 1)} 組三視圖設定稿`}
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
        {sliceHashes(turnaround).map((hash, i) => (
          <figure key={VIEWS[i]?.key} className="text-center text-xs text-fg-muted">
            <img
              src={assetUrl(hash)}
              alt={VIEWS[i]?.label ?? ''}
              className="h-28 w-full rounded bg-white object-contain"
            />
            {VIEWS[i]?.label}
          </figure>
        ))}
      </div>

      {adjusting ? (
        <div className="space-y-1 text-xs" data-testid="turnaround-adjust">
          <label className="flex items-center gap-2">
            左邊切線
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(cuts.a * 100)}
              aria-label="左邊切線位置"
              data-testid="turnaround-cut-a"
              onChange={(event) => {
                setCuts((current) => ({ ...current, a: Number(event.target.value) / 100 }))
              }}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-2">
            右邊切線
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(cuts.b * 100)}
              aria-label="右邊切線位置"
              data-testid="turnaround-cut-b"
              onChange={(event) => {
                setCuts((current) => ({ ...current, b: Number(event.target.value) / 100 }))
              }}
              className="flex-1"
            />
          </label>
          {!valid ? <p className="text-warning">兩條切線要隔開一點。</p> : null}
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
          {adopted ? '使用中' : '採用這組'}
        </Button>
        {adjusting ? (
          <>
            <Button
              size="sm"
              data-testid="turnaround-reslice"
              disabled={busy || !valid || !changed}
              onClick={() => void apply()}
            >
              重新切
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdjusting(false)
                setCuts(turnaround.cuts)
              }}
            >
              取消調整
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
            切得不準？調整切線
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
      ? '示範模式：結果是假的，不會花錢'
      : `預估約 ${usd(check.estimatedUsd)}${check.modelName ? `（${check.modelName}）` : ''}`
    : ''
  const problem = localError ?? error ?? state?.error

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="turnaround-section">
      <h3 className="text-sm font-medium">三視圖（正面・側面・背面）</h3>
      <p className="text-xs text-fg-muted">
        以主圖為準，畫出同一個角色的三個角度，之後生成影片時可以當參考。一次生成 4
        組，挑最好的一組。
      </p>

      {character.turnaround ? (
        <div className="grid grid-cols-3 gap-2" data-testid="turnaround-adopted">
          {VIEWS.map((view) => (
            <figure key={view.key} className="text-center text-xs text-fg-muted">
              <img
                src={assetUrl(character.turnaround?.[view.key] ?? '')}
                alt={`${character.name}的${view.label}`}
                className="h-40 w-full rounded bg-white object-contain"
              />
              {view.label}
            </figure>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {generating ? (
          <>
            <span className="text-sm" data-testid="turnaround-progress">
              生成中… 已完成 {generating.done}／{generating.total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="turnaround-cancel"
              onClick={() => void cancel()}
            >
              取消
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
              {turnarounds.length > 0 ? '整組重跑（4 組）' : '生成 4 組三視圖'}
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
          <p className="mb-1 text-xs text-fg-muted">第 {round} 輪</p>
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
