import {
  PICKABLE_CAPABILITIES,
  type ModelOption,
  type ModelTier,
  type PickableCapability,
} from '@svs/schema'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'

import { Badge, type BadgeTone } from '../../components/badge'
import { Button } from '../../components/button'
import { EmptyState } from '../../components/empty-state'
import { ListSelect, type ListOption } from '../../components/list-select'
import { Section } from '../../components/section'
import { call, errorText } from '../../lib/svs'

export interface ModelsSectionProps {
  models: ModelOption[]
  /** 每種用途現在實際會用的模型。 */
  selected: Partial<Record<PickableCapability, string>>
  /** 每個旁白模型現在用的聲音。 */
  voices?: Record<string, string>
  /** 還沒填金鑰、不能用的模型：選單上灰色，寫要填哪家的金鑰。 */
  locked?: ModelOption[]
  onChanged: () => void
  /** 沒有可選的模型時，帶使用者去填金鑰。 */
  onGoToKeys: () => void
}

export const LABELS: Record<PickableCapability, { title: string; hint: string }> = {
  llm: { title: '文字', hint: '把故事分成幾個畫面、寫畫面描述' },
  t2i: { title: '圖片', hint: '每個鏡頭的第一張畫面' },
  i2v: { title: '影片', hint: '讓畫面動起來' },
  tts: { title: '旁白', hint: '把每個鏡頭的台詞念出來' },
  music: { title: '配樂', hint: '整支片子的背景音樂' },
}

/** 由貴到便宜排；同一等級照原本的順序。 */
const TIERS: { tier: ModelTier; label: string; tone: BadgeTone }[] = [
  { tier: 'premium', label: '高品質', tone: 'premium' },
  { tier: 'balanced', label: '平衡', tone: 'info' },
  { tier: 'budget', label: '經濟實惠', tone: 'success' },
]

/**
 * 一個選項：等級色塊、名稱、推薦小標，價格靠右；價格還沒跟官方核對過的標「估算」。
 * 還沒解鎖的模型在價格前寫「需要 fal.ai 金鑰」。
 */
function OptionContent({ model, recommended }: { model: ModelOption; recommended: boolean }) {
  const tier = TIERS.find((t) => t.tier === model.tier)
  return (
    <span className="flex items-center gap-2">
      {tier ? <Badge tone={tier.tone}>{tier.label}</Badge> : null}
      <span className="min-w-0 truncate">{model.displayName}</span>
      {recommended ? <Badge tone="warning">推薦</Badge> : null}
      {model.needsKey ? (
        <span className="shrink-0 text-xs text-fg-muted">需要 {model.needsKey} 金鑰</span>
      ) : null}
      {model.badges.map((badge) => (
        <Badge key={badge} tone="neutral">
          {badge}
        </Badge>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {model.priceVerified ? null : <Badge tone="neutral">估算</Badge>}
        <span className="text-xs text-fg-muted" title={model.priceLabel}>
          {model.priceShort}
        </span>
      </span>
    </span>
  )
}

/** 走哪一家：同一個模型好幾家都有時，會自動選便宜的那家。 */
export function channelText(model: ModelOption): string {
  if (model.otherChannels.length === 0) return `透過 ${model.providerName}`
  return `透過 ${model.providerName}（${model.otherChannels.join('、')} 也有，會自動走比較便宜的那家）`
}

/** 沒選時挑預設的順序（跟主行程 SettingsService.resolveModel 一樣）：平衡、高品質、經濟實惠。 */
const DEFAULT_ORDER: readonly ModelTier[] = ['balanced', 'premium', 'budget']

/**
 * 每種用途只推薦一個：就是沒選時實際會用的那個（依平衡、高品質、經濟實惠的順序，第一個標了推薦的）。
 * 資料裡同一種用途可能有好幾個模型標推薦，全部亮出來就等於沒推薦。
 */
export function toOptions(models: ModelOption[], locked: ModelOption[] = []): ListOption[] {
  const recommendedId = DEFAULT_ORDER.flatMap((tier) => models.filter((m) => m.tier === tier)).find(
    (m) => m.recommended,
  )?.id
  const usable = TIERS.flatMap(({ tier }) => models.filter((m) => m.tier === tier)).map(
    (model): ListOption => {
      const recommended = model.id === recommendedId
      return {
        value: model.id,
        label: `${model.displayName}${recommended ? '（推薦）' : ''}・${model.priceShort}${
          model.priceVerified ? '' : '（估算）'
        }`,
        content: <OptionContent model={model} recommended={recommended} />,
      }
    },
  )
  // 還沒解鎖的排在最後、灰色、不能選（讓人知道加一把金鑰能多用哪些）
  const grey = TIERS.flatMap(({ tier }) => locked.filter((m) => m.tier === tier)).map(
    (model): ListOption => ({
      value: model.id,
      label: `${model.displayName}・需要 ${model.needsKey ?? ''} 金鑰`,
      content: <OptionContent model={model} recommended={false} />,
      disabled: true,
    }),
  )
  return [...usable, ...grey]
}

/** 「填 fal.ai 的金鑰還能用：Nano Banana 2、Seedream 5.0 Lite」。 */
export function unlockText(locked: readonly ModelOption[]): string | undefined {
  if (locked.length === 0) return undefined
  const byKey = new Map<string, string[]>()
  for (const model of locked) {
    const key = model.needsKey ?? ''
    byKey.set(key, [...(byKey.get(key) ?? []), model.displayName])
  }
  return [...byKey].map(([key, names]) => `填 ${key} 的金鑰還能用：${names.join('、')}`).join('；')
}

/** 每種用途選一個模型。沒選就用推薦的；選單裡只有「已填金鑰」的服務（或示範模式）。 */
export function ModelsSection({
  models,
  selected,
  voices = {},
  locked = [],
  onChanged,
  onGoToKeys,
}: ModelsSectionProps) {
  const [error, setError] = useState<string | undefined>()

  const chooseVoice = (modelId: string, voiceId: string): void => {
    setError(undefined)
    call('settings.update', { audio: { voices: { [modelId]: voiceId } } })
      .then(onChanged)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  const choose = (capability: PickableCapability, id: string): void => {
    setError(undefined)
    call('settings.update', { models: { [capability]: id } })
      .then(onChanged)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <Section
      testId="models-section"
      title="使用的模型"
      description="所有專案預設用這些，不確定的話保持預設就好。標「估算」的價格還沒有跟官方核對過，實際以服務商帳單為準。"
    >
      {models.length === 0 ? (
        <EmptyState
          testId="models-empty"
          icon={KeyRound}
          message="還沒有可以選的模型。填入 OpenRouter 的金鑰就能開始（只填這一把就夠），或打開下面的「示範模式」先試玩。"
          action={
            <Button variant="primary" onClick={onGoToKeys}>
              去填金鑰
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {PICKABLE_CAPABILITIES.map((capability) => {
            const candidates = models.filter((m) => m.capabilities.includes(capability))
            const greyed = locked.filter((m) => m.capabilities.includes(capability))
            const unlock = unlockText(greyed)
            const current = selected[capability]
            const detail = candidates.find((m) => m.id === current)
            return (
              <div key={capability}>
                <label className="block text-sm font-medium" htmlFor={`model-${capability}`}>
                  {LABELS[capability].title}
                  <span className="ml-2 font-normal text-fg-muted">{LABELS[capability].hint}</span>
                </label>
                {candidates.length === 0 ? (
                  <div className="mt-1 flex items-center gap-3 text-sm text-fg-muted">
                    <span>
                      目前沒有可用的{LABELS[capability].title}模型，請先填入對應服務的金鑰。
                    </span>
                    <Button size="sm" variant="secondary" onClick={onGoToKeys}>
                      去填金鑰
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1">
                    <ListSelect
                      id={`model-${capability}`}
                      testId={`model-${capability}`}
                      value={current}
                      options={toOptions(candidates, greyed)}
                      onChange={(id) => {
                        choose(capability, id)
                      }}
                    />
                    {detail ? (
                      <p
                        className="mt-1 text-xs text-fg-muted"
                        data-testid={`model-${capability}-channel`}
                      >
                        {channelText(detail)}
                      </p>
                    ) : null}
                    {capability === 'tts' && detail && detail.voices.length > 0 ? (
                      <div className="mt-2 flex items-center gap-3">
                        <label className="text-sm" htmlFor="voice-tts">
                          聲音
                        </label>
                        <div className="min-w-0 flex-1">
                          <ListSelect
                            id="voice-tts"
                            testId="voice-tts"
                            value={voices[detail.id] ?? detail.voices[0]?.id}
                            options={detail.voices.map((voice): ListOption => ({
                              value: voice.id,
                              label: voice.label,
                              content: <span>{voice.label}</span>,
                            }))}
                            onChange={(voiceId) => {
                              chooseVoice(detail.id, voiceId)
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {detail?.notes ? (
                      <p
                        className="mt-1 text-xs text-fg-muted"
                        data-testid={`model-${capability}-detail`}
                      >
                        {detail.notes}
                      </p>
                    ) : null}
                    {unlock ? (
                      <p
                        className="mt-1 flex items-center gap-2 text-xs text-fg-muted"
                        data-testid={`model-${capability}-unlock`}
                      >
                        <span>{unlock}</span>
                        <button
                          type="button"
                          className="shrink-0 text-accent hover:underline"
                          onClick={onGoToKeys}
                        >
                          去填金鑰
                        </button>
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
