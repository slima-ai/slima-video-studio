import { describe, expect, it } from 'vitest'

import {
  IpcEnvelopeSchema,
  IpcResultSchema,
  ipcContract,
  ipcEvents,
  isIpcChannel,
  isIpcEventName,
} from './ipc'

describe('ipcContract', () => {
  it('app.ping 驗證 request 與 response', () => {
    const { request, response } = ipcContract['app.ping']
    expect(request.safeParse({ message: 'hi' }).success).toBe(true)
    expect(request.safeParse({ message: 1 }).success).toBe(false)
    expect(request.safeParse({ message: 'x'.repeat(201) }).success).toBe(false)
    expect(request.safeParse({}).success).toBe(false)
    expect(response.safeParse({ pong: 'hi', receivedAt: 1 }).success).toBe(true)
    expect(response.safeParse({ pong: 'hi' }).success).toBe(false)
  })

  it('每個 channel 都有 request 與 response schema', () => {
    for (const def of Object.values(ipcContract)) {
      expect(typeof def.request.safeParse).toBe('function')
      expect(typeof def.response.safeParse).toBe('function')
    }
  })

  it('isIpcChannel 只認合約裡的 channel，包含原型鏈上的名稱也要擋', () => {
    expect(isIpcChannel('app.ping')).toBe(true)
    expect(isIpcChannel('app.nope')).toBe(false)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel('__proto__')).toBe(false)
    expect(isIpcChannel('constructor')).toBe(false)
  })

  it('isIpcEventName 只認合約裡的事件', () => {
    expect(isIpcEventName('app.pinged')).toBe(true)
    expect(isIpcEventName('toString')).toBe(false)
    expect(Object.keys(ipcEvents)).toContain('app.pinged')
  })

  it('信封與結果格式', () => {
    expect(IpcEnvelopeSchema.safeParse({ channel: 'a', payload: 1 }).success).toBe(true)
    expect(IpcEnvelopeSchema.safeParse({ payload: 1 }).success).toBe(false)
    expect(IpcResultSchema.safeParse({ ok: true, data: 1 }).success).toBe(true)
    expect(
      IpcResultSchema.safeParse({
        ok: false,
        error: { code: 'internal_error', retryable: false, userMessage: 'x' },
      }).success,
    ).toBe(true)
    expect(IpcResultSchema.safeParse({ ok: false }).success).toBe(false)
  })
})
