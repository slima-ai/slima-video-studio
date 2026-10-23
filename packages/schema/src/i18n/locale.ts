import { z } from 'zod'

/** 介面語言。`en-XA` 是「假語系」：英文字串拉長、加記號，只用來找漏網的寫死字串與版面爆版（見 docs/i18n.md）。 */
export const LOCALES = ['zh-TW', 'en', 'en-XA'] as const
export const LocaleSchema = z.enum(LOCALES)
export type Locale = z.infer<typeof LocaleSchema>

/** 使用者在設定裡選的語言：`system` ＝ 跟著作業系統。 */
export const LANGUAGE_PREFERENCES = ['system', 'zh-TW', 'en'] as const
export const LanguagePreferenceSchema = z.enum(LANGUAGE_PREFERENCES)
export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>

export const DEFAULT_LOCALE: Locale = 'zh-TW'

/**
 * 英文介面完成了沒有。沒完成之前，設成「跟著系統」不會變英文（半英文半中文比全中文更糟）；
 * 只有明確指定（設定檔的 `language: "en"`，或環境變數 `SVS_LOCALE=en`）才會用英文。全部轉完的那支 PR 把它改成 true。
 */
export const ENGLISH_UI_READY = false as boolean

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<(locale: Locale) => void>()

/** 目前的介面語言（每個行程各有一份：主行程與畫面各自設定，見 docs/i18n.md）。 */
export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  for (const listener of [...listeners]) listener(locale)
}

/** 語言變了就通知；回傳取消訂閱的函式。 */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface ResolveLocaleInput {
  /** 設定裡的選擇。 */
  preference: LanguagePreference
  /** 環境變數 `SVS_LOCALE`（測試與截圖用；優先於設定）。不認得的值當作沒設。 */
  override?: string | undefined
  /** 作業系統的偏好語言，由前到後（Electron 的 `app.getPreferredSystemLanguages()`）。 */
  systemLanguages: readonly string[]
}

/** 作業系統語言 → 介面語言：中文（含簡體、香港）給繁中，其他給英文；抓不到就維持預設的繁中。 */
export function localeFromSystem(systemLanguages: readonly string[]): Locale {
  const first = systemLanguages[0]?.toLowerCase()
  if (first === undefined || first === '') return DEFAULT_LOCALE
  return first.startsWith('zh') ? 'zh-TW' : 'en'
}

/** 決定這次要用哪個語言：環境變數 > 設定 > 作業系統。 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  const forced = LocaleSchema.safeParse(input.override)
  if (forced.success) return forced.data
  if (input.preference === 'system') {
    return ENGLISH_UI_READY ? localeFromSystem(input.systemLanguages) : DEFAULT_LOCALE
  }
  return input.preference
}

/** `Intl` 要的語言標記。 */
export function intlTag(locale: Locale = current): string {
  return locale === 'zh-TW' ? 'zh-TW' : 'en-US'
}
