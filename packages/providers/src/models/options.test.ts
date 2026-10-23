import type { Pricing } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { loadBuiltinModelCards } from './cards'
import { priceLabel, priceShort, providerName, toModelOption } from './options'

describe('priceLabel', () => {
  const cases: [Pricing, string][] = [
    [{ unit: 'image', usd: 0.08 }, '約 US$0.08／張'],
    [{ unit: 'second', usd: 0.112 }, '約 US$0.112／秒'],
    [{ unit: 'second', usd: 0.112, usdWithAudio: 0.168 }, '約 US$0.112／秒（有聲 US$0.168／秒）'],
    [{ unit: 'minute', usd: 0.5 }, '約 US$0.5／分鐘'],
    [{ unit: 'million_chars', usd: 10 }, '約 US$10／百萬字元'],
    [
      { unit: 'million_tokens', inputUsd: 3, outputUsd: 15 },
      '依用量計費（每百萬 token：輸入 US$3／輸出 US$15）',
    ],
    [{ unit: 'image', usd: 0 }, '免費（示範）'],
    [{ unit: 'second', usd: 0 }, '免費（示範）'],
    [{ unit: 'minute', usd: 0 }, '免費（示範）'],
    [{ unit: 'million_chars', usd: 0 }, '免費（示範）'],
    [{ unit: 'million_tokens', inputUsd: 0, outputUsd: 0 }, '免費（示範）'],
  ]
  it.each(cases)('%j → %s', (pricing, label) => {
    expect(priceLabel(pricing)).toBe(label)
  })
})

describe('priceShort', () => {
  const cases: [Pricing, string][] = [
    [{ unit: 'second', usd: 0.084 }, '每 5 秒約 US$0.42'],
    [{ unit: 'second', usd: 0.0112 }, '每 5 秒約 US$0.056'],
    [{ unit: 'image', usd: 0.08 }, '每張約 US$0.08'],
    [{ unit: 'image', usd: 0.04 }, '每張約 US$0.04'],
    [{ unit: 'minute', usd: 0.5 }, '每分鐘約 US$0.50'],
    [{ unit: 'million_chars', usd: 10 }, '每萬字約 US$0.10'],
    [{ unit: 'million_tokens', inputUsd: 3, outputUsd: 15 }, '依用量計費'],
    [{ unit: 'second', usd: 0 }, '免費（示範）'],
    [{ unit: 'million_tokens', inputUsd: 0, outputUsd: 0 }, '免費（示範）'],
  ]
  it.each(cases)('%j → %s', (pricing, label) => {
    expect(priceShort(pricing)).toBe(label)
  })
})

const BUILTIN_CARDS = loadBuiltinModelCards()

describe('toModelOption：負面提示的內建清單', () => {
  it('有 negativePrompt 的模型帶 negativePromptDefault，其他模型沒有這個欄位', () => {
    const cards = loadBuiltinModelCards()
    const kling = cards.find((c) => c.id === 'openrouter/kling-3.0-standard')
    const veo = cards.find((c) => c.id === 'openrouter/veo-3.1-lite')
    if (!kling || !veo) throw new Error('找不到模型卡')
    expect(toModelOption(kling).negativePromptDefault).toBe(kling.negativePrompt?.default)
    expect(toModelOption(veo)).not.toHaveProperty('negativePromptDefault')
  })
})

describe('providerName / toModelOption', () => {
  it('供應商顯示名稱', () => {
    expect(providerName('fal')).toBe('fal.ai')
    expect(providerName('openrouter')).toBe('OpenRouter')
    expect(providerName('mock')).toBe('示範')
    expect(providerName('other')).toBe('other')
  })

  it('每張內建卡都能轉成選項；示範模型標為免費，未核對價格標為估算', () => {
    for (const card of BUILTIN_CARDS) {
      const option = toModelOption(card)
      expect(option.id).toBe(card.id)
      expect(option.priceLabel.length).toBeGreaterThan(0)
      expect(option).not.toHaveProperty('endpoints')
    }
    const mock = BUILTIN_CARDS.find((c) => c.provider === 'mock')
    expect(mock && toModelOption(mock)).toMatchObject({
      providerName: '示範',
      priceLabel: '免費（示範，不會真的收費）',
      priceVerified: true,
    })
    const unverified = BUILTIN_CARDS.find((c) => c.id === 'fal/seedream-5.0')
    expect(unverified && toModelOption(unverified).priceVerified).toBe(false)
    const verified = BUILTIN_CARDS.find((c) => c.id === 'fal/nano-banana-2')
    expect(verified && toModelOption(verified).priceVerified).toBe(true)
  })
})

describe('toModelOption：漢字算多個計費單位的旁白模型', () => {
  it('MiniMax 的價格標中文實際的（每萬字 US$2.00，不是牌價的 1.00）；沒有權重的卡照牌價', () => {
    const cards = loadBuiltinModelCards()
    const minimax = cards.find((c) => c.id === 'openrouter/minimax-speech-2.8-hd')
    const eleven = cards.find((c) => c.id === 'openrouter/eleven-v3')
    if (!minimax || !eleven) throw new Error('找不到旁白卡')
    expect(toModelOption(minimax).priceShort).toBe('每萬字約 US$2.00')
    expect(toModelOption(minimax).priceLabel).toBe('約 US$200／百萬字元')
    expect(toModelOption(eleven).priceShort).toBe('每萬字約 US$0.40')
  })
})
