import { describe, expect, it } from 'vitest'

import { FIT_PADDING } from './canvas-model'
import { overflowViewport } from './fit-all'

const SCREEN = { width: 1440, height: 844 }

describe('overflowViewport', () => {
  it('縮到最小裝得下：照一般的全部顯示（undefined）', () => {
    expect(overflowViewport({ x: 0, y: 0, width: 3000, height: 2000 }, SCREEN, 0.1)).toBeUndefined()
  })

  it('裝不下（例如 250 鏡）：縮到最小、內容的左上角對齊上方列與節點面板的右下', () => {
    const view = overflowViewport({ x: 60, y: 90, width: 9000, height: 27_000 }, SCREEN, 0.1)
    expect(view).toEqual({ x: FIT_PADDING.left - 6, y: FIT_PADDING.top - 9, zoom: 0.1 })
  })

  it('只有寬度裝不下也算裝不下', () => {
    expect(overflowViewport({ x: 0, y: 0, width: 20_000, height: 100 }, SCREEN, 0.1)?.zoom).toBe(
      0.1,
    )
  })
})
