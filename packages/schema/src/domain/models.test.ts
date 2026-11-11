import { describe, expect, it } from 'vitest'

import { AppError } from '../errors'
import { ModelCardSchema, alignVideoSeconds, estimateCostUsd, type ModelCard } from './models'

const base = {
  id: 'fal/kling-3.0',
  displayName: 'Kling 3.0',
  provider: 'fal',
  capabilities: ['t2v', 'i2v'],
  endpoints: { t2v: 'fal-ai/x/t2v', i2v: 'fal-ai/x/i2v' },
  tier: 'balanced',
  pricing: { unit: 'second', usd: 0.1, usdWithAudio: 0.15 },
  verification: { endpoint: false, pricing: false },
}

const card = (patch: Record<string, unknown> = {}): ModelCard =>
  ModelCardSchema.parse({ ...base, ...patch })

describe('ModelCardSchema', () => {
  it('補上預設值：需要 Key、狀態 active、非推薦', () => {
    expect(card()).toMatchObject({
      needsKey: true,
      status: 'active',
      recommended: false,
      resolutions: [],
      nativeAudio: false,
      characterMechanism: 'none',
      styleFit: 'both',
    })
  })

  it('每個能力都要有 endpoint，多餘的 endpoint 也不行', () => {
    expect(ModelCardSchema.safeParse({ ...base, endpoints: { t2v: 'a' } }).success).toBe(false)
    expect(
      ModelCardSchema.safeParse({ ...base, endpoints: { ...base.endpoints, edit: 'b' } }).success,
    ).toBe(false)
  })

  it('id 必須是「供應商/模型」；秒數範圍要合理；日期格式要對', () => {
    expect(ModelCardSchema.safeParse({ ...base, id: 'kling' }).success).toBe(false)
    expect(ModelCardSchema.safeParse({ ...base, durationSec: { min: 10, max: 5 } }).success).toBe(
      false,
    )
    expect(ModelCardSchema.safeParse({ ...base, sunsetDate: '2026/12/01' }).success).toBe(false)
    expect(card({ sunsetDate: '2026-12-01' }).sunsetDate).toBe('2026-12-01')
  })

  it('只收固定秒數的模型：steps 要落在 min～max 之間、由小到大、不能重複；沒寫 steps 就是範圍內任意秒數', () => {
    const withSteps = (steps: number[]) =>
      ModelCardSchema.safeParse({ ...base, durationSec: { min: 4, max: 8, steps } })
    expect(withSteps([4, 6, 8]).success).toBe(true)
    expect(withSteps([4, 9]).success).toBe(false) // 超出 max
    expect(withSteps([3, 6]).success).toBe(false) // 低於 min
    expect(withSteps([6, 4]).success).toBe(false) // 沒有由小到大
    expect(withSteps([4, 4, 8]).success).toBe(false) // 重複
    expect(withSteps([]).success).toBe(false)
    expect(ModelCardSchema.safeParse({ ...base, durationSec: { min: 3, max: 15 } }).success).toBe(
      true,
    )
  })

  it('宣稱已核對的 endpoint 或價格，一定要附日期與出處', () => {
    const verified = { endpoint: true, pricing: true }
    expect(ModelCardSchema.safeParse({ ...base, verification: verified }).success).toBe(false)
    expect(
      ModelCardSchema.safeParse({
        ...base,
        verification: { ...verified, checkedAt: '2026-10-12', source: 'https://fal.ai/models' },
      }).success,
    ).toBe(true)
  })

  it('價格單位不明或金額為負會被拒絕', () => {
    expect(ModelCardSchema.safeParse({ ...base, pricing: { unit: 'hour', usd: 1 } }).success).toBe(
      false,
    )
    expect(
      ModelCardSchema.safeParse({ ...base, pricing: { unit: 'image', usd: -1 } }).success,
    ).toBe(false)
  })
})

describe('estimateCostUsd', () => {
  it('影片依秒數計價，有聲才用有聲價', () => {
    const c = card()
    expect(estimateCostUsd(c, { seconds: 5 })).toBeCloseTo(0.5)
    expect(estimateCostUsd(c, { seconds: 5, audio: true })).toBeCloseTo(0.75)
    const noAudio = card({ pricing: { unit: 'second', usd: 0.3 } })
    expect(estimateCostUsd(noAudio, { seconds: 4, audio: true })).toBeCloseTo(1.2)
  })

  it('圖片、分鐘、字數、token 各自的計價', () => {
    expect(
      estimateCostUsd(card({ pricing: { unit: 'image', usd: 0.08 } }), { images: 3 }),
    ).toBeCloseTo(0.24)
    expect(
      estimateCostUsd(card({ pricing: { unit: 'minute', usd: 0.3 } }), { minutes: 2 }),
    ).toBeCloseTo(0.6)
    expect(
      estimateCostUsd(card({ pricing: { unit: 'million_chars', usd: 100 } }), { chars: 5000 }),
    ).toBeCloseTo(0.5)
    expect(
      estimateCostUsd(card({ pricing: { unit: 'million_tokens', inputUsd: 2, outputUsd: 10 } }), {
        inputTokens: 100_000,
        outputTokens: 20_000,
      }),
    ).toBeCloseTo(0.4)
  })

  it('缺少需要的用量欄位時丟錯，不會悄悄少算', () => {
    const units = [
      { unit: 'second', usd: 1 },
      { unit: 'image', usd: 1 },
      { unit: 'minute', usd: 1 },
      { unit: 'million_chars', usd: 1 },
      { unit: 'million_tokens', inputUsd: 1, outputUsd: 1 },
    ]
    for (const pricing of units) {
      expect(() => estimateCostUsd(card({ pricing }), {}), pricing.unit).toThrow(AppError)
    }
    expect(() => estimateCostUsd(card({ pricing: units[4] }), { inputTokens: 10 })).toThrow(/token/)
  })
})

describe('alignVideoSeconds：送給影片模型的秒數，取模型允許的、大於等於格長的最小值', () => {
  it('3～15 秒任選的模型：2.5 → 3、0.5 → 3（不低於最小）、剛好 3 → 3、整數不動', () => {
    const range = { min: 3, max: 15 }
    expect(alignVideoSeconds(range, 2.5)).toEqual({ sec: 3, clamped: false })
    expect(alignVideoSeconds(range, 0.5)).toEqual({ sec: 3, clamped: false })
    expect(alignVideoSeconds(range, 3)).toEqual({ sec: 3, clamped: false })
    expect(alignVideoSeconds(range, 7)).toEqual({ sec: 7, clamped: false })
    expect(alignVideoSeconds(range, 7.04)).toEqual({ sec: 8, clamped: false })
    // 浮點誤差不會多進一秒
    expect(alignVideoSeconds(range, 0.1 + 0.2 + 2.7)).toEqual({ sec: 3, clamped: false })
  })

  it('只收 4、6、8 的模型：2.5 → 4、5 → 6、6 → 6', () => {
    const range = { min: 4, max: 8, steps: [4, 6, 8] }
    expect(alignVideoSeconds(range, 2.5)).toEqual({ sec: 4, clamped: false })
    expect(alignVideoSeconds(range, 5)).toEqual({ sec: 6, clamped: false })
    expect(alignVideoSeconds(range, 6)).toEqual({ sec: 6, clamped: false })
  })

  it('超過最大值：用最大值，並標 clamped（呼叫的人要提醒）；只收固定秒數的模型也一樣', () => {
    expect(alignVideoSeconds({ min: 3, max: 15 }, 20)).toEqual({ sec: 15, clamped: true })
    expect(alignVideoSeconds({ min: 4, max: 8, steps: [4, 6, 8] }, 9)).toEqual({
      sec: 8,
      clamped: true,
    })
  })

  it('模型卡沒寫秒數範圍：進位到整數秒（跟送給供應商的整數秒一致），不夾', () => {
    expect(alignVideoSeconds(undefined, 2.5)).toEqual({ sec: 3, clamped: false })
    expect(alignVideoSeconds(undefined, 3)).toEqual({ sec: 3, clamped: false })
    expect(alignVideoSeconds(undefined, 0.2)).toEqual({ sec: 1, clamped: false })
  })
})
