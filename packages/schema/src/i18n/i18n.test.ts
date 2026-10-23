import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  ENGLISH_UI_READY,
  getLocale,
  localeFromSystem,
  onLocaleChange,
  resolveLocale,
  setLocale,
} from './locale'
import { en } from './locales/en'
import { zhTW } from './locales/zh-TW'
import { formatDate, formatNumber, msg, pseudoLocalize, t } from './t'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const HAN = /[㐀-鿿]/
const params = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort()

describe('t()：換語言、插值、單複數', () => {
  it('預設是繁體中文；換成英文就吐英文；插值的 {名稱} 會被換掉', () => {
    expect(getLocale()).toBe('zh-TW')
    expect(t('menu.about', { appTitle: 'Slima' })).toBe('關於 Slima')
    setLocale('en')
    expect(t('menu.about', { appTitle: 'Slima' })).toBe('About Slima')
    expect(t('menu.save')).toBe('Save')
  })

  it('單複數：英文用 _one／_other（Intl.PluralRules），中文只有 _other', () => {
    // 測試用的字串檔沒有單複數的訊息，這裡直接驗 PluralRules 的行為，單複數的 key 之後第一次出現時再補實際訊息
    expect(new Intl.PluralRules('en-US').select(1)).toBe('one')
    expect(new Intl.PluralRules('en-US').select(2)).toBe('other')
    expect(new Intl.PluralRules('zh-TW').select(1)).toBe('other')
  })

  it('假語系：英文拉長、加括號、{參數}原樣保留', () => {
    setLocale('en-XA')
    const text = t('menu.about', { appTitle: 'Slima' })
    expect(text.startsWith('[')).toBe(true)
    expect(text).toContain('Slima')
    expect(text.length).toBeGreaterThan('About Slima'.length * 1.3)
    expect(text).toContain('Slima') // 傳進來的值不被改
    expect(pseudoLocalize('Hi {name}')).toContain('{name}')
  })

  it('msg() 只是標記 key：不是字串，要經過 t() 才變成字', () => {
    const label = msg('menu.save')
    expect(typeof label).toBe('object')
    expect(t(label)).toBe('儲存')
    setLocale('en')
    expect(t(label)).toBe('Save')
  })

  it('語言變了會通知訂閱的人；設成一樣的不通知', () => {
    const seen: string[] = []
    const off = onLocaleChange((locale) => seen.push(locale))
    setLocale('en')
    setLocale('en')
    setLocale('zh-TW')
    off()
    setLocale('en')
    expect(seen).toEqual(['en', 'zh-TW'])
  })
})

describe('resolveLocale：環境變數 > 設定 > 作業系統', () => {
  it('環境變數優先；不認得的值當作沒設', () => {
    expect(resolveLocale({ preference: 'zh-TW', override: 'en', systemLanguages: [] })).toBe('en')
    expect(resolveLocale({ preference: 'en', override: 'en-XA', systemLanguages: [] })).toBe(
      'en-XA',
    )
    expect(resolveLocale({ preference: 'en', override: 'fr', systemLanguages: [] })).toBe('en')
  })

  it('明確選的語言照用', () => {
    expect(resolveLocale({ preference: 'en', systemLanguages: ['zh-TW'] })).toBe('en')
    expect(resolveLocale({ preference: 'zh-TW', systemLanguages: ['en-US'] })).toBe('zh-TW')
  })

  it('跟著系統：中文（含簡體、香港）給繁中，其他給英文；抓不到維持繁中', () => {
    expect(localeFromSystem(['zh-CN'])).toBe('zh-TW')
    expect(localeFromSystem(['zh-Hant-TW'])).toBe('zh-TW')
    expect(localeFromSystem(['zh-HK', 'en-US'])).toBe('zh-TW')
    expect(localeFromSystem(['en-US', 'zh-TW'])).toBe('en')
    expect(localeFromSystem(['ja-JP'])).toBe('en')
    expect(localeFromSystem([])).toBe('zh-TW')
  })

  it('英文介面還沒完成（ENGLISH_UI_READY=false）時，跟著系統一律是繁中；完成後才跟著系統', () => {
    const result = resolveLocale({ preference: 'system', systemLanguages: ['en-US'] })
    expect(result).toBe(ENGLISH_UI_READY ? 'en' : 'zh-TW')
  })
})

describe('字串檔的完整度（守門）', () => {
  const zh = zhTW as Record<string, string>
  const english = en as Record<string, string | undefined>

  it('英文和中文有同一組 key（編譯就會擋，這裡再驗一次執行時的結果）', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(english)
      .filter((key) => !key.endsWith('_one'))
      .sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('每一條都不是空的；英文沒有中文字；兩邊的 {參數} 一模一樣', () => {
    for (const [key, text] of Object.entries(zh)) {
      const english_ = english[key]
      expect(text.trim(), `zh ${key}`).not.toBe('')
      expect(english_?.trim(), `en ${key}`).toBeTruthy()
      expect(HAN.test(english_ ?? ''), `en ${key} 含中文字`).toBe(false)
      expect(params(english_ ?? ''), `${key} 的參數`).toEqual(params(text))
    }
  })

  it('英文的白話守則：介面文字不用「node」這種術語（跟中文的「節點」同一條規矩）', () => {
    for (const [key, text] of Object.entries(english)) {
      expect(/\bnodes?\b/i.test(text ?? ''), `en ${key}: ${text ?? ''}`).toBe(false)
    }
  })
})

describe('日期與數字', () => {
  it('繁中的日期時間和以前寫死 zh-TW 的 toLocaleString 一模一樣', () => {
    const iso = '2026-10-23T08:05:09.000Z'
    const date = new Date(iso)
    expect(formatDate(iso, 'dateTime')).toBe(
      date.toLocaleString('zh-TW', { hour12: false, dateStyle: 'short', timeStyle: 'medium' }),
    )
    expect(formatDate(date, 'time')).toBe(
      date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }),
    )
    expect(formatDate(date, 'timeShort')).toBe(
      date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    )
  })

  it('英文用英文的排法；數字有千分位', () => {
    setLocale('en')
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatDate('2026-10-23T08:05:09.000Z', 'dateTime')).not.toMatch(/[㐀-鿿]/)
  })
})
