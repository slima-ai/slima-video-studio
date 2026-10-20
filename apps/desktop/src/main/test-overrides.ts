const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * 測試用：把 OpenRouter 的位址換成本機的假伺服器（`SVS_OPENROUTER_BASE_URL`）。
 * 只有非打包版才生效，而且只接受本機位址（http／https 的 127.0.0.1、localhost、[::1]）：
 * Key 會被送到這個位址，所以不能讓環境變數把它導到別的主機。沒設或不合格就回傳 undefined（照常連 OpenRouter）。
 */
export function openrouterBaseUrlOverride(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined {
  const raw = env.SVS_OPENROUTER_BASE_URL
  if (packaged || raw === undefined || raw === '') return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined
  return raw.replace(/\/+$/, '')
}

/**
 * 開 App 沒有專案可以接時，要不要先到首頁。正式使用一律要；測試用 `SVS_DISABLE_HOME=1` 跳過
 * （讓 e2e 一開 App 就是空畫布，不必每支都先點過首頁）。只有非打包版才吃這個變數：
 * 打包版就算環境裡設了也無效。
 */
export function startsOnHome(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): boolean {
  return packaged || env.SVS_DISABLE_HOME !== '1'
}

/**
 * 測試用：把「claude 執行檔」換成假的（`SVS_CLAUDE_BIN`，一個會照劇本回事件的小程式），
 * e2e 才能不花錢、不依賴這台電腦有沒有登入 Claude。只有非打包版才生效：打包版就算環境裡設了也無效，
 * 不然別人能用環境變數讓 App 去執行任意程式。
 */
export function claudeBinOverride(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined {
  const raw = env.SVS_CLAUDE_BIN
  if (packaged || raw === undefined || raw === '') return undefined
  return raw
}
