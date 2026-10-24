import { t, type TakeView } from '@svs/schema'

import { fmtSec } from './trim-math'

const range = (take: TakeView): { start: string; end: string } | undefined => {
  if (!take.trim) return undefined
  return {
    start: fmtSec(take.trim.inSec ?? 0),
    end: fmtSec(take.trim.outSec ?? take.videoSec ?? 0),
  }
}

/**
 * 換成另一版影片時的提示：上一版有剪過，要讓人知道「這一版不是用同一段」（裁切跟著影片版本走）。
 * 上一版沒剪、或換到同一版就不提示。
 */
export function trimHintOnAdopt(
  previous: TakeView | undefined,
  next: TakeView | undefined,
): string | undefined {
  if (!previous || !next || previous.id === next.id) return undefined
  const before = range(previous)
  if (!before) return undefined
  const own = range(next)
  return own
    ? t('shots.trimPreviousVersionOwn', {
        ...before,
        ownStart: own.start,
        ownEnd: own.end,
      })
    : t('shots.trimPreviousVersion', before)
}
