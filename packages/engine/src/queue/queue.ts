import { AppError, isAppError, type Job, type JobKind, type JobStatus, t } from '@svs/schema'

import type { JobDriver } from './driver'
import type { JobStore } from './job-store'

export interface ProviderLimits {
  /** 同時進行中的任務數（執行中 + 已送出等結果的）。 */
  concurrency: number
  /** 兩次送出之間至少要隔多久（速率限制）。 */
  minIntervalMs: number
  /** 長任務的輪詢間隔。 */
  pollIntervalMs: number
}

export const DEFAULT_LIMITS: ProviderLimits = {
  concurrency: 4,
  minIntervalMs: 0,
  pollIntervalMs: 3000,
}

export interface JobQueueOptions {
  store: JobStore
  /** 以供應商 ID（Job.provider）為鍵。 */
  drivers: Record<string, JobDriver>
  /** 個別供應商的覆寫；沒寫的欄位用 defaultLimits。 */
  limits?: Record<string, Partial<ProviderLimits>>
  defaultLimits?: Partial<ProviderLimits>
  /** 指數退避：第 n 次失敗後等 baseMs × 2^(n-1)，最多 maxMs，另有 ±20% 抖動。 */
  backoff?: { baseMs?: number; maxMs?: number }
  /** 連續幾次輪詢失敗（暫時性錯誤）後放棄，任務標為失敗。 */
  maxPollErrors?: number
  now?: () => number
  random?: () => number
  newId?: () => string
  /** driver 丟出非 AppError 時通知（主行程用來寫 log）。 */
  onUnexpectedError?: (job: Job, error: unknown) => void
}

export interface EnqueueSpec {
  provider: string
  modelId: string
  kind: JobKind
  input?: unknown
  nodeRunId?: string
  /** 預設 3（含第一次）。 */
  maxAttempts?: number
}

export type JobListener = (job: Job) => void

const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled']
const IN_FLIGHT: readonly JobStatus[] = ['running', 'submitted', 'polling']

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL.includes(status)
}

/**
 * 供應商任務佇列。狀態機：
 * `queued → running → (succeeded | failed | submitted → polling → succeeded | failed)`，
 * 任何非終止狀態都可以 `cancelled`；可重試的失敗會退回 `queued` 並等待退避時間。
 *
 * 所有狀態都寫進 JobStore，所以 App 被強制結束後 `start()` 會把
 * submitted / polling 的任務接回來繼續輪詢，**不會重複送出**。
 */
export class JobQueue {
  private readonly store: JobStore
  private readonly drivers: Record<string, JobDriver>
  private readonly limitOverrides: Record<string, Partial<ProviderLimits>>
  private readonly defaultLimits: ProviderLimits
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly maxPollErrors: number
  private readonly now: () => number
  private readonly random: () => number
  private readonly newId: () => string
  private readonly onUnexpectedError: ((job: Job, error: unknown) => void) | undefined

  /** 正在對供應商發出請求（送出或輪詢）的任務，可以中止。 */
  private readonly requests = new Map<string, AbortController>()
  private readonly polling = new Set<string>()
  private readonly pollDue = new Map<string, number>()
  private readonly pollErrors = new Map<string, number>()
  private readonly lastSubmitAt = new Map<string, number>()
  private readonly listeners = new Set<JobListener>()
  private readonly waiters = new Map<string, ((job: Job) => void)[]>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false

  constructor(options: JobQueueOptions) {
    this.store = options.store
    this.drivers = options.drivers
    this.limitOverrides = options.limits ?? {}
    this.defaultLimits = { ...DEFAULT_LIMITS, ...options.defaultLimits }
    this.backoffBaseMs = options.backoff?.baseMs ?? 2000
    this.backoffMaxMs = options.backoff?.maxMs ?? 5 * 60_000
    this.maxPollErrors = options.maxPollErrors ?? 5
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.onUnexpectedError = options.onUnexpectedError
  }

  /** 接回上次留下的任務並開始排程。 */
  start(): void {
    if (this.started) return
    this.started = true
    for (const job of this.store.list({ statuses: ['running'] })) {
      // 送出到一半就被中斷：還不知道供應商有沒有收到，當作沒執行過，重新排隊。
      // （同步型供應商在這個極小的空窗可能重複送出，長任務的 providerJobId 一拿到就寫入，不受影響。）
      const next: Job = { ...job, status: 'queued', attempt: Math.max(0, job.attempt - 1) }
      delete next.nextRunAt
      this.save(next)
    }
    this.pump()
  }

  /** 停止排程並中止進行中的請求。任務狀態維持原樣，下次 start() 接回。 */
  stop(): void {
    this.started = false
    clearTimeout(this.timer)
    this.timer = undefined
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  enqueue(spec: EnqueueSpec): Job {
    if (!(spec.provider in this.drivers)) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.couldnTFindTheProvider', { provider: spec.provider }),
      })
    }
    const stamp = this.iso(this.now())
    const job: Job = {
      id: this.newId(),
      provider: spec.provider,
      modelId: spec.modelId,
      kind: spec.kind,
      status: 'queued',
      attempt: 0,
      maxAttempts: spec.maxAttempts ?? 3,
      createdAt: stamp,
      updatedAt: stamp,
      ...(spec.input === undefined ? {} : { input: spec.input }),
      ...(spec.nodeRunId === undefined ? {} : { nodeRunId: spec.nodeRunId }),
    }
    this.store.put(job)
    this.emit(job)
    this.pump()
    return job
  }

  get(id: string): Job | undefined {
    return this.store.get(id)
  }

  list(filter?: { statuses?: readonly JobStatus[] }): Job[] {
    return this.store.list(filter)
  }

  /** 任務進入終止狀態（成功、失敗、取消）時回傳最後的任務內容。 */
  wait(id: string): Promise<Job> {
    const job = this.mustGet(id)
    if (isTerminalStatus(job.status)) return Promise.resolve(job)
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? []
      list.push(resolve)
      this.waiters.set(id, list)
    })
  }

  /** 每次任務狀態改變都會通知（UI 的佇列面板、花費帳本用）。回傳取消訂閱的函式。 */
  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  cancel(id: string): Job {
    const job = this.mustGet(id)
    if (isTerminalStatus(job.status)) return job
    this.requests.get(id)?.abort()
    this.requests.delete(id)
    this.pollDue.delete(id)
    this.pollErrors.delete(id)
    const saved = this.save({
      ...job,
      status: 'cancelled',
      error: { code: 'cancelled', retryable: false, userMessage: t('errors.cancelled') },
    })
    if (job.providerJobId !== undefined) {
      // 盡力通知供應商，失敗不影響本地取消
      void this.drivers[job.provider]?.cancel?.(saved).catch(() => undefined)
    }
    this.pump()
    return saved
  }

  /** 手動重試失敗或已取消的任務，重新計算重試次數。 */
  retry(id: string): Job {
    const job = this.mustGet(id)
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.onlyFailedOrCancelledJobs'),
      })
    }
    const next: Job = { ...job, status: 'queued', attempt: 0 }
    delete next.error
    delete next.nextRunAt
    delete next.providerJobId
    delete next.output
    delete next.costUsd
    const saved = this.save(next)
    this.pump()
    return saved
  }

  // ---------------------------------------------------------------- 排程

  private pump(): void {
    if (!this.started) return
    clearTimeout(this.timer)
    this.timer = undefined
    const now = this.now()
    let wakeAt = Infinity

    const inFlight = new Map<string, number>()
    for (const job of this.store.list({ statuses: IN_FLIGHT })) {
      inFlight.set(job.provider, (inFlight.get(job.provider) ?? 0) + 1)
      if (job.status === 'running' || this.polling.has(job.id)) continue
      const due = this.pollDue.get(job.id) ?? now
      if (due <= now) this.startPoll(job)
      else wakeAt = Math.min(wakeAt, due)
    }

    const queued = this.store
      .list({ statuses: ['queued'] })
      .map((job) => ({ job, readyAt: job.nextRunAt ? Date.parse(job.nextRunAt) : 0 }))
      .sort((a, b) => a.readyAt - b.readyAt || a.job.createdAt.localeCompare(b.job.createdAt))
    for (const { job, readyAt } of queued) {
      if (readyAt > now) {
        wakeAt = Math.min(wakeAt, readyAt)
        continue
      }
      const limits = this.limitsFor(job.provider)
      const used = inFlight.get(job.provider) ?? 0
      if (used >= limits.concurrency) continue
      const nextSlot = (this.lastSubmitAt.get(job.provider) ?? -Infinity) + limits.minIntervalMs
      if (now < nextSlot) {
        wakeAt = Math.min(wakeAt, nextSlot)
        continue
      }
      inFlight.set(job.provider, used + 1)
      this.lastSubmitAt.set(job.provider, now)
      this.startSubmit(job)
    }

    if (wakeAt !== Infinity) {
      this.timer = setTimeout(
        () => {
          this.pump()
        },
        Math.max(0, wakeAt - now),
      )
    }
  }

  private limitsFor(provider: string): ProviderLimits {
    return { ...this.defaultLimits, ...this.limitOverrides[provider] }
  }

  // ---------------------------------------------------------------- 送出

  private startSubmit(queued: Job): void {
    const job = this.save({ ...queued, status: 'running', attempt: queued.attempt + 1 })
    const controller = new AbortController()
    this.requests.set(job.id, controller)
    void this.runSubmit(job, controller)
  }

  private async runSubmit(job: Job, controller: AbortController): Promise<void> {
    try {
      const driver = this.drivers[job.provider]
      if (!driver)
        throw new AppError({
          code: 'internal_error',
          userMessage: t('errors.couldnTFindTheProvider2'),
        })
      const result = await driver.submit(job, { signal: controller.signal })
      const current = this.liveJob(job.id, ['running'], controller)
      if (!current) return
      if (result.status === 'done') {
        this.succeed(current, result.output, result.costUsd)
      } else {
        this.save({ ...current, status: 'submitted', providerJobId: result.providerJobId })
        this.pollDue.set(job.id, this.now() + this.limitsFor(job.provider).pollIntervalMs)
      }
    } catch (error) {
      const current = this.liveJob(job.id, ['running'], controller)
      if (current) this.fail(current, this.toAppError(current, error))
    } finally {
      this.requests.delete(job.id)
      this.pump()
    }
  }

  // ---------------------------------------------------------------- 輪詢

  private startPoll(job: Job): void {
    this.polling.add(job.id)
    const controller = new AbortController()
    this.requests.set(job.id, controller)
    void this.runPoll(job, controller)
  }

  private async runPoll(job: Job, controller: AbortController): Promise<void> {
    const limits = this.limitsFor(job.provider)
    try {
      const driver = this.drivers[job.provider]
      if (!driver?.poll) {
        throw new AppError({
          code: 'internal_error',
          userMessage: t('errors.thisProviderCanTReport'),
        })
      }
      const result = await driver.poll(job, { signal: controller.signal })
      const current = this.liveJob(job.id, ['submitted', 'polling'], controller)
      if (!current) return
      this.pollErrors.delete(job.id)
      if (result.status === 'pending') {
        if (current.status === 'submitted') this.save({ ...current, status: 'polling' })
        this.pollDue.set(job.id, this.now() + limits.pollIntervalMs)
      } else if (result.status === 'done') {
        this.succeed(current, result.output, result.costUsd)
      } else {
        this.fail(
          current,
          new AppError({
            code: result.error.code,
            retryable: result.error.retryable,
            userMessage: result.error.userMessage,
          }),
        )
      }
    } catch (error) {
      const current = this.liveJob(job.id, ['submitted', 'polling'], controller)
      if (current) this.onPollError(current, this.toAppError(current, error))
    } finally {
      this.polling.delete(job.id)
      this.requests.delete(job.id)
      this.pump()
    }
  }

  /** 輪詢本身出錯（網路、5xx…）不代表任務失敗，也不能重送；稍後再問，問太多次才放棄。 */
  private onPollError(job: Job, error: AppError): void {
    const count = (this.pollErrors.get(job.id) ?? 0) + 1
    if (!error.retryable || count > this.maxPollErrors) {
      this.settleFailed(job, error)
      return
    }
    this.pollErrors.set(job.id, count)
    this.pollDue.set(job.id, this.now() + (error.retryAfterMs ?? this.backoffMs(count)))
  }

  // ---------------------------------------------------------------- 結果

  private succeed(job: Job, output: unknown, costUsd: number | undefined): void {
    const next: Job = { ...job, status: 'succeeded', output }
    delete next.error
    delete next.nextRunAt
    if (costUsd !== undefined) next.costUsd = costUsd
    this.clearTracking(job.id)
    this.save(next)
  }

  /** 可重試且還有次數 → 退避後重新排隊（會重新送出）；否則失敗。 */
  private fail(job: Job, error: AppError): void {
    if (error.retryable && job.attempt < job.maxAttempts) {
      const delay = error.retryAfterMs ?? this.backoffMs(job.attempt)
      const next: Job = {
        ...job,
        status: 'queued',
        nextRunAt: this.iso(this.now() + delay),
        error: error.toShape(),
      }
      delete next.providerJobId
      this.clearTracking(job.id)
      this.save(next)
      return
    }
    this.settleFailed(job, error)
  }

  private settleFailed(job: Job, error: AppError): void {
    const next: Job = { ...job, status: 'failed', error: error.toShape() }
    delete next.nextRunAt
    this.clearTracking(job.id)
    this.save(next)
  }

  private backoffMs(attempt: number): number {
    const exponential = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** (attempt - 1))
    return Math.round(exponential * (0.8 + 0.4 * this.random()))
  }

  // ---------------------------------------------------------------- 工具

  /** 非同步呼叫回來時，任務可能已被取消或佇列已停止；還是預期的狀態才繼續處理。 */
  private liveJob(
    id: string,
    expected: readonly JobStatus[],
    controller: AbortController,
  ): Job | undefined {
    if (controller.signal.aborted) return undefined
    const current = this.store.get(id)
    return current && expected.includes(current.status) ? current : undefined
  }

  private toAppError(job: Job, error: unknown): AppError {
    if (isAppError(error)) return error
    this.onUnexpectedError?.(job, error)
    return new AppError({
      code: 'internal_error',
      userMessage: t('errors.anUnexpectedErrorHappenedWhile'),
      cause: error,
    })
  }

  private clearTracking(id: string): void {
    this.pollDue.delete(id)
    this.pollErrors.delete(id)
  }

  private save(job: Job): Job {
    const saved: Job = { ...job, updatedAt: this.iso(this.now()) }
    this.store.put(saved)
    this.emit(saved)
    return saved
  }

  private emit(job: Job): void {
    for (const listener of this.listeners) listener(job)
    if (isTerminalStatus(job.status)) {
      const waiting = this.waiters.get(job.id)
      this.waiters.delete(job.id)
      for (const resolve of waiting ?? []) resolve(job)
    }
  }

  private mustGet(id: string): Job {
    const job = this.store.get(id)
    if (!job) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.couldnTFindTheJob', { id }),
      })
    }
    return job
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString()
  }
}
