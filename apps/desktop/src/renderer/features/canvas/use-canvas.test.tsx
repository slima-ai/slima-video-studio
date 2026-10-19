import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { RELOAD_DELAY_MS, useCanvas } from './use-canvas'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const loads = (svs: ReturnType<typeof installFakeSvs>): number =>
  svs.calls.filter((c) => c.channel === 'canvas.get').length

describe('useCanvas', () => {
  it('生成中事件一直來：照固定間隔重新載入，不會一直延後到事件停下來（節點跟佇列同步）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    renderHook(() => useCanvas())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(loads(svs)).toBe(1)
    // 每 40ms 一個事件、持續 1 秒：等安靜下來才載入的話只會載入 1 次
    for (let t = 0; t < 1000; t += 40) {
      act(() => {
        svs.emit(t % 80 === 0 ? 'shots.changed' : 'queue.changed', {})
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40)
      })
    }
    const during = loads(svs) - 1
    expect(during).toBeGreaterThanOrEqual(Math.floor(1000 / RELOAD_DELAY_MS) - 1)
    expect(during).toBeLessThanOrEqual(Math.ceil(1000 / RELOAD_DELAY_MS) + 1)
  })

  it('同一段時間內的好幾個事件合併成一次載入', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    renderHook(() => useCanvas())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      svs.emit('shots.changed', {})
      svs.emit('canvas.changed', {})
      svs.emit('queue.changed', {})
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS + 10)
    })
    expect(loads(svs)).toBe(2)
  })
})
