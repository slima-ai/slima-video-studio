import { z } from 'zod'

/** 所有對使用者或 renderer 暴露的錯誤代碼。新增代碼時一併更新 userMessage 對應。 */
export const AppErrorCodeSchema = z.enum([
  'invalid_request',
  'invalid_response',
  'unknown_channel',
  'untrusted_sender',
  'not_implemented',
  'project_not_found',
  'project_invalid',
  'project_exists',
  'project_locked',
  'project_too_new',
  'workflow_invalid',
  'node_failed',
  'cancelled',
  'budget_exceeded',
  'key_storage_unavailable',
  'key_invalid',
  'provider_auth_failed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_timeout',
  'provider_rejected',
  'provider_insufficient_funds',
  'slima_unavailable',
  'slima_auth_failed',
  'internal_error',
])
export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>

/** 可以安全跨越 IPC 邊界的錯誤形狀（不含 stack、不含供應商原始訊息）。 */
export const AppErrorShapeSchema = z.object({
  code: AppErrorCodeSchema,
  /** 重試有機會成功（逾時、429、5xx…）。 */
  retryable: z.boolean(),
  /** 給使用者看的訊息，已經整理過，可以直接顯示。 */
  userMessage: z.string(),
})
export type AppErrorShape = z.infer<typeof AppErrorShapeSchema>

export interface AppErrorInit {
  code: AppErrorCode
  userMessage: string
  retryable?: boolean
  /** 供應商要求的等待時間（例如 429 的 Retry-After）。只給任務佇列排程用，不跨 IPC。 */
  retryAfterMs?: number
  /** 原始錯誤，只留在主行程 log，不會跨 IPC。 */
  cause?: unknown
}

/** 有型別的應用錯誤。供應商或系統的原始錯誤要先包成 AppError 才能往上丟。 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly retryable: boolean
  readonly userMessage: string
  readonly retryAfterMs: number | undefined

  constructor(init: AppErrorInit) {
    super(init.userMessage, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'AppError'
    this.code = init.code
    this.retryable = init.retryable ?? false
    this.userMessage = init.userMessage
    this.retryAfterMs = init.retryAfterMs
  }

  toShape(): AppErrorShape {
    return { code: this.code, retryable: this.retryable, userMessage: this.userMessage }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}
