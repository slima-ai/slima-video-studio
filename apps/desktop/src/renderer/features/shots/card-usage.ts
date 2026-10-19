import type { ShotView, TakeView } from '@svs/schema'

/** 鏡頭卡縮圖底下那一行要顯示的資料：這張圖花了多久、多少錢、什麼時候生成的。 */
export interface CardUsage {
  durationMs?: number
  costUsd?: number
  costEstimated?: boolean
  createdAt: string
  /** 整個鏡頭重新生成一次大約再花多少（目前採用的首幀圖與影片的花費加起來）；不知道就沒有。 */
  regenerateUsd?: number
}

const current = (takes: readonly TakeView[]): TakeView | undefined =>
  takes.find((t) => t.adopted) ?? takes.at(-1)

/** 卡片縮圖用的是採用中的首幀圖，所以耗時與花費也是這張圖的。還沒有畫面就沒有這一行。 */
export function cardUsage(shot: ShotView): CardUsage | undefined {
  const frame = current(shot.firstFrames)
  if (!frame) return undefined
  const video = current(shot.videos)
  const costs = [frame, video].flatMap((t) => (t?.costUsd === undefined ? [] : [t.costUsd]))
  return {
    createdAt: frame.createdAt,
    ...(frame.durationMs === undefined ? {} : { durationMs: frame.durationMs }),
    ...(frame.costUsd === undefined
      ? {}
      : { costUsd: frame.costUsd, costEstimated: frame.costEstimated ?? false }),
    ...(costs.length > 0 ? { regenerateUsd: costs.reduce((sum, c) => sum + c, 0) } : {}),
  }
}
