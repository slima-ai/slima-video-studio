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

  it('出場角色的特徵（negativeExtra）接在通用清單後面，相同的詞只留一個；內部欄位不會送出去', () => {
    const kling = card('openrouter/kling-3.0-standard')
    const sent = withNegativePrompt(
      { ...request, negativeExtra: 'mouth, Extra Faces, arms' },
      kling,
    )
    expect(sent.negativePrompt?.endsWith(', mouth, arms')).toBe(true)
    expect(
      sent.negativePrompt?.startsWith(kling.negativePrompt?.default.split(',')[0] ?? '?'),
    ).toBe(true)
    // 通用清單裡已經有 extra faces，不重複
    expect(
      sent.negativePrompt
        ?.toLowerCase()
        .split(', ')
        .filter((t) => t === 'extra faces'),
    ).toHaveLength(1)
    expect(sent).not.toHaveProperty('negativeExtra')
    // 使用者改過的清單也一樣，後面接角色的
    const custom = withNegativePrompt(
      { ...request, negativePrompt: 'blur', negativeExtra: 'mouth' },
      kling,
    )
    expect(custom.negativePrompt).toBe('blur, mouth')
    // 沒有角色特徵：和只有通用清單一樣
    expect(withNegativePrompt(request, kling).negativePrompt).toBe(kling.negativePrompt?.default)
  })

  it('模型不接受負面提示 → 角色的特徵也不送', () => {
    const sent = withNegativePrompt(
      { ...request, negativeExtra: 'mouth, arms' },
      card('openrouter/kling-3.0-pro'),
    )
    expect(sent).not.toHaveProperty('negativeExtra')
    expect(sent).not.toHaveProperty('negativePrompt')
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
