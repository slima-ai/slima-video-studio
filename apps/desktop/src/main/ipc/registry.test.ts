import { AppError, ipcContract } from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import { ProjectManager } from '../project-manager'
import { MemoryVault } from '../keys/key-vault'
import { testSettingsDeps } from '../settings/test-deps'
import { registerAllHandlers } from './handlers'
import { createIpcRegistry, parseEventPayload, type HandlerContext } from './registry'

const log = { warn: vi.fn(), error: vi.fn() }
const ctx = (): HandlerContext & { emitted: unknown[] } => {
  const emitted: unknown[] = []
  return {
    emitted,
    emit: (event, payload) => {
      emitted.push({ event, payload })
    },
  }
}

const setup = () => {
  log.warn.mockClear()
  log.error.mockClear()
  const registry = createIpcRegistry(log)
  return registry
}

describe('IpcRegistry.dispatch', () => {
  it('成功時回傳驗證過的資料，handler 可以發事件', async () => {
    const registry = setup()
    registerAllHandlers(registry, {
      info: { name: 'n', version: '1', platform: 'linux', packaged: false },
      projects: new ProjectManager('test'),
      keys: new MemoryVault(),
      ...testSettingsDeps(new MemoryVault()),
      now: () => 123,
    })
    const c = ctx()
    const result = await registry.dispatch({ channel: 'app.ping', payload: { message: 'hi' } }, c)
    expect(result).toEqual({ ok: true, data: { pong: 'hi', receivedAt: 123 } })
    expect(c.emitted).toEqual([
      { event: 'app.pinged', payload: { message: 'hi', receivedAt: 123 } },
    ])
  })

  it('沒有在合約定義的 channel 回傳 unknown_channel', async () => {
    const registry = setup()
    const result = await registry.dispatch({ channel: 'app.nope', payload: {} }, ctx())
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
  })

  it('原型鏈上的名稱不能當 channel', async () => {
    const registry = setup()
    for (const channel of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      const result = await registry.dispatch({ channel, payload: {} }, ctx())
      expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
    }
  })

  it('在合約內但沒有實作的 channel 也回傳 unknown_channel', async () => {
    const registry = setup()
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
  })

  it('payload 格式錯誤回傳 invalid_request，不會呼叫 handler', async () => {
    const registry = setup()
    const impl = vi.fn(() => ({ pong: '', receivedAt: 0 }))
    registry.registerHandler('app.ping', impl)
    const result = await registry.dispatch({ channel: 'app.ping', payload: { message: 42 } }, ctx())
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(impl).not.toHaveBeenCalled()
  })

  it('信封格式錯誤回傳 invalid_request', async () => {
    const registry = setup()
    for (const raw of [null, undefined, 'x', 42, {}, { payload: 1 }]) {
      const result = await registry.dispatch(raw, ctx())
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    }
  })

  it('handler 丟出 AppError 時原樣轉成型別化錯誤，並把 cause 寫進 log', async () => {
    const registry = setup()
    registry.registerHandler('app.ping', () => {
      throw new AppError({
        code: 'not_implemented',
        userMessage: '還沒做',
        retryable: true,
        cause: new Error('底層細節'),
      })
    })
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toEqual({
      ok: false,
      error: { code: 'not_implemented', retryable: true, userMessage: '還沒做' },
    })
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('底層細節'))
  })

  it('handler 丟出未知錯誤時不洩漏原始訊息，也不會讓呼叫端 throw', async () => {
    const registry = setup()
    registry.registerHandler('app.ping', () => {
      throw new Error('secret-api-key-123')
    })
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error' } })
    expect(JSON.stringify(result)).not.toContain('secret-api-key-123')
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('secret-api-key-123'))
  })

  it('async handler 的 reject 也會被接住', async () => {
    const registry = setup()
    registry.registerHandler('app.ping', () => Promise.reject(new Error('boom')))
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error' } })
  })

  it('handler 回傳不符合合約的值時回傳 invalid_response', async () => {
    const registry = setup()
    registry.registerHandler('app.ping', () => ({ pong: 1 }) as never)
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('回傳值多餘的欄位會被 schema 剔除（不會把內部資料帶出去）', async () => {
    const registry = setup()
    registry.registerHandler(
      'app.ping',
      () => ({ pong: 'x', receivedAt: 1, apiKey: 'sk-123' }) as never,
    )
    const result = await registry.dispatch(
      { channel: 'app.ping', payload: { message: 'x' } },
      ctx(),
    )
    expect(result).toEqual({ ok: true, data: { pong: 'x', receivedAt: 1 } })
  })
})

describe('IpcRegistry.registerHandler', () => {
  it('不能重複註冊同一個 channel', () => {
    const registry = setup()
    registry.registerHandler('app.ping', () => ({ pong: '', receivedAt: 0 }))
    expect(() => {
      registry.registerHandler('app.ping', () => ({ pong: '', receivedAt: 0 }))
    }).toThrow(/重複註冊/)
  })

  it('missingHandlers 列出尚未實作的 channel；registerAllHandlers 會補齊', () => {
    const registry = setup()
    expect(registry.missingHandlers()).toEqual(Object.keys(ipcContract))
    registerAllHandlers(registry, {
      info: { name: 'n', version: '1', platform: 'p', packaged: true },
      projects: new ProjectManager('test'),
      keys: new MemoryVault(),
      ...testSettingsDeps(new MemoryVault()),
    })
    expect(registry.missingHandlers()).toEqual([])
  })
})

describe('parseEventPayload', () => {
  it('合法的事件 payload 通過，不合法的丟錯', () => {
    expect(parseEventPayload('app.pinged', { message: 'a', receivedAt: 1 })).toEqual({
      message: 'a',
      receivedAt: 1,
    })
    expect(() => parseEventPayload('app.pinged', { message: 1 })).toThrow()
  })
})
