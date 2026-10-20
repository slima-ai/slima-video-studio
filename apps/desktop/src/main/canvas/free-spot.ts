/** 畫布座標上的一個方框。 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * 新格子想放在 `want`（左上角），那裡被 `avoid` 裡的方框佔住就找最近的空位：
 * 一圈一圈往外找，每圈挑離想放的位置最近的格子；格子之間留一點空隙。
 * （和畫面上的 `freeSpot` 同一套做法，給主行程一次放好幾個檔案時用。）
 */
export function findFreeSpot(
  avoid: readonly Rect[],
  size: { w: number; h: number },
  want: { x: number; y: number },
  step = 40,
  gap = 16,
): { x: number; y: number } {
  const blockers = avoid.filter((r) => r.w > 0 && r.h > 0)
  const free = (at: { x: number; y: number }): boolean => {
    const box = { x: at.x - gap, y: at.y - gap, w: size.w + gap * 2, h: size.h + gap * 2 }
    return !blockers.some((r) => overlaps(box, r))
  }
  if (free(want)) return want
  for (let ring = 1; ring <= 60; ring++) {
    const candidates: { x: number; y: number }[] = []
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        candidates.push({ x: want.x + dx * step, y: want.y + dy * step })
      }
    }
    candidates.sort(
      (a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y),
    )
    const found = candidates.find(free)
    if (found) return found
  }
  return want
}
