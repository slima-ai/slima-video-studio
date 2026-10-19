import { humanPart, type GenerationRecord, type JobKind, type JobStatus } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import { call, errorText } from '../../lib/svs'
import { usageLine } from '../../lib/usage'
import { useEscape } from '../../lib/use-escape'

export const KIND_LABEL: Readonly<Record<JobKind, string>> = {
  llm: '文字',
  image: '圖片',
  video: '影片',
  tts: '配音',
  other: '其他',
}

const STATUS_LABEL: Readonly<Record<JobStatus, string>> = {
  queued: '排隊中',
  running: '送出中',
  submitted: '生成中',
  polling: '生成中',
  succeeded: '成功',
  failed: '失敗',
  cancelled: '已取消',
}

const STATUS_TONE: Readonly<Record<JobStatus, string>> = {
  queued: 'text-fg-muted',
  running: 'text-accent',
  submitted: 'text-accent',
  polling: 'text-accent',
  succeeded: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-fg-muted',
}

const timeText = (iso: string): string =>
  new Date(iso).toLocaleString('zh-TW', { hour12: false, dateStyle: 'short', timeStyle: 'medium' })

function Thumb({ record }: { record: GenerationRecord }) {
  const { result } = record
  return (
    <div className="flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-xs text-fg-muted">
      {result?.kind === 'image' ? (
        <img
          src={assetUrl(result.hash)}
          alt={`${KIND_LABEL[record.kind]}的結果`}
          className="size-full object-cover"
        />
      ) : result?.kind === 'video' ? (
        <video
          src={assetUrl(result.hash)}
          muted
          preload="metadata"
          className="size-full object-cover"
          aria-label="影片的結果"
        />
      ) : (
        <span>{record.kind === 'llm' ? '文字' : '沒有檔案'}</span>
      )}
    </div>
  )
}

export interface RecordRowProps {
  record: GenerationRecord
  /** 重新生成開始後（在背景進行）。 */
  onRedo: (shotLabel: string) => void
  onError: (message: string) => void
}

/** 生成紀錄的一筆：點開可以看完整 prompt，改一改或直接用同一段重新生成。 */
export function RecordRow({ record, onRedo, onError }: RecordRowProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(record.prompt ?? '')
  const [confirming, setConfirming] = useState(false)
  useEscape(confirming, () => {
    setConfirming(false)
  })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const usage = usageLine({ durationMs: record.durationMs, costUsd: record.costUsd })
  const edited = draft.trim() !== (record.prompt ?? '').trim()

  const redo = async (): Promise<void> => {
    setBusy(true)
    setConfirming(false)
    try {
      await call('records.redo', {
        jobId: record.id,
        ...(edited ? { prompt: draft } : {}),
      })
      onRedo(record.target?.label ?? '鏡頭')
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = (): void => {
    navigator.clipboard
      .writeText(draft)
      .then(() => {
        setCopied(true)
      })
      .catch(() => undefined)
  }

  return (
    <li
      data-testid="record"
      data-status={record.status}
      data-kind={record.kind}
      className="flex gap-3 rounded-lg border border-border bg-surface-raised shadow-card p-3"
    >
      <Thumb record={record} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {record.target ? (
            <span data-testid="record-target" className="font-medium">
              {record.target.label}
            </span>
          ) : null}
          <span className="text-fg-muted">{KIND_LABEL[record.kind]}</span>
          <span data-testid="record-status" className={cn('text-xs', STATUS_TONE[record.status])}>
            {STATUS_LABEL[record.status]}
          </span>
          <span className="text-xs text-fg-muted">{timeText(record.createdAt)}</span>
        </div>
        <p className="text-xs text-fg-muted">
          模型：{record.modelName}
          {record.params.length > 0 ? `・${record.params.join('・')}` : ''}
        </p>
        {record.prompt ? (
          <p
            data-testid="record-prompt"
            className={cn('whitespace-pre-wrap text-xs', open ? '' : 'line-clamp-2')}
          >
            {/* 清單上只顯示給人看的中文描述；點「看完整 prompt」才看到送給模型的全文 */}
            {open ? record.prompt : humanPart(record.prompt)}
          </p>
        ) : null}
        {record.error ? (
          <p role="alert" className="text-xs text-danger">
            {record.error}
          </p>
        ) : null}
        {usage ? (
          <p data-testid="record-usage" className="text-xs text-fg-muted">
            {usage}
            {record.costEstimated ? '（估算）' : ''}
          </p>
        ) : null}

        {record.prompt ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              data-testid="record-toggle"
              aria-expanded={open}
              onClick={() => {
                setOpen(!open)
              }}
            >
              {open ? '收起' : '看完整 prompt'}
            </Button>
          </div>
        ) : null}

        {open && record.prompt ? (
          <div data-testid="record-detail" className="flex flex-col gap-2 pt-1">
            <label className="text-xs text-fg-muted" htmlFor={`prompt-${record.id}`}>
              這一筆的 prompt（可以改了再生成）
            </label>
            <textarea
              id={`prompt-${record.id}`}
              data-testid="record-draft"
              rows={4}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setCopied(false)
                setConfirming(false)
              }}
              className="rounded border border-border bg-surface-overlay p-2 text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" data-testid="record-copy" onClick={copy}>
                {copied ? '已複製' : '複製 prompt'}
              </Button>
              {record.canRedo ? (
                confirming ? (
                  <>
                    <span data-testid="record-confirm-note" className="text-xs text-fg-muted">
                      會把{record.target?.label ?? '鏡頭'}的 prompt 換成上面這段並再生成一次
                      {record.costUsd !== undefined
                        ? `，大約再花 US$${record.costUsd.toFixed(2)}`
                        : ''}
                      ；舊的版本都會保留。
                    </span>
                    <Button
                      size="sm"
                      data-testid="record-redo-confirm"
                      disabled={busy}
                      onClick={() => void redo()}
                    >
                      確定重新生成
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setConfirming(false)
                      }}
                    >
                      先不要
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    data-testid="record-redo"
                    disabled={busy || draft.trim() === ''}
                    onClick={() => {
                      setConfirming(true)
                    }}
                  >
                    {edited ? '用改過的 prompt 重新生成' : '用這段 prompt 再生成一次'}
                  </Button>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}
