import type { CanvasAiChanged } from '@svs/schema'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { useAiMarks } from './use-ai-marks'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const removed = (key: string, title: string, empty = true): CanvasAiChanged['removed'][number] => ({
  key,
  title,
  kind: 'shot',
  empty,
})
const event = (...nodes: CanvasAiChanged['removed']): CanvasAiChanged => ({
  at: '2026-10-21T00:00:00.000Z',
  channel: 'shots.delete',
  changed: [],
  added: [],
  removed: nodes,
})

describe('useAiMarks：AI 刪了東西的提示', () => {
  it('同一輪連著刪好幾次：合成一則提示', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 1 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:b', '第 2 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:c', '第 3 鏡')))
    })
    expect(onRemoved).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenCalledTimes(1)
    expect(onRemoved).toHaveBeenCalledWith('AI 刪了 3 個空的鏡頭，按「復原」可以找回來')
  })

  it('使用者復原之後再刪：另外算一批，不把復原掉的算進去', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 1 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenLastCalledWith('AI 刪了 1 個空的鏡頭，按「復原」可以找回來')
    act(() => {
      svs.emit('canvas.marksReverted', { direction: 'undo', keys: ['shot:a'] })
      svs.emit('canvas.aiChanged', event(removed('shot:b', '第 2 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenCalledTimes(2)
    expect(onRemoved).toHaveBeenLastCalledWith('AI 刪了 1 個空的鏡頭，按「復原」可以找回來')
  })

  it('隔了很久才又刪：當成新的一批', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 1 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:b', '第 2 鏡', false)))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenLastCalledWith('AI 刪了第 2 鏡，按「復原」可以找回來')
  })
})
