import { BrowserWindow } from 'electron'

import type { CardRenderer } from './credits'

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

/** 字卡的 HTML：黑底白字置中，一行一項標註，最後一行（產品）淡一點。字級跟著畫面高度。 */
export function creditsHtml(lines: readonly string[], height: number): string {
  const size = Math.round(height * 0.045)
  const rows = lines
    .map((line, index) => {
      const last = index === lines.length - 1 && lines.length > 1
      return `<p class="${last ? 'last' : ''}">${escapeHtml(line)}</p>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Noto Sans CJK TC',sans-serif;}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${String(Math.round(size * 0.6))}px;}
p{margin:0;font-size:${String(size)}px;letter-spacing:.02em;text-align:center;}
p.last{margin-top:${String(Math.round(size * 0.8))}px;font-size:${String(Math.round(size * 0.8))}px;opacity:.6;}
</style></head><body>${rows}</body></html>`
}

/**
 * 用 Electron 的離屏視窗把字卡畫成 PNG（不顯示視窗、不搶焦點）。因為自編的 FFmpeg 沒有 drawtext（沒有 freetype），
 * 文字只能在 Electron 裡畫；用系統字型，中文也行。畫面大小跟著影片。
 */
export const renderCardWithElectron: CardRenderer = async ({ lines, width, height, signal }) => {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 被取消（等太久）就直接關掉視窗，不留一個永遠不會畫完的離屏視窗
  const onAbort = (): void => {
    if (!win.isDestroyed()) win.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(creditsHtml(lines, height))}`,
    )
    // 給字型與排版一個畫面的時間
    await new Promise((resolve) => setTimeout(resolve, 150))
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    const fitted =
      size.width === width && size.height === height ? image : image.resize({ width, height })
    return new Uint8Array(fitted.toPNG())
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!win.isDestroyed()) win.destroy()
  }
}
