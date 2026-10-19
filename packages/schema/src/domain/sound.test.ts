import { describe, expect, it } from 'vitest'

import { DEFAULT_SOUND_SETTINGS, SoundClipSchema, SoundSettingsSchema } from './sound'

const base = {
  id: 'c1',
  assetHash: 'a'.repeat(64),
  modelId: 'openrouter/minimax-speech-2.8-hd',
  version: 1,
  createdAt: '2026-10-19T08:00:00.000Z',
}

describe('SoundClipSchema', () => {
  it('旁白、音效要屬於某一鏡；配樂不能屬於某一鏡', () => {
    expect(SoundClipSchema.safeParse({ ...base, kind: 'narration', shotId: 's1' }).success).toBe(
      true,
    )
    expect(SoundClipSchema.safeParse({ ...base, kind: 'narration' }).success).toBe(false)
    expect(SoundClipSchema.safeParse({ ...base, kind: 'sfx' }).success).toBe(false)
    expect(SoundClipSchema.safeParse({ ...base, kind: 'music' }).success).toBe(true)
    expect(SoundClipSchema.safeParse({ ...base, kind: 'music', shotId: 's1' }).success).toBe(false)
  })

  it('預設值：起點偏移 0、不是估價、沒有採用', () => {
    const clip = SoundClipSchema.parse({ ...base, kind: 'music' })
    expect(clip).toMatchObject({ offsetSec: 0, text: '', costEstimated: false, adopted: false })
  })
})

describe('SoundSettingsSchema', () => {
  it('預設全開：原聲開、旁白出現時壓低、配樂 −18 dB', () => {
    expect(DEFAULT_SOUND_SETTINGS).toEqual({
      nativeAudio: true,
      nativeGainDb: 0,
      muteNativeShotIds: [],
      duck: true,
      narrationGainDb: 0,
      musicGainDb: -18,
    })
  })

  it('增益超出範圍被拒絕', () => {
    expect(SoundSettingsSchema.safeParse({ musicGainDb: 100 }).success).toBe(false)
    expect(SoundSettingsSchema.safeParse({ nativeGainDb: -100 }).success).toBe(false)
  })
})
