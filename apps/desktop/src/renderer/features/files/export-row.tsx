import { t, type ExportEntry } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { InlineVideo } from '../../components/inline-video'
import { exportUrl, isPlayableExport } from '../../lib/asset'
import { cn } from '../../lib/cn'
import { formatBytes } from '../../lib/bytes'
import { timeText } from './file-row'

/** 「匯出的成品」的一筆：能播的影片可以直接在這裡播（有控制列），也可以在資料夾裡顯示。 */
export function ExportRow({
  entry,
  onReveal,
}: {
  entry: ExportEntry
  onReveal: (name: string) => void
}) {
  // 播放時縮圖放大一些，控制列才按得到
  const [playing, setPlaying] = useState(false)
  return (
    <li
      data-testid="export"
      className="flex gap-3 rounded-lg border border-border bg-surface-raised shadow-card px-3 py-2 text-sm"
    >
      {isPlayableExport(entry.name) ? (
        <InlineVideo
          src={exportUrl(entry.name)}
          label={entry.name}
          className={cn(
            'shrink-0 self-start rounded transition-[width]',
            playing ? 'w-96' : 'w-32',
          )}
          onPlayingChange={setPlaying}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap content-center items-center gap-x-3 gap-y-1">
        <span className="font-medium">{entry.name}</span>
        <span className="text-xs text-fg-muted">
          {`${formatBytes(entry.bytes)}${t('list.dot')}${timeText(entry.modifiedAt)}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          data-testid="export-reveal"
          onClick={() => {
            onReveal(entry.name)
          }}
        >
          {t('files.showInFolder')}
        </Button>
      </div>
    </li>
  )
}
