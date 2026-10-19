/** App 內允許的 origin：dev server 或打包後的本機檔案。外部連結一律交給系統瀏覽器。 */
export function isInternalUrl(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url)
    const app = new URL(appUrl)
    if (app.protocol === 'file:') {
      return target.protocol === 'file:' && target.pathname === app.pathname
    }
    return target.origin === app.origin
  } catch {
    return false
  }
}

/** 只有 http(s) 連結可以交給系統瀏覽器開啟；其餘（file:、javascript:…）一律丟棄。 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
