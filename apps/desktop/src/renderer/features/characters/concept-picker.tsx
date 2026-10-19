import type { CharacterView, ConceptView } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { useConcepts } from './use-concepts'

export interface ConceptPickerProps {
  character: CharacterView
  onChanged: (character: CharacterView) => void
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

/** 依輪次分組，新的一輪在前。 */
function byRound(concepts: readonly ConceptView[]): { round: number; items: ConceptView[] }[] {
  const rounds = new Map<number, ConceptView[]>()
  for (const concept of concepts) {
    rounds.set(concept.round, [...(rounds.get(concept.round) ?? []), concept])
  }
  return [...rounds.entries()].sort(([a], [b]) => b - a).map(([round, items]) => ({ round, items }))
}

/** 概念圖：一次生成 4 張候選，挑一張當主圖；不滿意可以整組重跑。 */
export function ConceptPicker({ character, onChanged }: ConceptPickerProps) {
  const { state, check, error, generate, cancel } = useConcepts(character.id)
  const [pickError, setPickError] = useState<string>()
  const generating = state?.generating
  const concepts = state?.concepts ?? []
  const rounds = byRound(concepts)

  const pick = async (concept: ConceptView): Promise<void> => {
    setPickError(undefined)
    try {
      onChanged(
        await call('characters.pickHero', { characterId: character.id, conceptId: concept.id }),
      )
    } catch (e) {
      setPickError(errorText(e))
    }
  }

  const costText = check
    ? check.demoMode
      ? '示範模式：結果是假的，不會花錢'
      : `預估約 ${usd(check.estimatedUsd)}${check.modelName ? `（${check.modelName}）` : ''}`
    : ''
  const problem = pickError ?? error ?? state?.error

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="concept-section">
      <h3 className="text-sm font-medium">概念圖與主圖</h3>
      <p className="text-xs text-fg-muted">
        先生成 4 張長相的候選，挑一張最像的當「主圖」。之後的三視圖和影片都以主圖為準。
      </p>

      {character.heroAssetHash ? (
        <div className="flex items-start gap-3" data-testid="concept-hero">
          <img
            src={assetUrl(character.heroAssetHash)}
            alt={`${character.name}的主圖`}
            className="size-40 rounded-md border border-border object-cover"
          />
          <p className="text-sm text-fg-muted">目前的主圖</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {generating ? (
          <>
            <span className="text-sm" data-testid="concept-progress">
              生成中… 已完成 {generating.done}／{generating.total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void cancel()}
              data-testid="concept-cancel"
            >
              取消
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              data-testid="concept-generate"
              disabled={!check?.ok}
              onClick={() => void generate()}
            >
              {concepts.length > 0 ? '整組重跑（4 張）' : '生成 4 張概念圖'}
            </Button>
            <span className="text-xs text-fg-muted" data-testid="concept-cost">
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

      {rounds.map(({ round, items }) => (
        <div key={round} data-testid={`concept-round-${String(round)}`}>
          <p className="mb-1 text-xs text-fg-muted">第 {round} 輪</p>
          <div className="grid grid-cols-4 gap-2">
            {items.map((concept) => {
              const chosen = concept.assetHash === character.heroAssetHash
              return (
                <button
                  key={concept.id}
                  type="button"
                  data-testid={`concept-${concept.id}`}
                  aria-label="挑這張當主圖"
                  aria-pressed={chosen}
                  onClick={() => void pick(concept)}
                  className={`overflow-hidden rounded-md border-2 ${
                    chosen ? 'border-accent' : 'border-transparent hover:border-border'
                  }`}
                >
                  <img
                    src={assetUrl(concept.assetHash)}
                    alt="概念圖"
                    className="aspect-square w-full object-cover"
                  />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
