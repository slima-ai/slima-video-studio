import type { AppErrorShape } from '../errors'
import type { Job } from './execution'

export interface DriverContext {
  /** 任務被取消、或佇列停止時會中止。 */
  signal: AbortSignal
}

export type SubmitResult =
  /** 同步完成（例如 LLM、快速的文生圖）。 */
  | { status: 'done'; output: unknown; costUsd?: number }
  /** 長任務已送出，之後用 providerJobId 輪詢。 */
  | { status: 'submitted'; providerJobId: string }

export type PollResult =
  | { status: 'pending' }
  | { status: 'done'; output: unknown; costUsd?: number }
  /** 供應商明確回報這個任務失敗。是否重試看 error.retryable。 */
  | { status: 'failed'; error: AppErrorShape }

/**
 * 某個供應商的實際呼叫。由 packages/providers 的 adapter 實作、apps/desktop 組裝進佇列。
 *
 * 失敗時丟 `AppError`：`retryable` 決定要不要退避重試（逾時、429、5xx 可重試；
 * 401、內容被拒、參數錯誤不重試），429 可帶 `retryAfterMs`。
 * 丟出其他錯誤一律視為不可重試的內部錯誤。
 */
export interface JobDriver {
  submit: (job: Job, ctx: DriverContext) => Promise<SubmitResult>
  /** 有長任務的供應商才需要。poll 丟出的暫時性錯誤只會延後下次輪詢，不會重送任務。 */
  poll?: (job: Job, ctx: DriverContext) => Promise<PollResult>
  /** 盡力取消遠端任務；失敗不影響本地取消。 */
  cancel?: (job: Job) => Promise<void>
}
