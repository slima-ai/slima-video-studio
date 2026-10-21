import type { FinalCut, ProjectHandle } from '@svs/db'

/** 現在要接進成品的影片版本（依序；沒有採用中的影片就是空字串）。 */
export function cutTakeIdsOf(handle: ProjectHandle): string[] {
  return handle.repos.shots
    .list()
    .filter((shot) => shot.inCut)
    .map((shot) => handle.repos.shots.listTakes(shot.id, 'video').find((t) => t.adopted)?.id ?? '')
}

export interface CurrentFinal {
  cut: FinalCut
  /**
   * 這一版跟現在的狀態對不對得上：`false` 對得上；`'shots'` 影片（鏡頭）換了，要重新接；
   * `'sound'` 影片一樣、只有聲音不同，重混就好。
   */
  stale: false | 'shots' | 'sound'
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index])

/**
 * 成品的「目前版本」：從新到舊找第一個跟現在狀態對得上的版本——用的影片版本一樣、混音的聲音指紋
 * （`soundKey`，音量、旁白、配樂、淡入淡出都在裡面）一樣、檔案還在；找不到才用最新的一版（而且是 stale）。
 * 這樣復原、重做會直接回到當時接好的那一版：不用重混，也不會多出新的版本號。
 */
export function currentFinal(
  handle: ProjectHandle,
  soundKeyNow: string | undefined,
): CurrentFinal | undefined {
  const all = handle.repos.finalCuts.list()
  const takeIds = cutTakeIdsOf(handle)
  const match = all.find(
    (cut) =>
      sameIds(cut.takeIds, takeIds) &&
      cut.soundKey === soundKeyNow &&
      handle.assets.find(cut.assetHash) !== undefined,
  )
  if (match) return { cut: match, stale: false }
  const latest = all[0]
  if (!latest) return undefined
  return { cut: latest, stale: sameIds(latest.takeIds, takeIds) ? 'sound' : 'shots' }
}
