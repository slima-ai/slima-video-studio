import type { ShotView } from '@svs/schema'

/** 測試用的鏡頭（預告片的一格）；沒給的欄位是一格還沒生成的影片格。 */
export function beat(number: number, patch: Partial<ShotView> = {}): ShotView {
  return {
    id: `s${String(number)}`,
    number,
    description: `第 ${String(number)} 格的畫面`,
    action: '',
    cameraMove: null,
    durationSec: 2,
    characters: [],
    size: 'medium',
    angle: 'eye_level',
    dialogue: '',
    autoPrompt: '',
    status: 'draft',
    firstFrames: [],
    videos: [],
    ...patch,
  }
}

export const take = (assetHash: string) => ({
  id: `t-${assetHash}`,
  kind: 'video' as const,
  version: 1,
  assetHash,
  adopted: true,
  modelId: 'm',
  createdAt: '2026-11-15T00:00:00.000Z',
})
