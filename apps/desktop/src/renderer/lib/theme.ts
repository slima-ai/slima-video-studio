import type { ThemePreference } from '@svs/schema'
import { useSyncExternalStore } from 'react'

export type ResolvedTheme = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: light)'

let preference: ThemePreference = 'system'
const listeners = new Set<() => void>()

function systemTheme(): ResolvedTheme {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
    ? 'light'
    : 'dark'
}

/** 把偏好換成實際用的外觀；「跟隨系統」看作業系統現在是淺色還是深色。 */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

/**
 * 套用外觀：淺色／深色寫在 <html data-theme>；跟隨系統就拿掉屬性，讓 CSS 的
 * prefers-color-scheme 決定。切換的瞬間加上 theme-changing，顏色用 300ms 漸變。
 */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement
  const changed = pref !== preference
  preference = pref
  if (changed) {
    root.classList.add('theme-changing')
    window.setTimeout(() => {
      root.classList.remove('theme-changing')
    }, 350)
  }
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  listeners.forEach((listener) => {
    listener()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined
  media?.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    media?.removeEventListener('change', listener)
  }
}

/** 目前實際用的外觀（給 React Flow 這種需要明確傳入 light/dark 的元件）。 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, () => resolveTheme(preference))
}
