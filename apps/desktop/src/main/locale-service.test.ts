import { DEFAULT_LOCALE, getLocale, onLocaleChange, setLocale } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { startLocaleService } from './locale-service'
import { createMemorySettingsStore } from './settings/settings-store'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('主行程的介面語言', () => {
  it('啟動時就依設定算好；設定一改就重算並通知（選單與畫面靠它換語言）', () => {
    const settings = createMemorySettingsStore({ language: 'zh-TW' })
    const seen: string[] = []
    const off = onLocaleChange((locale) => seen.push(locale))
    startLocaleService({ settings, override: undefined, systemLanguages: () => ['en-US'] })
    expect(getLocale()).toBe('zh-TW')
    settings.update({ language: 'en' })
    expect(getLocale()).toBe('en')
    settings.update({ demoMode: true }) // 改別的設定，語言沒變就不通知
    settings.update({ language: 'zh-TW' })
    off()
    expect(seen).toEqual(['en', 'zh-TW'])
  })

  it('環境變數 SVS_LOCALE（測試、截圖）蓋過設定；沒設的時候 en-XA 之外的亂值被忽略', () => {
    const settings = createMemorySettingsStore({ language: 'zh-TW' })
    startLocaleService({ settings, override: 'en', systemLanguages: () => [] })
    expect(getLocale()).toBe('en')
    startLocaleService({ settings, override: 'fr', systemLanguages: () => [] })
    expect(getLocale()).toBe('zh-TW')
  })

  it('跟著系統：英文系統是英文、中文系統與抓不到語言是繁中', () => {
    const settings = createMemorySettingsStore() // language: 'system'
    startLocaleService({ settings, override: undefined, systemLanguages: () => ['en-US'] })
    expect(getLocale()).toBe('en')
    startLocaleService({ settings, override: undefined, systemLanguages: () => ['zh-Hant-TW'] })
    expect(getLocale()).toBe('zh-TW')
    startLocaleService({ settings, override: undefined, systemLanguages: () => [] })
    expect(getLocale()).toBe('zh-TW')
  })
})
