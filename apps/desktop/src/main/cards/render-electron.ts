import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CardRenderer } from '../credits/credits'
import { creditsHtml, CARD_FONT_FAMILY } from './card-html'
import type { HtmlRenderer } from './card-service'

/**
 * 用 Electron 的離屏視窗把一段 HTML 畫成 PNG（不顯示視窗、不搶焦點）。因為自編的 FFmpeg 沒有 drawtext（沒有 freetype），
 * 文字只能在 Electron 裡畫。視窗沒有 node 整合、有沙盒；不連網靠頁面的內容安全政策（default-src 'none'：不能跑腳本、不能載入任何網路資源，圖只收 data:、字型只收 file://），
 * 加上頁面不能自己跳去別的網址、不能開新視窗。（試過給字卡視窗專用的 session 來擋網路請求：離屏視窗用自訂 session 載入 file:// 會失敗，所以不用。）
 * HTML 裡有 @font-face（內建字型的 file:// 網址）時，頁面要從檔案載入（data: 頁面不能讀 file://），所以先寫成暫存檔；
 * 沒有字型的（片尾 AI 服務字卡）還是用 data: 網址，跟以前一樣。字型有沒有載入成功會回報，失敗就是退回系統字型。
 */
export const renderHtmlWithElectron: HtmlRenderer = (request) => {
  // 一次畫一張：排進佇列（離屏視窗共用，同時畫會互相踩到）
  const task = queue.then(() => renderOne(request))
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

/**
 * 離屏視窗要重複使用：這版 Electron 上，關掉一個離屏視窗之後立刻再開新的離屏視窗，新視窗載入頁面會失敗（ERR_FAILED）。
 * 所以每種大小留一個視窗，之後的字卡都用它；只有被取消（等太久）或出錯時才丟掉那個視窗，下次再開新的。
 */
const pool = new Map<string, BrowserWindow>()
let queue: Promise<void> = Promise.resolve()

function windowFor(width: number, height: number): BrowserWindow {
  const key = `${String(width)}x${String(height)}`
  const existing = pool.get(key)
  if (existing && !existing.isDestroyed()) return existing
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
  // 頁面不會自己跳到別的地方（只收我們載入的 file:// 與 data:），也不能開新視窗
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('data:')) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    if (pool.get(key) === win) pool.delete(key)
  })
  pool.set(key, win)
  return win
}

async function renderOne({
  html,
  width,
  height,
  signal,
}: Parameters<HtmlRenderer>[0]): Promise<Awaited<ReturnType<HtmlRenderer>>> {
  const usesFile = html.includes('@font-face')
  const win = windowFor(width, height)
  let broken = false
  // 被取消（等太久）就丟掉這個視窗，不留一個永遠不會畫完的離屏視窗
  const onAbort = (): void => {
    broken = true
    if (!win.isDestroyed()) win.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const tmpFile = usesFile ? join(tmpdir(), `svs-card-${randomUUID()}.html`) : undefined
  try {
    if (tmpFile === undefined) {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    } else {
      writeFileSync(tmpFile, html, 'utf8')
      await win.loadFile(tmpFile)
    }
    let fontLoaded: boolean | undefined
    if (usesFile) {
      // 等字型載完；沒載入成功（檔案壞了、不見了）就是 false，頁面自己退回系統字型
      fontLoaded = Boolean(
        await win.webContents.executeJavaScript(
          `document.fonts.ready.then(() => document.fonts.check("700 20px '${CARD_FONT_FAMILY}'"))`,
          true,
        ),
      )
    }
    // 給排版一個畫面的時間
    await new Promise((resolve) => setTimeout(resolve, 150))
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    const fitted =
      size.width === width && size.height === height ? image : image.resize({ width, height })
    return {
      png: new Uint8Array(fitted.toPNG()),
      ...(fontLoaded === undefined ? {} : { fontLoaded }),
    }
  } catch (error) {
    broken = true
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (broken && !win.isDestroyed()) win.destroy()
    if (tmpFile !== undefined) rmSync(tmpFile, { force: true })
  }
}

/** 片尾 AI 服務字卡（匯出時接在最後）：一行一項標註，黑底白字，系統字型，輸出跟以前相同。 */
export const renderCardWithElectron: CardRenderer = async ({ lines, width, height, signal }) => {
  const { png } = await renderHtmlWithElectron({
    html: creditsHtml(lines, height),
    width,
    height,
    ...(signal ? { signal } : {}),
  })
  return png
}
