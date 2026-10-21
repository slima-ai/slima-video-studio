import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, resolveTheme, restoreTheme, useResolvedTheme } from './theme'

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
  window.localStorage.clear()
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

describe('開機時先套上次的外觀（不閃一下淺色）', () => {
  it('applyTheme 記下選的外觀；restoreTheme 在設定讀回來之前就先套好', () => {
    mockSystem(true)
    applyTheme('dark')
    expect(window.localStorage.getItem('svs-theme')).toBe('dark')
    // 模擬下次開機：html 是乾淨的
    document.documentElement.removeAttribute('data-theme')
    restoreTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('先套好之後，設定讀到同一個值不算「切換」：不加 theme-changing（沒有淺到深的漸變）', () => {
    mockSystem(true)
    // 模擬真的開機：模組裡的偏好是 'system'（還沒人套過外觀），localStorage 裡記著上次選的深色，html 是乾淨的
    applyTheme('system')
    window.localStorage.setItem('svs-theme', 'dark')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('theme-changing')
    restoreTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // 設定從主行程讀回來，還是 dark：不能算「切換」
    applyTheme('dark')
    expect(document.documentElement.classList.contains('theme-changing')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // 對照：真的從深色換成淺色才算切換
    applyTheme('light')
    expect(document.documentElement.classList.contains('theme-changing')).toBe(true)
  })

  it('沒記過、或記的是「跟隨系統」：什麼都不做；localStorage 讀不到也不丟錯', () => {
    mockSystem(true)
    window.localStorage.clear()
    restoreTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    applyTheme('system')
    restoreTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => {
      restoreTheme()
    }).not.toThrow()
    vi.restoreAllMocks()
  })
})
