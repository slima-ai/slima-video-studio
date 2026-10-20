import { describe, expect, it } from 'vitest'

import { guideText } from './tools/guides'

describe('getting-started 的估價說明', () => {
  it('estimate_cost 估四種：拆故事、拆鏡頭、首幀圖、影片；不再說圖片與影片沒有估價工具', () => {
    const text = guideText('getting-started', '')
    const item = text.split('\n').find((line) => line.startsWith('9.')) ?? ''
    for (const action of [
      'split_story_into_scenes',
      'split_scene_into_shots',
      'generate_first_frames',
      'generate_videos',
    ]) {
      expect(item, action).toContain(action)
    }
    expect(text).not.toContain('no estimate tool')
  })
})
