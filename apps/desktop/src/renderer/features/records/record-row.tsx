import {
  humanPart,
  type GenerationRecord,
  type JobKind,
  type JobStatus,
  formatDate,
  t,
  msg,
  type MessageRef,
} from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import { call, errorText } from '../../lib/svs'
import { usageLine } from '../../lib/usage'
import { useEscape } from '../../lib/use-escape'

export const KIND_LABEL: Readonly<Record<JobKind, MessageRef>> = {
  llm: msg('records.text'),
  image: msg('records.image'),
  video: msg('records.video'),
  tts: msg('records.narration'),
  music: msg('records.music'),
  other: msg('records.other'),
}

const STATUS_LABEL: Readonly<Record<JobStatus, MessageRef>> = {
  queued: msg('records.queued'),
  running: msg('records.sending'),
  submitted: msg('records.generating'),
  polling: msg('records.generating'),
  succeeded: msg('records.succeeded'),
  failed: msg('records.failed'),
  cancelled: msg('records.cancelled'),
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

const timeText = (iso: string): string => formatDate(iso, 'dateTime')

function Thumb({ record }: { record: GenerationRecord }) {
  const { result } = record
  return (
    <div className="flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-xs text-fg-muted">
      {result?.kind === 'image' ? (
        <img
          src={assetUrl(result.hash)}
          alt={t('records.result', { value: t(KIND_LABEL[record.kind]) })}
          className="size-full object-cover"
        />
      ) : result?.kind === 'video' ? (
        <video
          src={assetUrl(result.hash)}
          muted
          preload="metadata"
          className="size-full object-cover"
          aria-label={t('records.videoResult')}
        />
      ) : (
        <span>{record.kind === 'llm' ? t('records.text') : t('records.noFile')}</span>
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
      onRedo(record.target?.label ?? t('records.shot'))
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
          <span className="text-fg-muted">{t(KIND_LABEL[record.kind])}</span>
          <span data-testid="record-status" className={cn('text-xs', STATUS_TONE[record.status])}>
            {t(STATUS_LABEL[record.status])}
          </span>
          <span className="text-xs text-fg-muted">{timeText(record.createdAt)}</span>
        </div>
        <p className="text-xs text-fg-muted">
          {record.params.length > 0
            ? t('records.model', {
                modelName: record.modelName,
                value: record.params.join(t('list.dot')),
              })
            : t('records.model2', { modelName: record.modelName })}
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
            {record.costEstimated ? t('records.estimated', { usage }) : usage}
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
              {open ? t('records.hide') : t('records.showTheFullPrompt')}
            </Button>
          </div>
        ) : null}

        {open && record.prompt ? (
          <div data-testid="record-detail" className="flex flex-col gap-2 pt-1">
            <label className="text-xs text-fg-muted" htmlFor={`prompt-${record.id}`}>
              {t('records.thePromptForThisRecord')}
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
                {copied ? t('records.copied') : t('records.copyPrompt')}
              </Button>
              {record.canRedo ? (
                confirming ? (
                  <>
                    <span data-testid="record-confirm-note" className="text-xs text-fg-muted">
                      {record.costUsd !== undefined
                        ? t('records.thisReplacesThePromptFor', {
                            value: record.target?.label ?? t('records.shot'),
                            value2: record.costUsd.toFixed(2),
                          })
                        : t('records.thisReplacesThePromptFor2', {
                            value: record.target?.label ?? t('records.shot'),
                          })}
                    </span>
                    <Button
                      size="sm"
                      data-testid="record-redo-confirm"
                      disabled={busy}
                      onClick={() => void redo()}
                    >
                      {t('records.generateAgain')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setConfirming(false)
                      }}
                    >
                      {t('records.notNow')}
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
                    {edited
                      ? t('records.generateAgainWithTheEdited')
                      : t('records.generateAgainWithThisPrompt')}
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
