/** 「3.2 秒・約 US$0.25」這種一行的耗時與花費。 */
export function usageLine(view: {
  durationMs?: number | undefined
  costUsd?: number | undefined
}): string | undefined {
  const parts: string[] = []
  if (view.durationMs !== undefined) {
    parts.push(
      view.durationMs < 1000
        ? '不到 1 秒'
        : `${(view.durationMs / 1000).toFixed(view.durationMs < 10_000 ? 1 : 0)} 秒`,
    )
  }
  if (view.costUsd !== undefined && view.costUsd > 0) {
    parts.push(`約 US$${view.costUsd.toFixed(2)}`)
  }
  return parts.length > 0 ? parts.join('・') : undefined
}

/** 「剛剛」「5 分鐘前」「3 小時前」「2 天前」。 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 60_000) return '剛剛'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${String(minutes)} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小時前`
  return `${String(Math.floor(hours / 24))} 天前`
}
