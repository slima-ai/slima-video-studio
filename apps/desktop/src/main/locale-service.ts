import { getLocale, resolveLocale, setLocale, type Locale } from '@svs/schema'

import type { SettingsStore } from './settings/settings-store'

export interface LocaleServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  /** 環境變數 `SVS_LOCALE`（測試與截圖用）；打包版不理它。 */
  override: string | undefined
  /** 作業系統的偏好語言（Electron 的 `app.getPreferredSystemLanguages()`）。 */
  systemLanguages: () => readonly string[]
}

/**
 * 主行程的介面語言：啟動時算一次，設定一變就重算。語言有變會呼叫 `@svs/schema` 的 `setLocale`，
 * 訂閱 `onLocaleChange` 的人（選單、通知畫面）就會收到。
 */
export function startLocaleService(options: LocaleServiceOptions): { apply: () => Locale } {
  const apply = (): Locale => {
    const locale = resolveLocale({
      preference: options.settings.get().language,
      override: options.override,
      systemLanguages: options.systemLanguages(),
    })
    setLocale(locale)
    return getLocale()
  }
  apply()
  options.settings.subscribe(apply)
  return { apply }
}
