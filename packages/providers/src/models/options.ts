import { KEY_PROVIDERS, type ModelCard, type ModelOption, type Pricing } from '@svs/schema'

const usd = (n: number): string => `US$${String(Number(n.toFixed(4)))}`

/** 白話價格。價格為 0（示範模型）顯示「免費」。 */
export function priceLabel(pricing: Pricing): string {
  switch (pricing.unit) {
    case 'second':
      if (pricing.usd === 0) return '免費（示範）'
      return pricing.usdWithAudio === undefined
        ? `約 ${usd(pricing.usd)}／秒`
        : `約 ${usd(pricing.usd)}／秒（有聲 ${usd(pricing.usdWithAudio)}／秒）`
    case 'image':
      return pricing.usd === 0 ? '免費（示範）' : `約 ${usd(pricing.usd)}／張`
    case 'minute':
      return pricing.usd === 0 ? '免費（示範）' : `約 ${usd(pricing.usd)}／分鐘`
    case 'million_chars':
      return pricing.usd === 0 ? '免費（示範）' : `約 ${usd(pricing.usd)}／百萬字元`
    case 'million_tokens':
      return pricing.inputUsd === 0 && pricing.outputUsd === 0
        ? '免費（示範）'
        : `依用量計費（每百萬 token：輸入 ${usd(pricing.inputUsd)}／輸出 ${usd(pricing.outputUsd)}）`
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
      return pricing.usd === 0 ? '免費（示範）' : `每 5 秒約 ${usdShort(pricing.usd * 5)}`
    case 'image':
      return pricing.usd === 0 ? '免費（示範）' : `每張約 ${usdShort(pricing.usd)}`
    case 'minute':
      return pricing.usd === 0 ? '免費（示範）' : `每分鐘約 ${usdShort(pricing.usd)}`
    case 'million_chars':
      return pricing.usd === 0 ? '免費（示範）' : `每萬字約 ${usdShort(pricing.usd / 100)}`
    case 'million_tokens':
      return pricing.inputUsd === 0 && pricing.outputUsd === 0 ? '免費（示範）' : '依用量計費'
  }
}

export function providerName(provider: string): string {
  if (provider === 'mock') return '示範'
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
  return {
    id: card.id,
    displayName: card.displayName,
    provider: card.provider,
    providerName: providerName(card.provider),
    capabilities: card.capabilities,
    tier: card.tier,
    recommended: card.recommended,
    priceLabel: card.provider === 'mock' ? '免費（示範，不會真的收費）' : priceLabel(card.pricing),
    priceShort: card.provider === 'mock' ? '免費（示範）' : priceShort(card.pricing),
    priceVerified: card.verification.pricing || card.provider === 'mock',
    badges: card.badges,
    otherChannels: channels
      .filter((c) => c.provider !== card.provider)
      .map((c) => providerName(c.provider)),
    ...(card.notes ? { notes: card.notes } : {}),
  }
}
