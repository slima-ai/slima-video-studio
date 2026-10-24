import { describe, expect, it } from 'vitest'

import { secOfPixels, tickLabel, tickMarks, tickStep } from './timeline-math'

describe('秒數尺的刻度', () => {
  it('間隔隨片長變：37 秒的片子每 5 秒一格、3 分鐘的片子每 30 秒一格', () => {
    expect(tickStep(37.25)).toBe(5)
    expect(tickStep(12)).toBe(2)
    expect(tickStep(180)).toBe(30)
  })

  it('從 0 起、不超過片長，片長剛好落在刻度上也有那一格', () => {
    expect(tickMarks(37.25)).toEqual([0, 5, 10, 15, 20, 25, 30, 35])
    expect(tickMarks(10)).toEqual([0, 2, 4, 6, 8, 10])
    expect(tickMarks(0)).toEqual([])
  })

  it('不到一分鐘寫秒數，一分鐘以上寫分:秒', () => {
    expect(tickLabel(5, 37)).toBe('5')
    expect(tickLabel(65, 120)).toBe('1:05')
    expect(tickLabel(0, 120)).toBe('0:00')
  })

  it('像素換成秒數：整條 600 px 代表 30 秒時，60 px 是 3 秒；寬度 0 不除以 0', () => {
    expect(secOfPixels(60, 600, 30)).toBe(3)
    expect(secOfPixels(-30, 600, 30)).toBe(-1.5)
    expect(secOfPixels(10, 0, 30)).toBe(0)
  })
})
