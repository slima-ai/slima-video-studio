import { describe, expect, it } from 'vitest'

import {
  beatIndexAt,
  cellFit,
  cellStarts,
  gridColumns,
  MIN_SEC_PX,
  segmentGroups,
  stripWidth,
} from './strip-math'

const beat = (durationSec: number, segment?: string) => ({
  durationSec,
  ...(segment === undefined ? {} : { segment }),
})

describe('腳本條的算術', () => {
  it('連續同一段的格子合成一塊，寬度是那幾格秒數的和；沒有段落的格子自成一塊', () => {
    const groups = segmentGroups([
      beat(3, 'hook'),
      beat(2.5, 'world'),
      beat(2.5, 'world'),
      beat(2),
      beat(4, 'title'),
    ])
    expect(groups.map((g) => [g.segment, g.from, g.count, g.sec])).toEqual([
      ['hook', 0, 1, 3],
      ['world', 1, 2, 5],
      [undefined, 3, 1, 2],
      ['title', 4, 1, 4],
    ])
  })

  it('同一段被別的段隔開就是兩塊（不跨過去合併）', () => {
    expect(segmentGroups([beat(1, 'a'), beat(1, 'b'), beat(1, 'a')])).toHaveLength(3)
  })

  it('格子寬度：夠寬放圖示＋縮圖＋秒數，窄一點只留圖示，再窄只留色塊', () => {
    expect(cellFit(120)).toBe('full')
    expect(cellFit(56)).toBe('full')
    expect(cellFit(30)).toBe('icon')
    expect(cellFit(22)).toBe('icon')
    expect(cellFit(10)).toBe('block')
  })

  it('30 秒整條塞進頁寬；60、90、120 秒每秒最少 14 px，超過就橫向捲', () => {
    expect(stripWidth(30, 900)).toBe(900)
    expect(stripWidth(60, 900)).toBe(900)
    expect(stripWidth(90, 900)).toBe(90 * MIN_SEC_PX)
    expect(stripWidth(120, 900)).toBe(1680)
  })

  it('欄寬照秒數分，最窄 6 px（0.67 秒的格子也點得到）', () => {
    expect(gridColumns([beat(2.5), beat(0.67)])).toBe('minmax(6px, 2500fr) minmax(6px, 670fr)')
  })

  it('每一格的開始時間，與播放到第幾秒是第幾格', () => {
    const beats = [beat(3), beat(2.5), beat(4.5)]
    expect(cellStarts(beats)).toEqual([0, 3, 5.5])
    expect(beatIndexAt(beats, 0)).toBe(0)
    expect(beatIndexAt(beats, 2.99)).toBe(0)
    expect(beatIndexAt(beats, 3)).toBe(1)
    expect(beatIndexAt(beats, 99)).toBe(2)
    expect(beatIndexAt([], 1)).toBe(-1)
  })
})
