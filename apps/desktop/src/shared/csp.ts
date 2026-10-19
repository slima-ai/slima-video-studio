/**
 * 內容安全政策（CSP）。
 * 正式版極度嚴格；dev 為了 Vite HMR 放寬 script 與 WebSocket。
 * renderer 的 index.html 在建置時由 electron.vite.config.ts 注入這份字串。
 */
export interface CspOptions {
  /** dev server（Vite HMR）模式 */
  dev: boolean
}

export function buildCsp({ dev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'img-src': ["'self'", 'svs-asset:', 'data:', 'blob:'],
    'media-src': ["'self'", 'svs-asset:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws://localhost:*', 'http://localhost:*'] : ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-src': ["'none'"],
    'form-action': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** renderer 發現 CSP 違規時，console 訊息會帶這個前綴，主行程據此寫入 log。 */
export const CSP_VIOLATION_PREFIX = '[CSP-VIOLATION]'
