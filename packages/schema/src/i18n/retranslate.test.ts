import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, setLocale } from './locale'
import { en } from './locales/en'
import { zhTW } from './locales/zh-TW'
import { retranslate, t } from './t'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

/** 每個 key（單複數合成一條）：用來造「錄下來的字串」的參數與要試的 count。 */
function cases(): { key: string; params: Record<string, string | number> }[] {
  const out: { key: string; params: Record<string, string | number> }[] = []
  const seen = new Set<string>()
  for (const fullKey of Object.keys(zhTW)) {
    const key = fullKey.replace(/_(one|other)$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const names = [
      ...new Set(
        [...((zhTW as Record<string, string>)[fullKey] ?? '').matchAll(/\{(\w+)\}/g)].map(
          (m) => m[1] ?? '',
        ),
      ),
    ]
    const params: Record<string, string | number> = {}
    names.forEach((name, index) => {
      params[name] = name === 'count' ? 3 : `P${String(index + 1)}x`
    })
    out.push({ key, params })
  }
  return out
}

const translate = (
  locale: 'zh-TW' | 'en',
  key: string,
  params: Record<string, string | number>,
): string => {
  setLocale(locale)
  return (t as (key: string, params: Record<string, string | number>) => string)(key, params)
}

describe('存下來的訊息換成現在的語言（retranslate）', () => {
  it('沒有參數的訊息：用繁中錄的，在英文介面顯示英文；反過來也一樣', () => {
    const zh = translate('zh-TW', 'errors.cancelled', {})
    const english = translate('en', 'errors.cancelled', {})
    expect(zh).not.toBe(english)
    setLocale('en')
    expect(retranslate(zh)).toBe(english)
    setLocale('zh-TW')
    expect(retranslate(english)).toBe(zh)
    // 已經是現在的語言：原樣
    setLocale('en')
    expect(retranslate(english)).toBe(english)
  })

  it('有參數的訊息（含單複數）：參數照原樣帶過去，英文單複數依 count 重挑', () => {
    const stored = translate('zh-TW', 'canvas.theOtherClipsHaveNo', { count: 1 })
    setLocale('en')
    expect(retranslate(stored)).toBe(translate('en', 'canvas.theOtherClipsHaveNo', { count: 1 }))
    const stored3 = translate('zh-TW', 'canvas.theOtherClipsHaveNo', { count: 3 })
    setLocale('en')
    const expected3 = translate('en', 'canvas.theOtherClipsHaveNo', { count: 3 })
    setLocale('en')
    expect(retranslate(stored3)).toBe(expected3)
    const price = translate('zh-TW', 'errors.estimatedCostIsOverThen', {
      estimated: '5.20',
      limit: '5.00',
    })
    setLocale('en')
    expect(retranslate(price)).toBe(
      translate('en', 'errors.estimatedCostIsOverThen', { estimated: '5.20', limit: '5.00' }),
    )
  })

  it('認不得的（外部服務回的原文、使用者寫的字）原樣回傳', () => {
    setLocale('en')
    for (const text of [
      '',
      'Rate limit exceeded (429)',
      '天空是藍色的',
      'OpenRouter returned HTTP 500: upstream timeout',
    ]) {
      expect(retranslate(text), text).toBe(text)
    }
  })

  it('絕不亂翻：每一條訊息（任意參數）反查之後，不是原樣，就一定是「這串字對得上的某一條訊息」在現在語言的翻法', () => {
    const all = cases()
    // 同一串字可能是好幾條訊息（不同 key 寫了一模一樣的中文）：它們各自的翻法都算對
    const owners = (locale: 'zh-TW' | 'en'): Map<string, string[]> => {
      const map = new Map<string, string[]>()
      for (const { key, params } of all) {
        const text = translate(locale, key, params)
        map.set(text, [...(map.get(text) ?? []), key])
      }
      return map
    }
    const wrong: string[] = []
    for (const [from, to] of [
      ['zh-TW', 'en'],
      ['en', 'zh-TW'],
    ] as const) {
      const byText = owners(from)
      for (const { key, params } of all) {
        const stored = translate(from, key, params)
        const allowed = new Set([stored])
        for (const other of byText.get(stored) ?? []) {
          const otherParams = all.find((c) => c.key === other)?.params ?? {}
          allowed.add(translate(to, other, otherParams))
        }
        setLocale(to)
        const got = retranslate(stored)
        if (!allowed.has(got)) wrong.push(`${key} ${from}→${to}: ${stored} ⇒ ${got}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('錯誤訊息（errors.*）：整句的都換得回來（太短的片段像「旁白」「（缺少 x）」是拿來接在句子裡的；不同 key 寫一模一樣的字的，挑哪一條都算對）', () => {
    const all = cases()
    const missed: string[] = []
    for (const [from, to] of [
      ['zh-TW', 'en'],
      ['en', 'zh-TW'],
    ] as const) {
      const sameText = new Map<string, string[]>()
      for (const { key, params } of all) {
        const text = translate(from, key, params)
        sameText.set(text, [...(sameText.get(text) ?? []), key])
      }
      for (const { key, params } of all.filter((c) => c.key.startsWith('errors.'))) {
        const stored = translate(from, key, params)
        const literal = (
          from === 'zh-TW' ? (zhTW as Record<string, string>) : (en as Record<string, string>)
        )[key in zhTW ? key : `${key}_other`]?.replaceAll(/\{\w+\}/g, '')
        if ((literal ?? stored).length < 8) continue
        const allowed = new Set(
          (sameText.get(stored) ?? []).map((other) =>
            translate(to, other, all.find((c) => c.key === other)?.params ?? {}),
          ),
        )
        setLocale(to)
        if (!allowed.has(retranslate(stored))) missed.push(`${key} ${from}→${to}: ${stored}`)
      }
    }
    expect(missed).toEqual([])
  })

  it('任務失敗那幾句（服務金鑰無效、影片模型無法完成）英文介面看得到英文', () => {
    const stored = translate('zh-TW', 'errors.theServiceKeyForIs', { name: 'OpenRouter' })
    expect(stored).toBe('OpenRouter 的服務金鑰無效或沒有權限，請到設定頁重新輸入。')
    setLocale('en')
    expect(retranslate(stored)).toBe(
      translate('en', 'errors.theServiceKeyForIs', { name: 'OpenRouter' }),
    )
    expect(retranslate(stored)).not.toMatch(/[㐀-鿿]/)
    setLocale('zh-TW')
    const video = translate('zh-TW', 'errors.openrouterCouldnTFinishThis', {})
    setLocale('en')
    expect(retranslate(video)).toBe(translate('en', 'errors.openrouterCouldnTFinishThis', {}))
  })
})
