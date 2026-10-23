import type { JobKind, JobStatus, JobSummary } from '@svs/schema'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/button'
import { useQueue } from './use-queue'
import { t, msg, type MessageRef } from '@svs/schema'

const KIND_LABEL: Record<JobKind, MessageRef> = {
  llm: msg('queue.text'),
  image: msg('queue.image'),
  video: msg('queue.video'),
  tts: msg('queue.narration'),
  music: msg('queue.music'),
  other: msg('queue.other'),
}

const STATUS_LABEL: Record<JobStatus, MessageRef> = {
  queued: msg('queue.queued'),
  running: msg('queue.sending'),
  submitted: msg('queue.generating'),
  polling: msg('queue.generating'),
  succeeded: msg('queue.done'),
  failed: msg('queue.failed'),
  cancelled: msg('queue.cancelled'),
}

const ACTIVE: readonly JobStatus[] = ['queued', 'running', 'submitted', 'polling']
const isActive = (job: JobSummary): boolean => ACTIVE.includes(job.status)

/** 展開的高度：標題 32px ＋ 每筆約 37px，最高 160px；只有一兩筆時不留一大片空白。 */
const ROW_PX = 37
const HEADER_PX = 32
const MAX_EXPANDED_PX = 160

const STATUS_TONE: Record<JobStatus, string> = {
  queued: 'text-fg-muted',
  running: 'text-accent',
  submitted: 'text-accent',
  polling: 'text-accent',
  succeeded: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-fg-muted',
}

const usd = (n: number): string => `US$${String(Number(n.toFixed(4)))}`

/** 狀態旁的補充說明：重試次數、失敗原因。 */
function detail(job: JobSummary): string | undefined {
  if (job.status === 'failed' && job.error) return job.error.userMessage
  if (job.status === 'queued' && job.attempt > 0) {
    return t('queue.attemptFailedRetryingAutomaticallyIn', {
      value: String(job.attempt),
      value2: String(job.maxAttempts),
    })
  }
  if (isActive(job) && job.attempt > 1) return t('queue.attempt', { value: String(job.attempt) })
  return undefined
}

function JobRow({
  job,
  onCancel,
  onRetry,
}: {
  job: JobSummary
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}) {
  const note = detail(job)
  return (
    <li
      data-testid={`job-${job.id}`}
      data-status={job.status}
      className="flex items-center gap-3 border-t border-border py-1.5 text-sm first:border-t-0"
    >
      <span className="w-28 shrink-0 text-fg-muted" data-testid="job-label">
        {job.stepLabel ? `${job.stepLabel}${t('list.dot')}` : ''}
        {/* 鏡頭的圖就是它的第一張畫面：和畫布、確認面板用同一個名字 */}
        {job.stepLabel && job.kind === 'image' ? t('queue.firstFrame') : t(KIND_LABEL[job.kind])}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{job.promptPreview ?? job.modelId}</span>
        {note ? <span className="block truncate text-xs text-fg-muted">{note}</span> : null}
      </span>
      <span className={`w-16 shrink-0 text-right ${STATUS_TONE[job.status]}`}>
        {t(STATUS_LABEL[job.status])}
      </span>
      <span className="w-20 shrink-0 text-right text-fg-muted">
        {job.costUsd === undefined ? '' : usd(job.costUsd)}
      </span>
      <span className="w-14 shrink-0 text-right">
        {isActive(job) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onCancel(job.id)
            }}
          >
            {t('queue.cancel')}
          </Button>
        ) : null}
        {job.status === 'failed' || job.status === 'cancelled' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onRetry(job.id)
            }}
          >
            {t('queue.retry')}
          </Button>
        ) : null}
      </span>
    </li>
  )
}

/**
 * 底部的生成任務清單：進度、花費、失敗原因，可以取消或重試；可收合。
 * 平常收起（只留一條標題，標題上看得到「執行中幾個・排隊幾個」），只有使用者自己按才展開，
 * 不會因為有新任務就自己彈出來蓋住畫布。
 */
export function QueuePanel() {
  const { jobs, error, cancel, retry } = useQueue()
  const active = jobs.filter(isActive).length
  const waiting = jobs.filter((job) => job.status === 'queued').length
  const [collapsed, setCollapsed] = useState(true)

  const expandedPx = Math.min(
    MAX_EXPANDED_PX,
    HEADER_PX + Math.max(1, jobs.length) * ROW_PX + (error ? 24 : 0),
  )

  return (
    <div
      style={{ height: collapsed ? HEADER_PX : expandedPx }}
      className="flex flex-col overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      data-testid="queue-panel"
      data-collapsed={collapsed}
    >
      <div className="flex h-8 shrink-0 items-center justify-between">
        <h2 className="text-sm font-medium text-fg-muted">
          {t('queue.generationQueue')}
          {active > 0 ? (
            <span className="ml-2 text-accent" data-testid="queue-active-count">
              {t('queue.runningQueued', { value: active - waiting, waiting })}
            </span>
          ) : null}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          data-testid="queue-toggle"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? t('queue.expandTheGenerationQueue') : t('queue.collapseTheGenerationQueue')
          }
          onClick={() => {
            setCollapsed(!collapsed)
          }}
        >
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {jobs.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid="queue-empty">
          {t('queue.noGenerationTasksRightNow')}
        </p>
      ) : (
        <ul
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          aria-label={t('queue.generationTasks')}
          inert={collapsed}
        >
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onCancel={cancel} onRetry={retry} />
          ))}
        </ul>
      )}
    </div>
  )
}
