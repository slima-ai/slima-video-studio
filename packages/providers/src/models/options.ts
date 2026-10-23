import {
  KEY_PROVIDERS,
  cardText,
  type ModelCard,
  type ModelOption,
  type Pricing,
  t,
} from '@svs/schema'

const usd = (n: number): string => `US$${String(Number(n.toFixed(4)))}`

/** 白話價格。價格為 0（示範模型）顯示「免費」。 */
export function priceLabel(pricing: Pricing): string {
  switch (pricing.unit) {
    case 'second':
      if (pricing.usd === 0) return t('settings.freeDemo')
      return pricing.usdWithAudio === undefined
        ? t('settings.aboutSec', { value: usd(pricing.usd) })
        : t('settings.aboutSecSecWithSound', {
            value: usd(pricing.usd),
            value2: usd(pricing.usdWithAudio),
          })
    case 'image':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutImage', { value: usd(pricing.usd) })
    case 'track':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutTrack', { value: usd(pricing.usd) })
    case 'minute':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutMin', { value: usd(pricing.usd) })
    case 'million_chars':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.about1mCharacters', { value: usd(pricing.usd) })
    case 'million_tokens':
      return pricing.inputUsd === 0 && pricing.outputUsd === 0
        ? t('settings.freeDemo')
        : t('settings.payPerUsePer1m', {
            value: usd(pricing.inputUsd),
            value2: usd(pricing.outputUsd),
          })
  }
}

/** 簡短的金額：0.42、0.084、12（不顯示多餘的零）。 */
function usdShort(n: number): string {
  if (n >= 0.1) return `US$${n.toFixed(2)}`
  const text = n.toFixed(3).replace(/0$/, '')
  return `US$${text}`
}

/**
 * 一眼看懂的價格（選單上用）：影片「每 5 秒約…」、圖片「每張約…」、文字「依用量計費」。
 * 完整的單價（含有聲、每百萬 token）仍在 priceLabel，放在選單底下的說明。
 */
export function priceShort(pricing: Pricing): string {
  switch (pricing.unit) {
    case 'second':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutPer5Sec', { value: usdShort(pricing.usd * 5) })
    case 'image':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutPerImage', { value: usdShort(pricing.usd) })
    case 'track':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutPerTrack', { value: usdShort(pricing.usd) })
    case 'minute':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutPerMin', { value: usdShort(pricing.usd) })
    case 'million_chars':
      return pricing.usd === 0
        ? t('settings.freeDemo')
        : t('settings.aboutPer10000Characters', { value: usdShort(pricing.usd / 100) })
    case 'million_tokens':
      return pricing.inputUsd === 0 && pricing.outputUsd === 0
        ? t('settings.freeDemo')
        : t('settings.payPerUse')
  }
}

export function providerName(provider: string): string {
  if (provider === 'mock') return t('settings.demo')
  return KEY_PROVIDERS.find((p) => p.id === provider)?.name ?? provider
}

/**
 * ModelCard → 給設定頁顯示的選項（不含端點等內部資訊）。
 * channels 是同一個模型的所有管道（registry.channelsOf），用來列「也能走哪幾家」。
 */
export function toModelOption(
  card: ModelCard,
  channels: readonly ModelCard[] = [card],
): ModelOption {
  const text = cardText(card)
  // 依字元計價、而且漢字算多個單位的模型（MiniMax 是 2）：顯示中文旁白實際的價格，不要低估
  const pricing: Pricing =
    card.pricing.unit === 'million_chars' && card.cjkCharWeight !== undefined
      ? { ...card.pricing, usd: card.pricing.usd * card.cjkCharWeight }
      : card.pricing
  return {
    id: card.id,
    displayName: text.displayName,
    provider: card.provider,
    providerName: providerName(card.provider),
    capabilities: card.capabilities,
    tier: card.tier,
    recommended: card.recommended,
    priceLabel:
      card.provider === 'mock' ? t('settings.freeDemoNothingIsCharged') : priceLabel(pricing),
    priceShort: card.provider === 'mock' ? t('settings.freeDemo') : priceShort(pricing),
    priceVerified: card.verification.pricing || card.provider === 'mock',
    badges: text.badges,
    voices: text.voices,
    otherChannels: channels
      .filter((c) => c.provider !== card.provider)
      .map((c) => providerName(c.provider)),
    ...(card.notes ? { notes: card.notes } : {}),
    ...(text.userNote ? { userNote: text.userNote } : {}),
    ...(card.negativePrompt ? { negativePromptDefault: card.negativePrompt.default } : {}),
  }
}
