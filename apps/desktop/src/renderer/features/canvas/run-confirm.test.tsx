import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunConfirm, placeConfirm, shiftAnchor } from './run-confirm'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const view = { width: 1400, height: 900 }
const size = { width: 340, height: 300 }
const button = (left: number, top: number) => ({
  left,
  right: left + 30,
  top,
  bottom: top + 30,
})
const overlaps = (
  a: { left: number; top: number },
  b: { left: number; top: number; width: number; height: number },
): boolean =>
  a.left < b.left + b.width &&
  a.left + size.width > b.left &&
  a.top < b.top + b.height &&
  a.top + size.height > b.top

describe('確認面板放哪裡', () => {
  it('預設貼在按鈕右邊，垂直對齊按鈕中間', () => {
    expect(placeConfirm(button(400, 400), size, view)).toEqual({ left: 442, top: 265 })
  })

  it('右邊放不下就放左邊；都貼著按鈕，不會跑到畫面另一頭', () => {
    const at = placeConfirm(button(1250, 400), size, view)
    expect(at.left).toBe(1250 - 12 - 340)
  })

  it('靠近視窗上緣（例如上方列的「全部生成」）：收進視窗，不超出去', () => {
    const at = placeConfirm(button(1300, 10), size, view)
    expect(at.top).toBeGreaterThanOrEqual(12)
    expect(at.left + size.width).toBeLessThanOrEqual(1300)
  })

  it('右邊會蓋住被標亮的格子：換到不會蓋到的那一邊', () => {
    const glow = { left: 440, top: 200, width: 230, height: 400 }
    const at = placeConfirm(button(400, 400), size, view, [glow])
    expect(overlaps(at, glow)).toBe(false)
    expect(at.left + size.width).toBeLessThanOrEqual(400)
  })

  it('四周都有標亮的格子：選蓋得最少的位置，仍然貼著按鈕', () => {
    const glows = [
      { left: 440, top: 0, width: 400, height: 900 },
      { left: 0, top: 0, width: 390, height: 900 },
    ]
    const at = placeConfirm(button(400, 400), size, view, glows)
    expect(Math.abs(at.left - 400)).toBeLessThan(400)
  })
})

describe('畫面平移後面板貼到按鈕現在的位置', () => {
  const anchor = { left: 100, right: 120, top: 200, bottom: 220 }

  it('格子上的 ▶ 跟著畫面移動', () => {
    expect(shiftAnchor({ ...anchor, onCanvas: true }, { dx: 63, dy: -10 })).toEqual({
      left: 163,
      right: 183,
      top: 190,
      bottom: 210,
      onCanvas: true,
    })
  })

  it('上方列的按鈕不動', () => {
    expect(shiftAnchor(anchor, { dx: 63, dy: -10 })).toBe(anchor)
  })
})

describe('RunConfirm：清單與「用什麼、多少錢」', () => {
  const anchor = { left: 400, right: 430, top: 400, bottom: 430 }
  const open = (lines: string[], pinnedLines: string[] = ['用：示範圖片、示範影片']) =>
    render(
      <RunConfirm
        anchor={anchor}
        count={lines.length}
        lines={lines}
        pinnedLines={pinnedLines}
        costUsd={1.23}
        onOk={() => undefined}
        onCancel={() => undefined}
      />,
    )
  /** jsdom 沒有排版：用假的高度讓清單「放不下」。 */
  const overflowing = (scrollHeight: number, clientHeight: number): void => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
  }

  it('用哪個模型那幾行在清單外面（不跟著捲動），價錢也在清單外面', () => {
    open(['第 1 步', '第 2 步'])
    const steps = screen.getByTestId('run-confirm-steps')
    const pinned = screen.getByTestId('run-confirm-pinned')
    expect(steps.contains(pinned)).toBe(false)
    expect(pinned.textContent).toContain('用：示範圖片、示範影片')
    expect(steps.textContent).not.toContain('用：')
    expect(screen.getByTestId('run-confirm').textContent).toContain('US$1.23')
  })

  it('清單放得下：沒有「往下還有」的提示', () => {
    overflowing(100, 100)
    open(['第 1 步'])
    expect(screen.queryByTestId('run-confirm-more')).toBeNull()
    expect(screen.getByTestId('run-confirm-steps').getAttribute('data-more')).toBe('false')
  })

  it('清單太長要捲動：看得出下面還有東西（提示字），價錢與模型那行照樣在', () => {
    overflowing(900, 320)
    open(Array.from({ length: 60 }, (_, i) => `第 ${String(i + 1)} 步`))
    expect(screen.getByTestId('run-confirm-more').textContent).toContain('往下還有')
    expect(screen.getByTestId('run-confirm-steps').getAttribute('data-more')).toBe('true')
    expect(screen.getByTestId('run-confirm-pinned').textContent).toContain('用：')
    expect(screen.getByTestId('run-confirm').textContent).toContain('US$1.23')
  })

  it('沒有清單、沒有固定行：都不畫', () => {
    open([], [])
    expect(screen.queryByTestId('run-confirm-steps')).toBeNull()
    expect(screen.queryByTestId('run-confirm-pinned')).toBeNull()
  })
})
