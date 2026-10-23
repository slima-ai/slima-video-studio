import { t } from '@svs/schema'

/** 「3.2 秒・約 US$0.25」這種一行的耗時與花費。 */
export function usageLine(view: {
  durationMs?: number | undefined
  costUsd?: number | undefined
}): string | undefined {
  const parts: string[] = []
  if (view.durationMs !== undefined) {
    parts.push(
      view.durationMs < 1000
        ? t('shell.under1S')
        : t('shell.s', {
            value: (view.durationMs / 1000).toFixed(view.durationMs < 10_000 ? 1 : 0),
          }),
    )
  }
  if (view.costUsd !== undefined && view.costUsd > 0) {
    parts.push(t('shell.aboutUs', { value: view.costUsd.toFixed(2) }))
  }
  return parts.length > 0 ? parts.join('・') : undefined
}

/** 「剛剛」「5 分鐘前」「3 小時前」「2 天前」。 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 60_000) return t('shell.justNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('shell.minAgo', { value: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('shell.hAgo', { value: String(hours) })
  return t('shell.dAgo', { value: String(Math.floor(hours / 24)) })
}
