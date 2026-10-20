import { describe, expect, it } from 'vitest'

import { findFreeSpot } from './free-spot'

const size = { w: 220, h: 190 }

describe('findFreeSpot', () => {
  it('想放的地方是空的就放在那裡', () => {
    expect(findFreeSpot([], size, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 })
    expect(findFreeSpot([{ x: 1000, y: 1000, w: 220, h: 190 }], size, { x: 100, y: 100 })).toEqual({
      x: 100,
      y: 100,
    })
  })

  it('被佔住就挪到最近的空位，不跟任何一格疊在一起（留空隙）', () => {
    const blockers = [{ x: 100, y: 100, w: 220, h: 190 }]
    const spot = findFreeSpot(blockers, size, { x: 110, y: 110 })
    const box = { x: spot.x - 16, y: spot.y - 16, w: size.w + 32, h: size.h + 32 }
    const hit = blockers.some(
      (r) => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y,
    )
    expect(hit).toBe(false)
    expect(Math.hypot(spot.x - 110, spot.y - 110)).toBeLessThan(400)
  })

  it('一排被佔滿：連續放好幾個檔案，一個接一個找空位，彼此也不疊', () => {
    const avoid = [{ x: 0, y: 0, w: 1200, h: 190 }]
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < 4; i += 1) {
      const spot = findFreeSpot(avoid, size, { x: 60 + i * 240, y: 60 })
      placed.push(spot)
      avoid.push({ x: spot.x, y: spot.y, w: size.w, h: size.h })
    }
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const apart =
          a.x + size.w <= b.x || b.x + size.w <= a.x || a.y + size.h <= b.y || b.y + size.h <= a.y
        expect(apart).toBe(true)
      }
    }
  })
})
