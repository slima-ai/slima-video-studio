import type { AspectRatio } from '@svs/schema'

// 字卡的 HTML（純函式，不碰 Electron）：文字卡、片名卡、片尾 AI 服務字卡。
// 畫成 PNG 的是 render-electron.ts；這裡只負責「長什麼樣子」，所以可以在一般的測試裡驗。
// 安全：字卡文字來自使用者、文字模型或 Claude，放進 HTML 前一律跳脫；頁面有內容安全政策（不能跑腳本、不能連網），
// 圖只收 data:image/、字型只收 file://。

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

/** 字卡的字型家族名稱（只在字卡頁面裡用；字型檔本身的名稱是 Noto Sans TC）。 */
export const CARD_FONT_FAMILY = 'SVS Card'

const SYSTEM_FONTS = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Noto Sans CJK TC',sans-serif`

/** 字卡的 HTML：黑底白字置中，一行一項標註，最後一行（產品）淡一點。字級跟著畫面高度。（片尾 AI 服務字卡，輸出跟以前逐字相同。） */
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

export interface CardSize {
  width: number
  height: number
}

/** 字卡的像素大小：跟著專案的畫面比例（橫式 1280×720、直式 720×1280）；寬高都是偶數（影片編碼要求）。 */
export function cardSizeFor(aspectRatio: AspectRatio): CardSize {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1280, height: 720 }
    case '9:16':
      return { width: 720, height: 1280 }
    case '1:1':
      return { width: 1024, height: 1024 }
    case '4:3':
      return { width: 1024, height: 768 }
    case '21:9':
      return { width: 1680, height: 720 }
  }
}

// ---- 排版 ----

/** 一個字大約佔幾個「字寬」：中文、全形、表情符號 1，空白 0.3，其他（英文、數字）0.58。 */
function emWidth(text: string): number {
  let total = 0
  for (const ch of text) {
    if (/\s/u.test(ch)) total += 0.3
    else if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]|[\u3000-\u303f\uff00-\uffef]/u.test(
        ch,
      )
    )
      total += 1
    else total += 0.58
  }
  return total
}

const LINE_HEIGHT = 1.3
/** 「12 個中文字以內一行」（規則 6）：用字寬估的 12 個字。 */
const ONE_LINE_UNITS = 12.5
const MAX_LINES = 3
/** 排版估計的安全係數：真的換行時行尾會多留一點空。 */
const WRAP_SLACK = 1.1

export interface TextLayout {
  fontSizePx: number
  lineCount: number
}

/**
 * 一段字放進框裡：從 basePx 開始，一行放得下就用原本的大小；放不下就先換行（最多 3 行）、再縮字，
 * 縮到整段（行數 × 字級 × 1.3）不超過框高為止；最小不低於 minPx。12 個中文字以內一定是一行。
 */
export function layoutCardText(
  text: string,
  box: { widthPx: number; heightPx: number },
  limits: { basePx: number; minPx: number },
): TextLayout {
  const units = Math.max(1, emWidth(text.replace(/\n/g, ' ')))
  const lines = text.split('\n').length
  // 先試一行：12 個字以內一定一行（縮到一行放得下為止）；再長的，縮到不小於基本字級的 7 成還放得下一行才用一行
  const oneLine = Math.floor(box.widthPx / units)
  const oneLineOk =
    lines === 1 &&
    (units <= ONE_LINE_UNITS ? oneLine >= limits.minPx : oneLine >= limits.basePx * 0.7)
  if (oneLineOk) return { fontSizePx: Math.min(limits.basePx, oneLine), lineCount: 1 }
  let size = limits.basePx
  for (;;) {
    const wrapped = Math.max(
      lines,
      Math.ceil((units * size * (units * size > box.widthPx ? WRAP_SLACK : 1)) / box.widthPx),
    )
    const fits = wrapped <= MAX_LINES && wrapped * size * LINE_HEIGHT <= box.heightPx
    if (fits || size <= limits.minPx)
      return { fontSizePx: Math.max(size, limits.minPx), lineCount: wrapped }
    size = Math.max(limits.minPx, size - 2)
  }
}

/** 字卡的基本字級與下限：跟著畫面短邊。 */
const limitsFor = (size: CardSize, scale = 1) => ({
  basePx: Math.round(Math.min(size.width, size.height) * 0.12 * scale),
  minPx: Math.round(Math.min(size.width, size.height) * 0.03 * scale),
})

function fontFace(fontUrl: string | undefined): string {
  if (fontUrl === undefined) return ''
  // 只收 file:// 開頭、而且沒有可以跳出 CSS 字串的字元
  if (!/^file:\/\/[^'"\\)(\s<>]+$/.test(fontUrl)) {
    throw new Error('The card font must be a plain file:// URL')
  }
  return `@font-face{font-family:'${CARD_FONT_FAMILY}';src:url('${fontUrl}');font-weight:700;}`
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src file:">`

const textHtml = (text: string): string => escapeHtml(text.trim()).replace(/\n/g, '<br>')

function page(css: string, body: string, fontUrl: string | undefined): string {
  return `<!doctype html><html><head><meta charset="utf-8">${CSP}<style>
${fontFace(fontUrl)}
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;}
body{font-family:'${CARD_FONT_FAMILY}',${SYSTEM_FONTS};font-weight:700;}
${css}
</style></head><body>${body}</body></html>`
}

export interface TextCardInput extends CardSize {
  text: string
  subtext?: string | undefined
  /** 內建字型的 file:// 網址；沒給就用系統字型。 */
  fontUrl?: string | undefined
}

/** 文字卡：黑底、主文字（大）加副文字（小），置中。 */
export function textCardHtml(input: TextCardInput): string {
  const { width, height } = input
  const box = { widthPx: width * 0.8, heightPx: height * 0.5 }
  const main = layoutCardText(input.text, box, limitsFor(input))
  const subText = (input.subtext ?? '').trim()
  const sub =
    subText === ''
      ? undefined
      : layoutCardText(
          subText,
          { widthPx: width * 0.8, heightPx: height * 0.2 },
          limitsFor(input, 0.45),
        )
  const css = `body{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
.main{max-width:80%;font-size:${String(main.fontSizePx)}px;line-height:${String(LINE_HEIGHT)};letter-spacing:.02em;overflow-wrap:anywhere;}
.sub{max-width:80%;margin-top:${String(Math.round(main.fontSizePx * 0.5))}px;font-size:${String(sub?.fontSizePx ?? 0)}px;line-height:${String(LINE_HEIGHT)};opacity:.75;overflow-wrap:anywhere;}`
  const body =
    `<div class="main">${textHtml(input.text)}</div>` +
    (sub === undefined ? '' : `<div class="sub">${textHtml(subText)}</div>`)
  return page(css, body, input.fontUrl)
}

export interface TitleCardInput extends CardSize {
  title: string
  author?: string | undefined
  /** 片尾那一行：哪天上市、去哪裡買。 */
  endLine?: string | undefined
  /** 封面原圖（data:image/… 網址）；沒有就只有文字。 */
  coverDataUri?: string | undefined
  /** 最底下一行小字（匯出時的 AI 服務標註）；沒給就沒有。 */
  footnote?: string | undefined
  fontUrl?: string | undefined
}

/** 片名卡：封面原圖（等比例，不拉伸）＋書名＋作者＋片尾那一行；橫式左右排、直式上下排；最底下可以有一行小字。 */
export function titleCardHtml(input: TitleCardInput): string {
  const { width, height } = input
  if (
    input.coverDataUri !== undefined &&
    !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(input.coverDataUri)
  ) {
    throw new Error('The cover must be a data:image/ URL')
  }
  const wide = width > height
  const hasCover = input.coverDataUri !== undefined
  // 文字欄：橫式有封面時佔右邊約一半，其他時候佔寬度的 8 成
  const textWidth = wide && hasCover ? width * 0.4 : width * 0.8
  const unit = limitsFor(input)
  const title = layoutCardText(
    input.title,
    { widthPx: textWidth, heightPx: height * (wide ? 0.4 : 0.2) },
    { basePx: Math.round(unit.basePx * 0.95), minPx: unit.minPx },
  )
  const authorText = (input.author ?? '').trim()
  const endText = (input.endLine ?? '').trim()
  const author =
    authorText === ''
      ? undefined
      : layoutCardText(
          authorText,
          { widthPx: textWidth, heightPx: height * 0.12 },
          limitsFor(input, 0.4),
        )
  const end =
    endText === ''
      ? undefined
      : layoutCardText(
          endText,
          { widthPx: textWidth, heightPx: height * 0.14 },
          limitsFor(input, 0.32),
        )
  const footText = (input.footnote ?? '').trim()
  const footPx = Math.max(10, Math.round(Math.min(width, height) * 0.03))
  const css = `body{display:flex;align-items:center;justify-content:center;gap:${String(Math.round(width * 0.04))}px;flex-direction:${wide ? 'row' : 'column'};}
.cover{display:flex;align-items:center;justify-content:center;${wide ? `width:${String(Math.round(width * 0.34))}px;height:${String(Math.round(height * 0.8))}px` : `width:${String(Math.round(width * 0.6))}px;height:${String(Math.round(height * 0.42))}px`};}
.cover img{max-width:100%;max-height:100%;object-fit:contain;}
.text{display:flex;flex-direction:column;align-items:${wide && hasCover ? 'flex-start' : 'center'};justify-content:center;text-align:${wide && hasCover ? 'left' : 'center'};max-width:${String(Math.round(textWidth))}px;}
.title{font-size:${String(title.fontSizePx)}px;line-height:${String(LINE_HEIGHT)};overflow-wrap:anywhere;}
.author{margin-top:${String(Math.round(title.fontSizePx * 0.3))}px;font-size:${String(author?.fontSizePx ?? 0)}px;opacity:.85;overflow-wrap:anywhere;}
.end{margin-top:${String(Math.round(title.fontSizePx * 0.5))}px;font-size:${String(end?.fontSizePx ?? 0)}px;opacity:.7;overflow-wrap:anywhere;}
.footnote{position:absolute;left:0;right:0;bottom:${String(Math.round(height * 0.03))}px;text-align:center;font-size:${String(footPx)}px;opacity:.6;}`
  const body =
    (hasCover ? `<div class="cover"><img src="${input.coverDataUri ?? ''}" alt=""></div>` : '') +
    `<div class="text"><div class="title">${textHtml(input.title)}</div>` +
    (author === undefined ? '' : `<div class="author">${textHtml(authorText)}</div>`) +
    (end === undefined ? '' : `<div class="end">${textHtml(endText)}</div>`) +
    `</div>` +
    (footText === '' ? '' : `<div class="footnote">${textHtml(footText)}</div>`)
  return page(css, body, input.fontUrl)
}
