import { BrowserWindow } from 'electron'
import type { MockFrame } from '@svs/providers'

/**
 * 示範圖用畫面視窗裡的 canvas 畫：字型跟介面一樣是系統字型，中文才不會變成「??」
 * （內建的點陣字型只有英數）。只在示範模式用，畫一張約 10～30 毫秒。
 * 沒有視窗時（例如還沒開好）回傳 undefined，由呼叫端退回點陣字型。
 */
export function createMockFrameRenderer(): (frame: MockFrame) => Promise<Uint8Array | undefined> {
  return async (frame) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win) return undefined
    const dataUrl: unknown = await win.webContents.executeJavaScript(
      `(${drawFrame.toString()})(${JSON.stringify(frame)})`,
      true,
    )
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      return undefined
    }
    return new Uint8Array(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
  }
}

/** drawFrame 用到的網頁 canvas 介面（主行程的 tsconfig 沒有 DOM 型別，只宣告用到的部分）。 */
interface Ctx2d {
  fillStyle: unknown
  font: string
  textBaseline: string
  textAlign: string
  shadowColor: string
  shadowBlur: number
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => { addColorStop: (offset: number, color: string) => void }
  fillRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  closePath: () => void
  arc: (x: number, y: number, r: number, start: number, end: number) => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => void
  roundRect: (x: number, y: number, w: number, h: number, r: number) => void
  fill: () => void
  measureText: (text: string) => { width: number }
  fillText: (text: string, x: number, y: number) => void
}
declare const document: {
  createElement: (tag: 'canvas') => {
    width: number
    height: number
    getContext: (kind: '2d') => Ctx2d | null
    toDataURL: (type: string) => string
  }
}

/**
 * 在網頁裡執行（會被轉成字串送過去，不能用到這個檔案的其他東西）：
 * 依色相畫一張有點像「畫面」的示範圖（漸層天空、地平線、月亮），左上小標、中間一句話、右下指紋。
 */
function drawFrame(frame: MockFrame): string {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const w = frame.width
  const h = frame.height
  const hue = frame.hue % 360
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, `hsl(${String(hue)} 45% 34%)`)
  sky.addColorStop(1, `hsl(${String((hue + 40) % 360)} 50% 16%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  // 月亮與地平線：讓示範圖一眼看得出是「一個畫面」，不是色塊
  ctx.fillStyle = `hsl(${String((hue + 180) % 360)} 70% 85% / 0.55)`
  ctx.beginPath()
  ctx.arc(w * 0.78, h * 0.28, Math.min(w, h) * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `hsl(${String((hue + 20) % 360)} 35% 12% / 0.65)`
  ctx.beginPath()
  ctx.moveTo(0, h * 0.72)
  ctx.quadraticCurveTo(w * 0.3, h * 0.62, w * 0.55, h * 0.7)
  ctx.quadraticCurveTo(w * 0.8, h * 0.78, w, h * 0.66)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()

  const font =
    '"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif'
  const unit = Math.max(10, Math.round(Math.min(w, h) / 18))
  // 左上小標（膠囊底）
  ctx.font = `600 ${String(unit)}px ${font}`
  const tagWidth = ctx.measureText(frame.title).width + unit
  ctx.fillStyle = 'rgb(0 0 0 / 0.35)'
  ctx.beginPath()
  ctx.roundRect(unit * 0.8, unit * 0.8, tagWidth, unit * 1.7, unit * 0.85)
  ctx.fill()
  ctx.fillStyle = 'rgb(255 255 255 / 0.92)'
  ctx.textBaseline = 'middle'
  ctx.fillText(frame.title, unit * 1.3, unit * 1.65)

  // 中間一句話：一個字一個字量，超過寬度就換行，最多三行
  const size = Math.round(unit * 1.45)
  ctx.font = `700 ${String(size)}px ${font}`
  const max = w - unit * 3
  const lines: string[] = []
  let line = ''
  for (const ch of Array.from(frame.caption)) {
    if (ctx.measureText(line + ch).width > max && line.length > 0) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line.length > 0) lines.push(line)
  const shown = lines.slice(0, 3)
  if (lines.length > 3) shown[2] = `${(shown[2] ?? '').slice(0, -1)}…`
  ctx.shadowColor = 'rgb(0 0 0 / 0.55)'
  ctx.shadowBlur = unit * 0.5
  ctx.fillStyle = '#ffffff'
  const top = h * 0.5 - ((shown.length - 1) * size * 1.3) / 2
  shown.forEach((text, i) => {
    ctx.fillText(text, unit * 1.5, top + i * size * 1.3)
  })
  ctx.shadowBlur = 0

  // 右下指紋
  ctx.font = `500 ${String(Math.round(unit * 0.8))}px ${font}`
  ctx.fillStyle = 'rgb(255 255 255 / 0.6)'
  ctx.textAlign = 'right'
  ctx.fillText(frame.detail, w - unit, h - unit)
  return canvas.toDataURL('image/png')
}
