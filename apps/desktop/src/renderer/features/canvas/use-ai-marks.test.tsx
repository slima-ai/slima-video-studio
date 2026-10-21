import type { CanvasAiChanged } from '@svs/schema'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { useAiMarks } from './use-ai-marks'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const removed = (
  key: string,
  title: string,
  empty = true,
  summary?: string,
): CanvasAiChanged['removed'][number] => ({
  key,
  title,
  kind: 'shot',
  empty,
  ...(summary === undefined ? {} : { summary }),
})
const event = (...nodes: CanvasAiChanged['removed']): CanvasAiChanged => ({
  at: '2026-10-21T00:00:00.000Z',
  channel: 'shots.delete',
  changed: [],
  added: [],
  removed: nodes,
})

describe('useAiMarks：AI 刪了東西的提示（Claude 對話那一輪）', () => {
  it('Claude 對話那一輪連著刪好幾次：合成一則提示，帶「這一輪的改動一起退回」那句', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved, () => true))
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
    expect(onRemoved).toHaveBeenCalledWith(
      'AI 刪了 3 個空的鏡頭，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
  })

  it('使用者復原之後再刪：另外算一批，不把復原掉的算進去', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved, () => true))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 1 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenLastCalledWith(
      'AI 刪了 1 個空的鏡頭，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
    act(() => {
      svs.emit('canvas.marksReverted', { direction: 'undo', keys: ['shot:a'] })
      svs.emit('canvas.aiChanged', event(removed('shot:b', '第 2 鏡')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenCalledTimes(2)
    expect(onRemoved).toHaveBeenLastCalledWith(
      'AI 刪了 1 個空的鏡頭，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
  })

  it('隔了很久才又刪：當成新的一批', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved, () => true))
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
    expect(onRemoved).toHaveBeenLastCalledWith(
      'AI 刪了第 2 鏡，按「復原」可以找回來（這一輪 AI 做的其他改動也會一起退回）',
    )
  })
})

describe('useAiMarks：對話那一輪連刪有內容的鏡頭，名字不重複', () => {
  it('刪第 1 鏡、原第 2 鏡變成第 1 鏡再被刪：合成的提示不寫兩個「第 1 鏡」，改寫「鏡頭「…」」', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved, () => true))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 1 鏡', false, '開場：小機器人')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:b', '第 1 鏡', false, '第 2 段：花')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRemoved).toHaveBeenCalledTimes(1)
    const text = String(onRemoved.mock.calls[0]?.[0])
    expect(text).toContain('鏡頭「開場：小機器人」、鏡頭「第 2 段：花」')
    expect(text).not.toContain('第 1 鏡')
  })

  it('只刪一次（號碼是對的）：照舊寫「第 N 鏡「…」」', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved, () => true))
    act(() => {
      svs.emit('canvas.aiChanged', event(removed('shot:a', '第 3 鏡', false, '看見暖光')))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(String(onRemoved.mock.calls[0]?.[0])).toContain('第 3 鏡「看見暖光」')
  })
})

describe('useAiMarks：外面的 AI 工具刪東西（不是 Claude 對話那一輪）', () => {
  it('連刪 3 次不合成：每次各一則，最後那則只說最後刪的那一個（復原只退最後一步）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const svs = installFakeSvs()
    const onRemoved = vi.fn()
    renderHook(() => useAiMarks(onRemoved))
    for (const n of [1, 2, 3]) {
      act(() => {
        svs.emit('canvas.aiChanged', event(removed(`shot:${String(n)}`, `第 ${String(n)} 鏡`)))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(onRemoved).toHaveBeenCalledTimes(3)
    for (const call of onRemoved.mock.calls) {
      expect(call).toEqual(['AI 刪了 1 個空的鏡頭，按「復原」可以找回來'])
    }
  })
})
