import type { JobKind, JobStatus, JobSummary } from '@svs/schema'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/button'
import { useQueue } from './use-queue'

const KIND_LABEL: Record<JobKind, string> = {
  llm: '文字',
  image: '圖片',
  video: '影片',
  tts: '配音',
  music: '配樂',
  other: '其他',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '排隊中',
  running: '送出中',
  submitted: '生成中',
  polling: '生成中',
  succeeded: '完成',
  failed: '失敗',
  cancelled: '已取消',
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
    return `第 ${String(job.attempt)} 次嘗試沒成功，稍後自動重試（最多 ${String(job.maxAttempts)} 次）`
  }
  if (isActive(job) && job.attempt > 1) return `第 ${String(job.attempt)} 次嘗試`
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
        {job.stepLabel ? `${job.stepLabel}・` : ''}
        {/* 鏡頭的圖就是它的第一張畫面：和畫布、確認面板用同一個名字 */}
        {job.stepLabel && job.kind === 'image' ? '第一張畫面' : KIND_LABEL[job.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{job.promptPreview ?? job.modelId}</span>
        {note ? <span className="block truncate text-xs text-fg-muted">{note}</span> : null}
      </span>
      <span className={`w-16 shrink-0 text-right ${STATUS_TONE[job.status]}`}>
        {STATUS_LABEL[job.status]}
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
            取消
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
            重試
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
          生成佇列
          {active > 0 ? (
            <span className="ml-2 text-accent" data-testid="queue-active-count">
              執行中 {active - waiting}・排隊 {waiting}
            </span>
          ) : null}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          data-testid="queue-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展開生成佇列' : '收合生成佇列'}
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
          目前沒有生成任務。
        </p>
      ) : (
        <ul
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          aria-label="生成任務"
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
