import { describe, expect, it } from 'vitest'

import { breakText } from './break-text'

const lengthOf = (line: string): number => (line.match(/[\p{L}\p{N}]/gu) ?? []).length

describe('breakText：自己斷行，不留孤字', () => {
  it('一行放得下就一行；空的沒有行', () => {
    expect(breakText('他回來了', { perLine: 9, maxLines: 3 })).toEqual(['他回來了'])
    expect(breakText('  ', { perLine: 9, maxLines: 3 })).toEqual([])
    expect(breakText('一二三四五六七八九十', { perLine: 9, maxLines: 1 })).toEqual([
      '一二三四五六七八九十',
    ])
  })

  it('比一行多一個字：平均分成兩行，不是 9＋1', () => {
    expect(breakText('一二三四五六七八九十', { perLine: 9, maxLines: 3 })).toEqual([
      '一二三四五',
      '六七八九十',
    ])
  })

  it('23 個字、每行放 11 個：三行，每一行都不少於 3 個字', () => {
    const text = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅'
    const lines = breakText(text, { perLine: 11, maxLines: 3 })
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(lengthOf(line)).toBeGreaterThanOrEqual(3)
    expect(lines.join('')).toBe(text)
  })

  it('優先在離正中間近的逗號斷開，行尾的逗號拿掉', () => {
    expect(breakText('有些光，要有人陪你一起守', { perLine: 9, maxLines: 2 })).toEqual([
      '有些光',
      '要有人陪你一起守',
    ])
  })

  it('不管長度怎麼組合：每一行都不少於 3 個字、行數不超過上限、字一個不少', () => {
    const base = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
    for (const perLine of [6, 9, 11, 12]) {
      for (let n = perLine + 1; n <= perLine * 3; n++) {
        const text = Array.from(base.repeat(3)).slice(0, n).join('')
        const lines = breakText(text, { perLine, maxLines: 3 })
        expect(lines.length, `${String(n)}/${String(perLine)}`).toBeLessThanOrEqual(3)
        for (const line of lines) expect(lengthOf(line), text).toBeGreaterThanOrEqual(3)
        expect(lines.join('')).toBe(text)
      }
    }
  })

  it('英文照單字斷、行與行的長度盡量平均；沒有孤字', () => {
    const lines = breakText('Some light, and someone to keep it with you', {
      perLine: 9,
      maxLines: 3,
    })
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.join(' ')).toBe('Some light, and someone to keep it with you')
    expect(lines.every((line) => line.split(' ').length >= 2)).toBe(true)
    expect(breakText('He is coming back', { perLine: 9, maxLines: 3 })).toEqual([
      'He is coming back',
    ])
  })
})
