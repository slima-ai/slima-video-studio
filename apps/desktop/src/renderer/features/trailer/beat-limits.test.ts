import { describe, expect, it } from 'vitest'

import { cardCount, narrationCount } from './beat-limits'

describe('字數上限', () => {
  it('旁白：中文每秒 4 個字，上限＝格長 × 4 無條件捨去；超過標 over', () => {
    expect(narrationCount('一二三四五六七八九十一', 3)).toEqual({
      n: 11,
      max: 12,
      chars: true,
      over: false,
    })
    expect(narrationCount('一二三四五六七八九十一二三', 3).over).toBe(true)
    expect(narrationCount('一二三四五', 1.4).max).toBe(5) // 1.4 × 4 ＝ 5.6 → 5
  })

  it('旁白：英文算單字，每秒 2.6 個', () => {
    expect(narrationCount('A bridge and a lamp', 3)).toEqual({
      n: 5,
      max: 7,
      chars: false,
      over: false,
    })
    expect(narrationCount('one two three four five six seven eight', 3).over).toBe(true)
  })

  it('字卡：中文 12 字、英文 6 個單字；標點不算', () => {
    expect(cardCount('有些光，要有人陪你一起守')).toEqual({
      n: 11,
      max: 12,
      chars: true,
      over: false,
    })
    expect(cardCount('一二三四五六七八九十一二三').over).toBe(true)
    expect(cardCount('Some light needs company').max).toBe(6)
  })
})
