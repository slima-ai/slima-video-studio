import { describe, expect, it } from 'vitest'

import { AppError, AppErrorShapeSchema, isAppError } from './errors'

describe('AppError', () => {
  it('預設不可重試，並保留 code 與 userMessage', () => {
    const err = new AppError({ code: 'invalid_request', userMessage: '格式不對' })
    expect(err.retryable).toBe(false)
    expect(err.code).toBe('invalid_request')
    expect(err.userMessage).toBe('格式不對')
    expect(err.message).toBe('格式不對')
    expect(err).toBeInstanceOf(Error)
    expect(isAppError(err)).toBe(true)
    expect(isAppError(new Error('x'))).toBe(false)
  })

  it('toShape 只包含可以跨 IPC 的欄位，並能 round-trip', () => {
    const cause = new Error('供應商原始錯誤：secret-token')
    const err = new AppError({
      code: 'internal_error',
      userMessage: '發生錯誤',
      retryable: true,
      cause,
    })
    const shape = err.toShape()
    expect(shape).toEqual({ code: 'internal_error', retryable: true, userMessage: '發生錯誤' })
    expect(JSON.stringify(shape)).not.toContain('secret-token')
    expect(AppErrorShapeSchema.parse(JSON.parse(JSON.stringify(shape)))).toEqual(shape)
    expect(err.cause).toBe(cause)
  })

  it('retryAfterMs 只給佇列排程用，不會出現在跨 IPC 的形狀裡', () => {
    const err = new AppError({
      code: 'provider_rate_limited',
      userMessage: '請求太頻繁',
      retryable: true,
      retryAfterMs: 5000,
    })
    expect(err.retryAfterMs).toBe(5000)
    expect(err.toShape()).not.toHaveProperty('retryAfterMs')
    expect(new AppError({ code: 'cancelled', userMessage: 'x' }).retryAfterMs).toBeUndefined()
  })

  it('拒絕未知的錯誤代碼', () => {
    expect(
      AppErrorShapeSchema.safeParse({ code: 'nope', retryable: false, userMessage: 'x' }).success,
    ).toBe(false)
  })
})
