import type { TakeView } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { trimHintOnAdopt } from './trim-hint'

const take = (id: string, extra: Partial<TakeView> = {}): TakeView => ({
  id,
  kind: 'video',
  version: 1,
  assetHash: 'a'.repeat(64),
  adopted: false,
  modelId: 'm',
  createdAt: '2026-10-24T00:00:00.000Z',
  videoSec: 5.041667,
  ...extra,
})

describe('換版本時的提示（不擋操作）', () => {
  it('上一版剪過、這一版是整支：提一句', () => {
    expect(trimHintOnAdopt(take('a', { trim: { outSec: 3.5 } }), take('b'))).toBe(
      '上一版剪到 0.0–3.5 秒，這一版是整支。',
    )
  })

  it('上一版剪過、這一版也有自己的裁切：兩邊都說', () => {
    expect(
      trimHintOnAdopt(
        take('a', { trim: { inSec: 1, outSec: 3.5 } }),
        take('b', { trim: { outSec: 4 } }),
      ),
    ).toBe('上一版剪到 1.0–3.5 秒，這一版有自己的裁切：0.0–4.0 秒。')
  })

  it('上一版沒剪、同一版、沒有版本：不提示', () => {
    expect(trimHintOnAdopt(take('a'), take('b'))).toBeUndefined()
    expect(trimHintOnAdopt(take('a', { trim: { outSec: 3 } }), take('a'))).toBeUndefined()
    expect(trimHintOnAdopt(undefined, take('b'))).toBeUndefined()
    expect(trimHintOnAdopt(take('a', { trim: { outSec: 3 } }), undefined)).toBeUndefined()
  })

  it('上一版只剪頭、沒給出點：出點用影片長度', () => {
    expect(trimHintOnAdopt(take('a', { trim: { inSec: 1 } }), take('b'))).toBe(
      '上一版剪到 1.0–5.042 秒，這一版是整支。',
    )
  })
})
