import type { CanvasRunPlan, ModelTier } from '@svs/schema'

import { cn } from '../../lib/cn'
import { RunConfirm, type ConfirmAnchor } from './run-confirm'
import { t, msg, type MessageRef } from '@svs/schema'

/** 生成鈕旁的品質切換：「預設」是設定裡選的模型；「經濟」就是先出草稿。 */
export const QUALITY_CHOICES: readonly {
  value: ModelTier | undefined
  label: MessageRef
  hint: MessageRef
}[] = [
  { value: undefined, label: msg('canvas.default'), hint: msg('canvas.usesTheModelsChosenIn') },
  {
    value: 'premium',
    label: msg('canvas.highQuality'),
    hint: msg('canvas.bestPictureCostsMoreAnd'),
  },
  { value: 'balanced', label: msg('canvas.balanced'), hint: msg('canvas.middleOnPicturePriceAnd') },
  { value: 'budget', label: msg('canvas.economy'), hint: msg('canvas.forDraftsCheapAndFast') },
]

/** 三選一（加上「預設」）的小切換；換了之後確認面板重新算步驟與花費。 */
export function QualitySwitch({
  value,
  onChange,
}: {
  value: ModelTier | undefined
  onChange: (next: ModelTier | undefined) => void
}) {
  const chosen = QUALITY_CHOICES.find((choice) => choice.value === value)
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label={t('canvas.quality')}
        data-testid="quality-switch"
        className="flex rounded-lg border border-border bg-surface p-0.5 text-xs"
      >
        {QUALITY_CHOICES.map((choice) => {
          const on = choice.value === value
          return (
            <button
              key={choice.label.msgKey}
              type="button"
              role="radio"
              aria-checked={on}
              title={t(choice.hint)}
              data-testid={`quality-${choice.value ?? 'default'}`}
              className={cn(
                'flex-1 rounded-md px-2 py-1 transition-colors',
                on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/5',
              )}
              onClick={() => {
                onChange(choice.value)
              }}
            >
              {t(choice.label)}
            </button>
          )
        })}
      </div>
      {chosen ? (
        <p data-testid="quality-hint" className="text-xs leading-snug text-fg-muted">
          {`${t(chosen.label)}：${t(chosen.hint)}`}
        </p>
      ) : null}
    </div>
  )
}

/** 確認鈕：重做時說清楚會產生第幾版、舊的留著。 */
function okLabelOf(plan: CanvasRunPlan): string {
  const redo = plan.steps.filter((step) => step.redo)
  if (redo.length === 0) return t('canvas.run')
  const [only] = redo
  if (redo.length === 1 && only?.versions) {
    return t('canvas.redoMakesVKeepsV', {
      value: String(only.versions.next),
      value2: String(only.versions.current),
    })
  }
  return t('canvas.redoMakesANewVersion')
}

/**
 * 生成完之後會自動加的旁白與配樂（照一句話卡片上勾的）。旁白只念有台詞的鏡頭：
 * 沒有台詞（示範模式拆出來的鏡頭都沒有）就明說不會念，不說「自動加旁白」。
 */
function soundLines(sound: NonNullable<CanvasRunPlan['sound']>): string[] {
  const adds = [
    sound.narrationShots > 0 ? t('canvas.narration') : '',
    sound.music ? t('canvas.music') : '',
  ].filter(Boolean)
  if (sound.issue !== undefined) {
    const what = [
      sound.narration ? t('canvas.narration') : '',
      sound.music ? t('canvas.music') : '',
    ].filter(Boolean)
    return [
      t('canvas.afterJoiningItShouldAdd', { value: what.join(t('list.and')), issue: sound.issue }),
    ]
  }
  return [
    ...(adds.length > 0
      ? [
          t('canvas.afterJoiningIsAddedAutomatically', {
            value: adds.join(t('list.and')),
            value2: sound.usd.toFixed(2),
          }),
        ]
      : []),
    ...(sound.narration && sound.narrationShots === 0
      ? [
          sound.dialogueShots === 0
            ? t('canvas.narrationNoShotHasLines')
            : t('canvas.narrationEveryShotWithLines'),
        ]
      : []),
    ...(sound.narrationShots > 0
      ? [t('canvas.narrationShotsHaveLinesAnd', { value: String(sound.narrationShots) })]
      : []),
  ]
}

/** 這次會跑的每一步（重做的註明版本），加上略過幾段接成品的說明：步驟多的時候會捲動。 */
export function runStepLines(plan: CanvasRunPlan): string[] {
  return [
    ...plan.steps.map((step) =>
      step.redo
        ? step.versions
          ? t('canvas.redoWithVersions', {
              label: step.label,
              next: String(step.versions.next),
              current: String(step.versions.current),
            })
          : t('canvas.redoLabel', { label: step.label })
        : step.label,
    ),
    ...(plan.joinSkipped
      ? [t('canvas.theOtherClipsHaveNo', { value: String(plan.joinSkipped) })]
      : []),
  ]
}

/** 不跟著清單捲動、永遠看得到的幾行：用哪個模型、略過的鏡頭、示範模式的說明。 */
export function runPinnedLines(plan: CanvasRunPlan): string[] {
  const models = [plan.models.image, plan.models.video].filter(
    (name): name is string => name !== undefined,
  )
  return [
    ...(models.length > 0 && plan.shotCount > 0
      ? [t('canvas.uses', { value: models.join(t('list.comma')) })]
      : []),
    ...(plan.skippedBusy > 0
      ? [t('canvas.shotsAreBeingGeneratedSkipping', { value: String(plan.skippedBusy) })]
      : []),
    ...(plan.demoMode && plan.shotCount > 0 ? [t('canvas.demoModeNothingIsCharged')] : []),
  ]
}

/** 這次會跑的每一步，加上用哪個模型、略過幾鏡、示範模式的說明（兩段合起來）。 */
export function runLines(plan: CanvasRunPlan): string[] {
  return [...runStepLines(plan), ...runPinnedLines(plan)]
}

/** 執行的花費確認：列出這次會跑的每一步（已經有結果的不在裡面），預估花費。 */
export function RunPlanConfirm({
  plan,
  anchor,
  quality,
  onQuality,
  onOk,
  onCancel,
}: {
  plan: CanvasRunPlan
  anchor: ConfirmAnchor
  /** 生成鈕旁的品質（高品質／平衡／經濟）；沒給 onQuality 就不顯示切換。 */
  quality?: ModelTier | undefined
  onQuality?: (next: ModelTier | undefined) => void
  onOk: () => void
  onCancel: () => void
}) {
  const redo = plan.steps.some((step) => step.redo)
  // 只剩接成品：一行說完（幾段、免費、在本機處理），不列清單也不顯示花費
  if (plan.rejoin && plan.shotCount === 0) {
    return (
      <RunConfirm
        anchor={anchor}
        count={1}
        title={t('canvas.joinIntoFilmClipsFree', { value: String(plan.segments) })}
        lines={[]}
        costUsd={0}
        free
        okLabel={t('canvas.joinIntoFilm')}
        onOk={onOk}
        onCancel={onCancel}
      />
    )
  }
  // 旁白與配樂的說明放在步驟清單外面：清單很長時會捲動，這幾行不能被捲到看不見
  const soundNote = plan.sound ? (
    <ul className="flex flex-col gap-0.5 text-sm text-fg-muted" data-testid="run-confirm-sound">
      {soundLines(plan.sound).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  ) : null
  const qualitySwitch =
    onQuality && plan.shotCount > 0 ? <QualitySwitch value={quality} onChange={onQuality} /> : null
  const extra =
    soundNote || qualitySwitch ? (
      <>
        {soundNote}
        {qualitySwitch}
      </>
    ) : undefined
  return (
    <RunConfirm
      anchor={anchor}
      count={plan.steps.length}
      lines={runStepLines(plan)}
      pinnedLines={runPinnedLines(plan)}
      costUsd={plan.estimatedUsd}
      lowerBound={plan.estimateIsLowerBound}
      cachedNote={!redo}
      okLabel={okLabelOf(plan)}
      {...(extra ? { extra } : {})}
      onOk={onOk}
      onCancel={onCancel}
    />
  )
}
