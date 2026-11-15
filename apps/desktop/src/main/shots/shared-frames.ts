import type { ProjectHandle } from '@svs/db'
import type { Shot } from '@svs/schema'

/** 一個不動格共用同一個地點裡別的不動格的首幀：用哪一格的、那一格的首幀現在有沒有。 */
export interface SharedFrame {
  leaderId: string
  /** true＝那一格已經有採用中的首幀，可以直接用；false＝它這次也要畫，要等它畫好。 */
  ready: boolean
}

/**
 * 預告片專案：同一張主視覺（同一張場景卡）用在好幾個「不動」的格子時，只畫一張首幀，各格各自套推近或平移
 * （會動的格照舊各畫各的）。這次要畫首幀的不動格（`drawing`）裡，哪些可以跟別格共用，回「跟隨的格 → 共用誰的」：
 * - 同一個地點的不動格裡已經有一格有首幀：這次要畫的都直接用它（`ready`）
 * - 都還沒有：這次要畫的裡面號碼最小的那一格畫，其他的等它（`!ready`）
 * 使用者明確要重做的、一般專案（沒有預告片設定）、沒有地點的格子不在 `drawing` 裡或不處理。
 */
export function planSharedFrames(
  handle: ProjectHandle,
  drawing: readonly Shot[],
): Map<string, SharedFrame> {
  const out = new Map<string, SharedFrame>()
  if (handle.repos.trailer.get() === undefined) return out
  const wanting = drawing.filter(
    (shot) => shot.beatKind === 'still' && shot.locationId !== undefined,
  )
  if (wanting.length === 0) return out
  const { shots } = handle.repos
  const all = shots.list()
  for (const locationId of new Set(wanting.map((shot) => shot.locationId))) {
    const wantIds = new Set(
      wanting.filter((shot) => shot.locationId === locationId).map((shot) => shot.id),
    )
    const group = all
      .filter((shot) => shot.beatKind === 'still' && shot.locationId === locationId)
      .sort((a, b) => a.number - b.number)
    const source = group.find(
      (shot) =>
        !wantIds.has(shot.id) &&
        shots.listTakes(shot.id, 'first_frame').some((take) => take.adopted),
    )
    if (source) {
      for (const id of wantIds) out.set(id, { leaderId: source.id, ready: true })
      continue
    }
    const [leader, ...rest] = group.filter((shot) => wantIds.has(shot.id))
    if (!leader) continue
    for (const follower of rest) out.set(follower.id, { leaderId: leader.id, ready: false })
  }
  return out
}
