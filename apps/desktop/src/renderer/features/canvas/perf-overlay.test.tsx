import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { frameStats, PerfOverlay } from './perf-overlay'

afterEach(cleanup)

describe('frameStats', () => {
  it('每 20 毫秒一格 → 50 fps，最慢一格 20 毫秒', () => {
    const times = Array.from({ length: 51 }, (_, i) => 1000 + i * 20)
    expect(frameStats(times)).toEqual({ fps: 50, worstMs: 20 })
  })

  it('中間卡了一格：平均下降、最慢一格是卡住那格', () => {
    expect(frameStats([0, 16, 32, 132, 148])).toEqual({ fps: 27, worstMs: 100 })
  })

  it('不到兩格量不出來：0', () => {
    expect(frameStats([])).toEqual({ fps: 0, worstMs: 0 })
    expect(frameStats([5])).toEqual({ fps: 0, worstMs: 0 })
  })
})

describe('PerfOverlay', () => {
  const props = {
    counts: { nodes: 12, edges: 9 },
    onSeeded: () => undefined,
    onClose: () => undefined,
  }

  it('顯示格子與線的數量；自動平移跑完顯示平均 fps 與是否達標', async () => {
    installFakeSvs({})
    const pan = vi.fn(() => Promise.resolve(Array.from({ length: 61 }, (_, i) => i * 16)))
    render(<PerfOverlay {...props} pan={pan} />)
    expect(screen.getByTestId('perf-counts').textContent).toBe('12 格、9 條線')
    fireEvent.click(screen.getByTestId('perf-pan'))
    expect(pan).toHaveBeenCalledWith(4000)
    const result = await screen.findByTestId('perf-pan-result')
    expect(result.textContent).toContain('62.5')
    expect(result.textContent).toContain('達到 50 fps 的目標')
  })

  it('沒到 50 fps：說明沒有獨立顯示卡的電腦數字會比較低', async () => {
    installFakeSvs({})
    render(
      <PerfOverlay
        {...props}
        pan={() => Promise.resolve(Array.from({ length: 11 }, (_, i) => i * 50))}
      />,
    )
    fireEvent.click(screen.getByTestId('perf-pan'))
    expect((await screen.findByTestId('perf-pan-result')).textContent).toContain('還沒到 50 fps')
  })

  it('產生示範專案要先確認；產生完通知畫布重新讀', async () => {
    const seedDemo = vi.fn(() =>
      Promise.resolve({
        project: { id: 'p2', name: '效能測試（250 鏡）', dir: '/tmp/p2', aspectRatio: '16:9' },
        shots: 250,
        ms: 1234,
      }),
    )
    installFakeSvs({ 'dev.seedDemo': seedDemo })
    const onSeeded = vi.fn()
    render(<PerfOverlay {...props} pan={() => Promise.resolve([])} onSeeded={onSeeded} />)
    fireEvent.click(screen.getByTestId('perf-seed'))
    expect(seedDemo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('perf-seed-ok'))
    await waitFor(() => {
      expect(onSeeded).toHaveBeenCalled()
    })
    expect(seedDemo).toHaveBeenCalledWith({ shots: 250 })
    expect(screen.getByTestId('perf-message').textContent).toContain('250 個鏡頭')
  })
})
