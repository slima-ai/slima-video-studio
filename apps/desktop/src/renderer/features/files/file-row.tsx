import { formatDate, t } from '@svs/schema'
import type { FileEntry } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { formatBytes } from '../../lib/bytes'
import { call, errorText } from '../../lib/svs'

export const timeText = (iso: string): string => formatDate(iso, 'dateTime')

export interface FileRowProps {
  file: FileEntry
  onError: (message: string) => void
}

/** 檔案紀錄的一筆：縮圖、大小、時間、用在哪裡、檔案在電腦上的位置。 */
export function FileRow({ file, onError }: FileRowProps) {
  const [copied, setCopied] = useState(false)
  const size =
    file.width && file.height ? `${String(file.width)}×${String(file.height)}` : undefined
  const duration =
    file.durationSec === undefined
      ? undefined
      : t('files.s', { value: file.durationSec.toFixed(1) })
  const details = [size, duration, formatBytes(file.bytes)].filter(Boolean).join(t('list.dot'))

  const reveal = (): void => {
    call('files.reveal', { hash: file.hash }).catch((e: unknown) => {
      onError(errorText(e))
    })
  }
  const copyPath = (): void => {
    navigator.clipboard
      .writeText(file.path)
      .then(() => {
        setCopied(true)
      })
      .catch(() => undefined)
  }

  return (
    <li
      data-testid="file"
      data-kind={file.kind}
      className="flex gap-3 rounded-lg border border-border bg-surface-raised shadow-card p-3"
    >
      <div className="flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-xs text-fg-muted">
        {file.kind === 'image' ? (
          <img
            src={assetUrl(file.hash)}
            alt={t('files.image', { value: file.hash.slice(0, 8) })}
            className="size-full object-cover"
          />
        ) : (
          <video
            src={assetUrl(file.hash)}
            muted
            preload="metadata"
            className="size-full object-cover"
            aria-label={t('files.video', { value: file.hash.slice(0, 8) })}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">
            {file.kind === 'image' ? t('files.image2') : t('files.video2')}
          </span>
          <span data-testid="file-details" className="text-xs text-fg-muted">
            {details}
          </span>
          <span className="text-xs text-fg-muted">{timeText(file.createdAt)}</span>
        </div>
        {file.usedBy.length > 0 ? (
          <ul data-testid="file-used-by" className="flex flex-wrap gap-1.5">
            {file.usedBy.map((label) => (
              <li key={label} className="rounded bg-surface-overlay px-2 py-0.5 text-xs">
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="file-unused" className="text-xs text-fg-muted">
            {t('files.notUsedAnywhere')}
          </p>
        )}
        {/* 完整路徑很長（含內容雜湊）：只留一行，從專案資料夾裡的 assets 開始，滑過看全文 */}
        <p
          data-testid="file-path"
          title={file.path}
          className="truncate text-xs text-fg-subtle"
          dir="ltr"
        >
          {/assets[\\/].*$/.exec(file.path)?.[0] ?? file.path}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="ghost" data-testid="file-reveal" onClick={reveal}>
            {t('files.showInFolder')}
          </Button>
          <Button size="sm" variant="ghost" data-testid="file-copy-path" onClick={copyPath}>
            {copied ? t('files.copied') : t('files.copyPath')}
          </Button>
        </div>
      </div>
    </li>
  )
}
