import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RunEstimate, RunScope } from './canvas-actions'
import { estimateText } from './nodes'
import { RunModeMenu } from './run-mode-menu'

afterEach(cleanup)

const anchor = { left: 400, right: 420, top: 200, bottom: 220 }
const estimateOf =
  (table: Partial<Record<RunScope, RunEstimate>>) =>
  (scope: RunScope): Promise<RunEstimate | undefined> =>
    Promise.resolve(table[scope])

describe('RunModeMenu：▶ 旁的「只跑這個／這個和後面的／整條」', () => {
  it('影片：三列，各寫會做什麼與預估花費；選了就交出範圍', async () => {
    const onPick = vi.fn()
    render(
      <RunModeMenu
        kind="video"
        anchor={anchor}
        estimate={estimateOf({
          this: { usd: 0.42, lowerBound: false, nothing: false },
          'from-here': { usd: 0.42, lowerBound: false, nothing: false },
          chain: { usd: 0.55, lowerBound: true, nothing: false },
        })}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'))).toEqual([
      'run-mode-this',
      'run-mode-from-here',
      'run-mode-chain',
    ])
    await waitFor(() => {
      expect(screen.getByTestId('run-mode-chain').textContent).toContain('約 US$0.55（至少）')
    })
    expect(screen.getByTestId('run-mode-this').textContent).toContain('只重做這支影片')
    expect(screen.getByTestId('run-mode-from-here').textContent).toContain('再接成品')
    fireEvent.click(screen.getByTestId('run-mode-from-here'))
    expect(onPick).toHaveBeenCalledWith('from-here')
  })

  it('圖：只有「只跑這個」「這個和後面的」兩列（整條對圖就是這個和後面的）', () => {
    render(
      <RunModeMenu
        kind="image"
        anchor={anchor}
        estimate={estimateOf({})}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.queryByTestId('run-mode-chain')).toBeNull()
  })

  it('還不能跑的那一列灰掉、寫原因、點了不會選；Esc 收起來', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(
      <RunModeMenu
        kind="video"
        anchor={anchor}
        estimate={estimateOf({
          this: {
            usd: 0,
            lowerBound: false,
            nothing: false,
            issue: '還不能跑：先要有第一張畫面。',
          },
          'from-here': { usd: 0.1, lowerBound: false, nothing: false },
          chain: { usd: 0.2, lowerBound: false, nothing: false },
        })}
        onPick={onPick}
        onClose={onClose}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('run-mode-issue').textContent).toContain('先要有第一張畫面')
    })
    fireEvent.click(screen.getByTestId('run-mode-this'))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByTestId('run-mode-this').getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('estimateText：▶ 滑過的預估', () => {
  it('約多少錢、至少、都生成好了、為什麼還不能跑', () => {
    expect(estimateText({ usd: 0.126, lowerBound: false, nothing: false })).toBe('預估約 US$0.13')
    expect(estimateText({ usd: 1, lowerBound: true, nothing: false })).toBe(
      '預估約 US$1.00（至少）',
    )
    expect(estimateText({ usd: 0, lowerBound: false, nothing: true })).toBe('都已經生成好了')
    expect(estimateText({ usd: 0, lowerBound: false, nothing: false, issue: '還不能跑：x' })).toBe(
      '還不能跑：x',
    )
  })
})
