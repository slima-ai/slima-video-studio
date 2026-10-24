import { describe, expect, it } from 'vitest'

import {
  clampIn,
  clampOut,
  fmtSec,
  fmtSec1,
  frameAt,
  parseSec,
  secOfFrame,
  seekTimeOfFrame,
  snapSec,
} from './trim-math'

describe('剪裁的小算術', () => {
  it('fmtSec：最多三位小數、至少一位，沒有多餘的 0', () => {
    expect(fmtSec(3.5)).toBe('3.5')
    expect(fmtSec(5)).toBe('5.0')
    expect(fmtSec(5.041667)).toBe('5.042')
    expect(fmtSec(0)).toBe('0.0')
    expect(fmtSec(1.25)).toBe('1.25')
    expect(fmtSec1(3.5)).toBe('3.5')
    expect(fmtSec1(5.041667)).toBe('5.0')
  })

  it('parseSec：只收非負的十進位數字；空白、字母、負數、兩個小數點都不收', () => {
    expect(parseSec('3.5')).toBe(3.5)
    expect(parseSec(' 3 ')).toBe(3)
    expect(parseSec('.5')).toBe(0.5)
    expect(parseSec('0')).toBe(0)
    for (const bad of ['', ' ', 'abc', '-1', '1.2.3', '3,5', '1e3', '3秒']) {
      expect(parseSec(bad), bad).toBeUndefined()
    }
  })

  it('frameAt／secOfFrame：播放位置在第幾格，來回對得上；83.9999 不會被當成第 83 格', () => {
    expect(frameAt(3.5, 24)).toBe(84)
    expect(frameAt(83.9999 / 24, 24)).toBe(84)
    expect(frameAt(0, 24)).toBe(0)
    expect(secOfFrame(84, 24)).toBe(3.5)
    // 移到第 n 格時放在格子裡面（過 1/4 格），frameAt 仍然算回第 n 格
    for (const n of [0, 1, 83, 84, 120]) {
      expect(frameAt(seekTimeOfFrame(n, 24), 24)).toBe(n)
    }
  })

  it('snapSec：對齊到最近一格，沒有浮點雜訊', () => {
    expect(snapSec(3.51, 24)).toBe(3.5)
    expect(snapSec(3.53, 24)).toBe(3.541667)
    expect(snapSec(0.01, 24)).toBe(0)
  })

  it('clampIn／clampOut：入點不能到出點、出點不能早過入點，也不能超過影片長度；至少留一格', () => {
    expect(clampIn(4, 3.5, 24)).toBeCloseTo(3.5 - 1 / 24, 6)
    expect(clampIn(-1, 3.5, 24)).toBe(0)
    expect(clampIn(1, 3.5, 24)).toBe(1)
    expect(clampOut(0.5, 1, 5, 24)).toBeCloseTo(1 + 1 / 24, 6)
    expect(clampOut(9, 1, 5, 24)).toBe(5)
    expect(clampOut(3.5, 1, 5, 24)).toBe(3.5)
  })
})
