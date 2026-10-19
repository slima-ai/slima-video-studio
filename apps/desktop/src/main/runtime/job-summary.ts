import { humanPart, type Job, type JobSummary } from '@svs/schema'

export { humanPart }

const PREVIEW_LENGTH = 80
/** 從任務的請求裡抓一小段描述（Prompt 或最後一則訊息），給清單辨認用。 */
function previewOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  let text: unknown = record.prompt ?? record.text
  if (typeof text !== 'string' && Array.isArray(record.messages)) {
    const last: unknown = record.messages.at(-1)
    if (typeof last === 'object' && last !== null) text = (last as { content?: unknown }).content
  }
  if (typeof text !== 'string') return undefined
  const flat = (typeof record.prompt === 'string' ? humanPart(text) : text)
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (flat === '') return undefined
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat
}

/** 任務 → 給畫面看的摘要（不含完整請求與供應商回傳的內容）。 */
export function toJobSummary(job: Job, stepLabel?: string): JobSummary {
  const preview = previewOf(job.input)
  return {
    id: job.id,
    provider: job.provider,
    modelId: job.modelId,
    kind: job.kind,
    status: job.status,
    ...(preview ? { promptPreview: preview } : {}),
    ...(stepLabel ? { stepLabel } : {}),
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
    ...(job.costUsd === undefined ? {} : { costUsd: job.costUsd }),
    ...(job.error
      ? { error: { userMessage: job.error.userMessage, retryable: job.error.retryable } }
      : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}
