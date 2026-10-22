import { loadBuiltinModelCards } from '@svs/providers'
import type { ModelCard, VideoRequest } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { withNegativePrompt } from './studio-services'

const cards = loadBuiltinModelCards()
const card = (id: string): ModelCard => {
  const found = cards.find((c) => c.id === id)
  if (!found) throw new Error(`找不到 ${id}`)
  return found
}

const request: VideoRequest = {
  capability: 'i2v',
  modelId: 'openrouter/kling-3.0-standard',
  prompt: '小饅頭向左跳一下',
  durationSec: 5,
  aspectRatio: '16:9',
  audio: false,
  referenceAssets: [],
}

describe('withNegativePrompt：影片請求的負面提示', () => {
  it('模型卡有負面提示、請求沒帶 → 用卡上內建的清單；OpenRouter 的卡一併帶實際供應商 slug', () => {
    const kling = card('openrouter/kling-3.0-standard')
    const sent = withNegativePrompt(request, kling)
    expect(sent.negativePrompt).toBe(kling.negativePrompt?.default)
    expect(sent.negativePromptRoute).toBe('atlas-cloud')
  })

  it('fal 的卡：有清單、沒有供應商 slug', () => {
    const sent = withNegativePrompt(request, card('fal/kling-3.0-standard'))
    expect(sent.negativePrompt).toContain('extra limbs')
    expect(sent).not.toHaveProperty('negativePromptRoute')
  })

  it('請求帶了使用者在設定頁改的清單 → 以它為準，不被內建的蓋掉', () => {
    const sent = withNegativePrompt(
      { ...request, negativePrompt: 'extra mouth only' },
      card('openrouter/kling-3.0-standard'),
    )
    expect(sent.negativePrompt).toBe('extra mouth only')
    expect(sent.negativePromptRoute).toBe('atlas-cloud')
  })

  it('模型不接受負面提示（卡上沒填、或查不到卡）→ 一律不送，就算請求裡有', () => {
    for (const model of [card('openrouter/kling-3.0-pro'), undefined]) {
      const sent = withNegativePrompt(
        { ...request, negativePrompt: 'mouth', negativePromptRoute: 'atlas-cloud' },
        model,
      )
      expect(sent).not.toHaveProperty('negativePrompt')
      expect(sent).not.toHaveProperty('negativePromptRoute')
      expect(sent.prompt).toBe(request.prompt)
    }
  })
})
