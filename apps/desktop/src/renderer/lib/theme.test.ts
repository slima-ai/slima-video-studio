import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, resolveTheme, useResolvedTheme } from './theme'

function mockSystem(light: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: light,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  applyTheme('system')
  vi.unstubAllGlobals()
})

describe('theme', () => {
  it('跟隨系統時看作業系統現在是淺色還是深色；明確選了就照選的', () => {
    mockSystem(true)
    expect(resolveTheme('system')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    mockSystem(false)
    expect(resolveTheme('system')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('applyTheme：淺色與深色寫在 html；跟隨系統就拿掉屬性', () => {
    mockSystem(false)
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('切換時短暫加上 theme-changing 讓顏色漸變，之後拿掉', () => {
    vi.useFakeTimers()
    try {
      mockSystem(false)
      applyTheme('light')
      expect(document.documentElement.classList.contains('theme-changing')).toBe(true)
      vi.advanceTimersByTime(400)
      expect(document.documentElement.classList.contains('theme-changing')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('useResolvedTheme 跟著設定變', () => {
    mockSystem(false)
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
    act(() => {
      applyTheme('light')
    })
    expect(result.current).toBe('light')
  })
})
