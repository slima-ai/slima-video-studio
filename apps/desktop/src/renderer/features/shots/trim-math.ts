/** 畫面上剪裁用的小算術（沒有 React，單獨測）。 */

/** 預設的格線：24 格／秒。伺服器接片時對齊的是成品真正的幀率，回傳之後畫面改用那一個。 */
export const TRIM_DEFAULT_FPS = 24

/** 秒數寫成給人看的樣子：最多三位小數，至少一位（3.5、5.0、5.042）。 */
export function fmtSec(sec: number): string {
  const rounded = Number(sec.toFixed(3))
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded)
}

/** 卡片徽章用：一位小數（3.5、5.0）。 */
export const fmtSec1 = (sec: number): string => sec.toFixed(1)

/** 打進欄位的字轉成秒數；不是數字、是負的就是 undefined。 */
export function parseSec(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || !/^\d*\.?\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** 播放位置在第幾格（從 0 起）。加一點點誤差，免得 83.9999 被當成第 83 格。 */
export const frameAt = (sec: number, fps: number): number => Math.floor(sec * fps + 1e-3)

/** 第 n 格的開頭（秒）。 */
export const secOfFrame = (frame: number, fps: number): number => frame / fps

/** 移到某一格時，播放位置放在那一格「裡面」（開頭過 1/4 格），瀏覽器才會畫出那一格而不是前一格。 */
export const seekTimeOfFrame = (frame: number, fps: number): number => (frame + 0.25) / fps

/** 對齊到最近一格。 */
export const snapSec = (sec: number, fps: number): number =>
  Math.round((Math.round(sec * fps) / fps) * 1e6) / 1e6

/** 拖入點把手時可以到的範圍：不能超過出點前一格。 */
export const clampIn = (sec: number, end: number, fps: number): number =>
  Math.min(Math.max(0, sec), Math.max(0, end - 1 / fps))

/** 拖出點把手時可以到的範圍：不能早過入點後一格、不能超過影片長度。 */
export const clampOut = (sec: number, start: number, videoSec: number, fps: number): number =>
  Math.max(Math.min(videoSec, sec), Math.min(videoSec, start + 1 / fps))
