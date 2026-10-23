import type { FinalCut, ProjectHandle } from '@svs/db'
import { trimKeyOf, type Take } from '@svs/schema'

import { trimOfTake } from './trim'

/** 現在要接進成品的影片版本（依序；還沒有採用中的影片是 undefined）。 */
export function cutVideoTakesOf(handle: ProjectHandle): (Take | undefined)[] {
  return handle.repos.shots
    .list()
    .filter((shot) => shot.inCut)
    .map((shot) => handle.repos.shots.listTakes(shot.id, 'video').find((t) => t.adopted))
}

/** 現在要接進成品的影片版本（依序；沒有採用中的影片就是空字串）。 */
export function cutTakeIdsOf(handle: ProjectHandle): string[] {
  return cutVideoTakesOf(handle).map((take) => take?.id ?? '')
}

/** 現在各鏡裁切的指紋；一鏡都沒裁就是 undefined（和舊的成品一樣，所以升級不會讓舊成品變過期）。 */
export function cutTrimKeyOf(handle: ProjectHandle): string | undefined {
  return trimKeyOf(
    cutVideoTakesOf(handle).map((take) => ({ id: take?.id ?? '', trim: trimOfTake(take) })),
  )
}

export interface CurrentFinal {
  cut: FinalCut
  /**
   * 這一版跟現在的狀態對不對得上：`false` 對得上；`'shots'` 影片（鏡頭）換了、或裁切改了，要重新接；
   * `'sound'` 影片一樣、只有聲音不同，重混就好。
   */
  stale: false | 'shots' | 'sound'
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index])

/**
 * 成品的「目前版本」：從新到舊找第一個跟現在狀態對得上的版本——用的影片版本一樣、各鏡裁切一樣、混音的聲音指紋
 * （`soundKey`，音量、旁白、配樂、淡入淡出都在裡面）一樣、檔案還在；找不到才用最新的一版（而且是 stale）。
 * 這樣復原、重做會直接回到當時接好的那一版：不用重混，也不會多出新的版本號。
 */
export function currentFinal(
  handle: ProjectHandle,
  soundKeyNow: () => string | undefined,
): CurrentFinal | undefined {
  const all = handle.repos.finalCuts.list()
  // 還沒接過成品就不用算下面這些（鏡頭很多的專案，每個鏡頭一次查詢；畫布每次更新都會問）
  if (all.length === 0) return undefined
  const takeIds = cutTakeIdsOf(handle)
  const trimKey = cutTrimKeyOf(handle)
  const key = soundKeyNow()
  const match = all.find(
    (cut) =>
      sameIds(cut.takeIds, takeIds) &&
      cut.trimKey === trimKey &&
      cut.soundKey === key &&
      handle.assets.find(cut.assetHash) !== undefined,
  )
  if (match) return { cut: match, stale: false }
  const latest = all[0]
  if (!latest) return undefined
  // 影片版本或裁切不同：畫面要重新接；只有聲音不同：重混就好
  return {
    cut: latest,
    stale: sameIds(latest.takeIds, takeIds) && latest.trimKey === trimKey ? 'sound' : 'shots',
  }
}
