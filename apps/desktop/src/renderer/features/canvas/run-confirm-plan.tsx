import type { CanvasRunPlan, ModelTier } from '@svs/schema'

import { cn } from '../../lib/cn'
import { RunConfirm, type ConfirmAnchor } from './run-confirm'

/** 生成鈕旁的品質切換：「預設」是設定裡選的模型；「經濟」就是先出草稿。 */
export const QUALITY_CHOICES: readonly {
  value: ModelTier | undefined
  label: string
  hint: string
}[] = [
  { value: undefined, label: '預設', hint: '用設定裡選的模型' },
  { value: 'premium', label: '高品質', hint: '畫面最好，比較貴' },
  { value: 'balanced', label: '平衡', hint: '畫面和價錢都中等' },
  { value: 'budget', label: '經濟', hint: '先出草稿：便宜、快，滿意的鏡頭再用高品質重做' },
]

/** 三選一（加上「預設」）的小切換；換了之後確認面板重新算步驟與花費。 */
export function QualitySwitch({
  value,
  onChange,
}: {
  value: ModelTier | undefined
  onChange: (next: ModelTier | undefined) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="品質"
      data-testid="quality-switch"
      className="flex rounded-lg border border-border bg-surface p-0.5 text-xs"
    >
      {QUALITY_CHOICES.map((choice) => {
        const on = choice.value === value
        return (
          <button
            key={choice.label}
            type="button"
            role="radio"
            aria-checked={on}
            title={choice.hint}
            data-testid={`quality-${choice.value ?? 'default'}`}
            className={cn(
              'flex-1 rounded-md px-2 py-1 transition-colors',
              on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/5',
            )}
            onClick={() => {
              onChange(choice.value)
            }}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

/** 確認鈕：重做時說清楚會產生第幾版、舊的留著。 */
function okLabelOf(plan: CanvasRunPlan): string {
  const redo = plan.steps.filter((step) => step.redo)
  if (redo.length === 0) return '執行'
  const [only] = redo
  if (redo.length === 1 && only?.versions) {
    return `重做（產生 v${String(only.versions.next)}，保留 v${String(only.versions.current)}）`
  }
  return '重做（產生新的一版，舊的保留）'
}

/** 生成完之後會自動加的旁白與配樂（照一句話卡片上勾的）。 */
function soundLine(sound: NonNullable<CanvasRunPlan['sound']>): string {
  const what = [sound.narration ? '旁白' : '', sound.music ? '配樂' : ''].filter(Boolean).join('與')
  return sound.issue === undefined
    ? `接好片之後自動加${what}（約 US$${sound.usd.toFixed(2)}）`
    : `接好片之後想自動加${what}，但現在加不成：${sound.issue}`
}

/** 這次會跑的每一步（重做的註明版本），加上用哪個模型、略過幾鏡、示範模式的說明。 */
export function runLines(plan: CanvasRunPlan): string[] {
  const models = [plan.models.image, plan.models.video].filter(
    (name): name is string => name !== undefined,
  )
  return [
    ...plan.steps.map((step) =>
      step.redo
        ? `${step.label}（重做${
            step.versions
              ? `：產生 v${String(step.versions.next)}，保留 v${String(step.versions.current)}`
              : ''
          }）`
        : step.label,
    ),
    ...(plan.sound ? [soundLine(plan.sound)] : []),
    ...(models.length > 0 && plan.shotCount > 0 ? [`用：${models.join('、')}`] : []),
    ...(plan.skippedBusy > 0 ? [`${String(plan.skippedBusy)} 個鏡頭正在生成，先略過`] : []),
    ...(plan.demoMode && plan.shotCount > 0 ? ['示範模式：不會真的花錢，結果是假的'] : []),
  ]
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
        title={`接成成品 · ${String(plan.segments)} 段 · 免費（在本機處理）`}
        lines={[]}
        costUsd={0}
        free
        okLabel="接成成品"
        onOk={onOk}
        onCancel={onCancel}
      />
    )
  }
  return (
    <RunConfirm
      anchor={anchor}
      count={plan.steps.length}
      lines={runLines(plan)}
      costUsd={plan.estimatedUsd}
      lowerBound={plan.estimateIsLowerBound}
      cachedNote={!redo}
      okLabel={okLabelOf(plan)}
      {...(onQuality && plan.shotCount > 0
        ? { extra: <QualitySwitch value={quality} onChange={onQuality} /> }
        : {})}
      onOk={onOk}
      onCancel={onCancel}
    />
  )
}
