import type { ShotView, TakeView } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { timeAgo } from '../../lib/usage'
import { cardUsage } from './card-usage'

const take = (extra: Partial<TakeView> = {}): TakeView => ({
  id: 't',
  kind: 'first_frame',
  version: 1,
  assetHash: 'a'.repeat(64),
  adopted: true,
  modelId: 'mock',
  createdAt: '2026-10-12T08:00:00.000Z',
  ...extra,
})

const shot = (extra: Partial<ShotView> = {}): ShotView => ({
  id: 's1',
  number: 1,
  description: '鏡頭',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: 'p',
  status: 'done',
  firstFrames: [],
  videos: [],
  ...extra,
})

describe('cardUsage', () => {
  it('還沒有畫面就沒有這一行', () => {
    expect(cardUsage(shot())).toBeUndefined()
  })

  it('用採用中的首幀圖；重新生成的預估是首幀圖加影片的花費', () => {
    const usage = cardUsage(
      shot({
        firstFrames: [
          take({ id: 'old', adopted: false, costUsd: 9 }),
          take({ durationMs: 3200, costUsd: 0.25, costEstimated: false }),
        ],
        videos: [take({ id: 'v', kind: 'video', costUsd: 0.5 })],
      }),
    )
    expect(usage).toEqual({
      createdAt: '2026-10-12T08:00:00.000Z',
      durationMs: 3200,
      costUsd: 0.25,
      costEstimated: false,
      regenerateUsd: 0.75,
    })
  })

  it('沒有花費紀錄（舊專案、匯入）：只有時間', () => {
    expect(cardUsage(shot({ firstFrames: [take()] }))).toEqual({
      createdAt: '2026-10-12T08:00:00.000Z',
    })
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z')
  it('剛剛、分鐘、小時、天', () => {
    expect(timeAgo('2026-10-12T11:59:30.000Z', now)).toBe('剛剛')
    expect(timeAgo('2026-10-12T11:55:00.000Z', now)).toBe('5 分鐘前')
    expect(timeAgo('2026-10-12T09:00:00.000Z', now)).toBe('3 小時前')
    expect(timeAgo('2026-10-10T12:00:00.000Z', now)).toBe('2 天前')
    expect(timeAgo('壞掉的時間', now)).toBe('剛剛')
  })
})
