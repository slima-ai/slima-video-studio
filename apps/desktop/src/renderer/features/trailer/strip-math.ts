/** 預告片腳本條的算術（沒有 React，單獨測）。 */
import type { ShotView } from '@svs/schema'

type Beat = Pick<ShotView, 'durationSec' | 'segment'>

/** 每一秒至少這麼寬（px）：30 秒整條塞進頁寬，60、90、120 秒超過就橫向捲。 */
export const MIN_SEC_PX = 14
/** 一格最窄這麼寬（px），0.67 秒的格子也點得到。 */
export const MIN_CELL_PX = 6
/** 量不到寬度時（還沒量、測試環境）先用這個。 */
export const FALLBACK_WIDTH_PX = 900

/** 格子裡放得下什麼：圖示＋縮圖＋秒數｜只有圖示｜只有色塊。 */
export type CellFit = 'full' | 'icon' | 'block'

export const cellFit = (widthPx: number): CellFit =>
  widthPx >= 56 ? 'full' : widthPx >= 22 ? 'icon' : 'block'

/** 腳本條整條的寬度：塞得進就是可用寬度，塞不進就是每秒最少 14 px。 */
export const stripWidth = (totalSec: number, availablePx: number): number =>
  Math.max(availablePx, totalSec * MIN_SEC_PX)

export const totalSecOf = (beats: readonly Beat[]): number =>
  beats.reduce((sum, beat) => sum + beat.durationSec, 0)

/** 一格大約多寬（px）：決定格子裡寫多少字。 */
export const cellWidthPx = (beat: Beat, totalSec: number, stripPx: number): number =>
  totalSec > 0 ? (beat.durationSec / totalSec) * stripPx : 0

/** 每一格的開始時間（秒）。 */
export function cellStarts(beats: readonly Beat[]): number[] {
  let at = 0
  return beats.map((beat) => {
    const start = at
    at += beat.durationSec
    return start
  })
}

/** 播放到第幾秒時是第幾格（超過尾端回最後一格）；沒有格子回 -1。 */
export function beatIndexAt(beats: readonly Beat[], sec: number): number {
  if (beats.length === 0) return -1
  const starts = cellStarts(beats)
  for (let i = beats.length - 1; i >= 0; i--) if (sec >= (starts[i] ?? 0) - 1e-9) return i
  return 0
}

/** CSS grid 的欄寬：每格照秒數分（乘 1000 取整，免得 fr 加起來小於 1 時行為不同），最窄 6 px。 */
export const gridColumns = (beats: readonly Beat[]): string =>
  beats
    .map(
      (beat) =>
        `minmax(${String(MIN_CELL_PX)}px, ${String(Math.round(beat.durationSec * 1000))}fr)`,
    )
    .join(' ')

export interface SegmentGroup {
  /** 沒有段落（手動加的格子、一般鏡頭）是 undefined。 */
  segment: string | undefined
  /** 這一段從第幾格開始（0 起）、佔幾格。 */
  from: number
  count: number
  sec: number
}

/** 連續同一段的格子合成一塊；段落名不同（或沒有段落）就另起一塊。 */
export function segmentGroups(beats: readonly Beat[]): SegmentGroup[] {
  const groups: SegmentGroup[] = []
  beats.forEach((beat, index) => {
    const last = groups.at(-1)
    if (last && last.segment === beat.segment) {
      last.count += 1
      last.sec += beat.durationSec
    } else {
      groups.push({ segment: beat.segment, from: index, count: 1, sec: beat.durationSec })
    }
  })
  return groups
}
