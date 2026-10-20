import { describe, expect, it } from 'vitest'

import { followPan } from './ai-follow'
import type { CanvasNode } from './canvas-model'

const shot = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: 'card',
  position: { x, y },
  data: { kind: 'shot', title: id },
})

const SIZE = { width: 1440, height: 800 }
const MARGIN = { top: 80, left: 260, right: 48, bottom: 48 }

describe('followPan：AI 動了哪裡，畫面要平移到哪', () => {
  it('已經看得到就不動', () => {
    expect(
      followPan({ x: 0, y: 0, zoom: 1 }, SIZE, [shot('a', 400, 200)], ['a'], MARGIN),
    ).toBeUndefined()
  })

  it('在畫面外：只平移（不改縮放）到看得見', () => {
    const pan = followPan({ x: 0, y: 0, zoom: 1 }, SIZE, [shot('a', 3000, 200)], ['a'], MARGIN)
    expect(pan).toBeDefined()
    // 節點右緣（3000 + 230）平移後要落在右邊界內
    expect((pan?.x ?? 0) + 3230).toBeLessThanOrEqual(SIZE.width - MARGIN.right)
    expect(pan?.y).toBe(0)
  })

  it('動了好幾個、放得進畫面：讓全部都看得到', () => {
    const pan = followPan(
      { x: 0, y: 0, zoom: 1 },
      SIZE,
      [shot('a', 2000, 200), shot('b', 2400, 200)],
      ['a', 'b'],
      MARGIN,
    )
    expect((pan?.x ?? 0) + 2000).toBeGreaterThanOrEqual(MARGIN.left)
    expect((pan?.x ?? 0) + 2400 + 230).toBeLessThanOrEqual(SIZE.width - MARGIN.right)
  })

  it('放不下（一次改了很多）：只帶最上面最左邊那一個進來', () => {
    const pan = followPan(
      { x: 0, y: 0, zoom: 1 },
      SIZE,
      [shot('far', 9000, 5000), shot('first', 3000, 100)],
      ['far', 'first'],
      MARGIN,
    )
    expect((pan?.x ?? 0) + 3000).toBeGreaterThanOrEqual(MARGIN.left)
    expect((pan?.x ?? 0) + 3230).toBeLessThanOrEqual(SIZE.width - MARGIN.right)
  })

  it('節點還沒讀回畫面：不動', () => {
    expect(
      followPan({ x: 0, y: 0, zoom: 1 }, SIZE, [shot('a', 3000, 0)], ['zzz'], MARGIN),
    ).toBeUndefined()
  })
})
