import type { ShotView } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { diffDraft, draftOf } from './draft'

const shot: ShotView = {
  id: 's1',
  number: 1,
  description: '貓走在雨中',
  action: '',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: '貓走在雨中。日系動畫風格',
  status: 'done',
  firstFrames: [],
  videos: [],
}

describe('diffDraft', () => {
  it('沒改任何東西 → 沒有差異', () => {
    expect(diffDraft(shot, draftOf(shot))).toEqual({})
    expect(
      diffDraft({ ...shot, prompt: '手動的' }, draftOf({ ...shot, prompt: '手動的' })),
    ).toEqual({})
  })

  it('只回傳有改的欄位；描述前後空白不算改', () => {
    const draft = { ...draftOf(shot), description: '  貓走在雨中  ', durationSec: 5 }
    expect(diffDraft(shot, draft)).toEqual({ durationSec: 5 })
    expect(diffDraft(shot, { ...draftOf(shot), description: '貓坐在屋頂' })).toEqual({
      description: '貓坐在屋頂',
    })
  })

  it('運鏡清空 = 固定鏡頭（null）；填了就是新的運鏡', () => {
    const moving = { ...shot, cameraMove: '慢慢推近' }
    expect(diffDraft(moving, { ...draftOf(moving), cameraMove: '  ' })).toEqual({
      cameraMove: null,
    })
    expect(diffDraft(shot, { ...draftOf(shot), cameraMove: '向右搖' })).toEqual({
      cameraMove: '向右搖',
    })
  })

  it('Prompt：改成自己的 = 手動版本；改回自動組出的或清空 = 清掉手動修改', () => {
    expect(diffDraft(shot, { ...draftOf(shot), prompt: 'a cat in the rain' })).toEqual({
      prompt: 'a cat in the rain',
    })
    const manual = { ...shot, prompt: 'a cat in the rain' }
    expect(diffDraft(manual, { ...draftOf(manual), prompt: shot.autoPrompt })).toEqual({
      prompt: null,
    })
    expect(diffDraft(manual, { ...draftOf(manual), prompt: '   ' })).toEqual({ prompt: null })
  })
})
