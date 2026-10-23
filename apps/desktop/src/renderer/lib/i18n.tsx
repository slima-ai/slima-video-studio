import { getLocale, setLocale, type Locale } from '@svs/schema'
import { useEffect, useState, type ReactNode } from 'react'

import { call } from './svs'

/** `<html lang>` 跟著介面語言（螢幕閱讀器、字型挑選用）。 */
function applyDocumentLanguage(locale: Locale): void {
  document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant' : 'en'
}

/** 啟動時先問主行程現在的語言（在第一次畫畫面之前，才不會先閃一下別的語言）；問不到就維持預設。 */
export async function loadLocale(): Promise<void> {
  try {
    const { locale } = await call('app.locale', {})
    setLocale(locale)
    applyDocumentLanguage(locale)
  } catch {
    // 問不到就用預設語言，不擋 App 啟動
  }
}

/**
 * 語言變了（設定改了）就換語言並整棵重畫：`t()` 是在畫的當下讀目前語言，
 * 整棵樹換 key 重新掛上，所有字就一起換了（代價：畫面上沒存的暫時狀態會歸零，換語言很少發生，可以接受）。
 */
export function I18nRoot({ children }: { children: ReactNode }) {
  const [locale, setCurrent] = useState<Locale>(getLocale)
  useEffect(
    () =>
      window.svs.on('locale.changed', (event) => {
        setLocale(event.locale)
        applyDocumentLanguage(event.locale)
        setCurrent(event.locale)
      }),
    [],
  )
  // 沒有真的包一層 DOM：只是用 key 讓子樹在語言變了的時候重新掛上
  return <LocaleBoundary key={locale}>{children}</LocaleBoundary>
}

function LocaleBoundary({ children }: { children: ReactNode }) {
  return <>{children}</>
}
