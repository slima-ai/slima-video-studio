import { probe } from './probe'
import { runTool, runToolRaw, type MediaTools, type RunOptions } from './run'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 圖片裡真正有內容的範圍（用 FFmpeg 的 cropdetect 找出四周接近全黑的邊）。
 * 回傳整張圖的大小與內容範圍；找不到（整張都是黑的、讀不出來）就回整張圖。
 */
export async function detectContentBox(
  tools: MediaTools,
  input: string,
  options: RunOptions = {},
): Promise<{ width: number; height: number; content: Box }> {
  const info = await probe(tools, input, options)
  const width = info.width ?? 0
  const height = info.height ?? 0
  const whole = { x: 0, y: 0, width, height }
  if (width === 0 || height === 0) return { width, height, content: whole }
  // skip=0：一張圖只有一格，不能略過前幾格；limit：比這個亮度還暗的算黑（約 18/255）
  const { stderr } = await runToolRaw(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-i',
      input,
      '-vf',
      'cropdetect=limit=0.07:round=2:skip=0:reset=0',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    options,
  )
  const found = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1)
  if (!found) return { width, height, content: whole }
  const [, w, h, x, y] = found.map(Number)
  if (!w || !h || x === undefined || y === undefined) return { width, height, content: whole }
  return { width, height, content: { x, y, width: w, height: h } }
}

/** 黑邊至少占這個比例（而且至少 6 像素）才處理：影片頭一兩秒會帶著它，再細的邊看不出來。 */
const MIN_BAR_RATIO = 0.01
const MIN_BAR_PX = 6
/** 上下（或左右）兩條黑邊要差不多寬：只有一邊黑的多半是夜景的黑天空，不是黑邊。 */
const MAX_BAR_IMBALANCE = 0.3

/**
 * 內容範圍算不算「電影黑邊」：上下兩條（或左右兩條）都有、而且差不多寬、另外兩邊沒有。
 * 是的話回內容範圍，不是就回 undefined。只有一邊黑（例如夜景的黑天空、漸暗的角落）一律不算。
 */
export function letterboxContent(
  size: { width: number; height: number },
  content: Box,
): Box | undefined {
  const top = content.y
  const bottom = size.height - (content.y + content.height)
  const left = content.x
  const right = size.width - (content.x + content.width)
  const bars = (a: number, b: number, whole: number): boolean =>
    a >= Math.max(whole * MIN_BAR_RATIO, MIN_BAR_PX) &&
    b >= Math.max(whole * MIN_BAR_RATIO, MIN_BAR_PX) &&
    Math.abs(a - b) <= Math.max(a, b) * MAX_BAR_IMBALANCE + 4
  const tiny = (a: number, b: number, whole: number): boolean => a + b < whole * 0.02
  if (bars(top, bottom, size.height) && tiny(left, right, size.width)) return content
  if (bars(left, right, size.width) && tiny(top, bottom, size.height)) return content
  return undefined
}

/** 從內容範圍裡置中取一塊指定比例（寬／高）的範圍：內容比較寬就裁左右，比較高就裁上下。 */
export function coverRect(content: Box, aspect: number): Box {
  const contentAspect = content.width / content.height
  if (contentAspect > aspect) {
    const width = Math.floor((content.height * aspect) / 2) * 2
    return {
      x: content.x + Math.floor((content.width - width) / 2),
      y: content.y,
      width,
      height: content.height,
    }
  }
  const height = Math.floor(content.width / aspect / 2) * 2
  return {
    x: content.x,
    y: content.y + Math.floor((content.height - height) / 2),
    width: content.width,
    height,
  }
}

/**
 * 圖片帶電影黑邊（模型自己畫上去的上下黑條）時，去掉黑邊、補回要求的比例、放大回原尺寸，存成 PNG。
 * 沒有黑邊就什麼都不做，回 false。圖生影片的起始畫面要鋪滿整個畫面，黑邊會讓影片頭一兩秒帶著黑條。
 */
export async function trimLetterbox(
  tools: MediaTools,
  input: string,
  output: string,
  aspect: number,
  options: RunOptions = {},
): Promise<boolean> {
  const { width, height, content } = await detectContentBox(tools, input, options)
  const bars = letterboxContent({ width, height }, content)
  if (!bars) return false
  const crop = coverRect(bars, aspect)
  await runTool(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-vf',
      `crop=${String(crop.width)}:${String(crop.height)}:${String(crop.x)}:${String(crop.y)},scale=${String(width)}:${String(height)}:flags=lanczos`,
      '-frames:v',
      '1',
      output,
    ],
    options,
  )
  return true
}
