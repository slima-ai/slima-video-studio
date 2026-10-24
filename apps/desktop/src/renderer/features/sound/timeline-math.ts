/** 聲音時間軸上秒數尺的算術（沒有 React，單獨測）。 */

const STEPS: readonly number[] = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/** 刻度間隔：挑「大約 8 格以內」的最小好記間隔（1、2、5、10、15、30 秒、1 分、2 分…）。 */
export function tickStep(totalSec: number): number {
  const wanted = totalSec / 8
  return STEPS.find((step) => step >= wanted) ?? 600
}

/** 從 0 起，每隔一個間隔一個刻度，不超過片長。 */
export function tickMarks(totalSec: number): number[] {
  if (!(totalSec > 0)) return []
  const step = tickStep(totalSec)
  const marks: number[] = []
  for (let sec = 0; sec <= totalSec + 1e-9; sec += step) marks.push(sec)
  return marks
}

/** 刻度上的字：不到一分鐘的片子寫秒數（5），一分鐘以上寫分:秒（1:05）。 */
export function tickLabel(sec: number, totalSec: number): string {
  if (totalSec < 60) return String(Math.round(sec))
  const whole = Math.round(sec)
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

/** 拖格子邊緣時，把滑鼠移動的像素換成影片裡的秒數（用拖之前那一刻的比例，拖的過程中不會跟著變）。 */
export const secOfPixels = (pixels: number, laneWidth: number, totalSec: number): number =>
  laneWidth > 0 ? (pixels / laneWidth) * totalSec : 0
