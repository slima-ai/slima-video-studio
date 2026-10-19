import { describe, expect, it } from 'vitest'

import { makePng } from './png'

describe('makePng', () => {
  it('產生合法的 PNG 檔頭與指定尺寸', () => {
    const png = makePng({ width: 16, height: 8 })
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(16)
    expect(png.readUInt32BE(20)).toBe(8)
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND')
  })

  it('不同顏色得到不同內容', () => {
    expect(makePng({ color: [1, 2, 3] }).equals(makePng({ color: [4, 5, 6] }))).toBe(false)
  })
})
