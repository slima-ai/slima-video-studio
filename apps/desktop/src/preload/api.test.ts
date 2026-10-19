import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import { createSvsApi, type Transport } from './api'

function fakeTransport(reply: unknown = { ok: true, data: { pong: 'a', receivedAt: 1 } }) {
  let eventListener: ((message: unknown) => void) | undefined
  const invoke = vi.fn(() => Promise.resolve(reply))
  const transport: Transport = {
    invoke,
    on: (channel, listener) => {
      if (channel === IPC_EVENT_CHANNEL) eventListener = listener
      return () => undefined
    },
  }
  return { transport, invoke, emit: (m: unknown) => eventListener?.(m) }
}

describe('createSvsApi', () => {
  it('暴露的物件被凍結，只有 invoke 與 on', () => {
    const api = createSvsApi(fakeTransport().transport)
    expect(Object.keys(api).sort()).toEqual(['invoke', 'on'])
    expect(Object.isFrozen(api)).toBe(true)
  })

  it('invoke 把 channel 與 payload 包成信封送出', async () => {
    const t = fakeTransport()
    const api = createSvsApi(t.transport)
    const result = await api.invoke('app.ping', { message: 'a' })
    expect(t.invoke).toHaveBeenCalledWith(IPC_INVOKE_CHANNEL, {
      channel: 'app.ping',
      payload: { message: 'a' },
    })
    expect(result).toEqual({ ok: true, data: { pong: 'a', receivedAt: 1 } })
  })

  it('沒有在合約定義的 channel 不會送到主行程', async () => {
    const t = fakeTransport()
    const api = createSvsApi(t.transport)
    const result = await (api.invoke as (c: string, p: unknown) => ReturnType<typeof api.invoke>)(
      'fs.readFile',
      { path: '/etc/passwd' },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
    expect(t.invoke).not.toHaveBeenCalled()
  })

  it('主行程回了不合格式的東西時，變成 invalid_response', async () => {
    const api = createSvsApi(fakeTransport('garbage').transport)
    const result = await api.invoke('app.ping', { message: 'a' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('on 收到事件、可以取消訂閱', () => {
    const t = fakeTransport()
    const api = createSvsApi(t.transport)
    const listener = vi.fn()
    const off = api.on('app.pinged', listener)
    t.emit({ name: 'app.pinged', payload: { message: 'hi', receivedAt: 5 } })
    expect(listener).toHaveBeenCalledWith({ message: 'hi', receivedAt: 5 })
    off()
    t.emit({ name: 'app.pinged', payload: { message: 'again', receivedAt: 6 } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('不合格式或未定義的事件會被丟棄', () => {
    const t = fakeTransport()
    const api = createSvsApi(t.transport)
    const listener = vi.fn()
    api.on('app.pinged', listener)
    t.emit({ name: 'app.pinged', payload: { message: 1 } })
    t.emit({ name: 'other.event', payload: {} })
    t.emit('garbage')
    expect(listener).not.toHaveBeenCalled()
  })

  it('訂閱未定義的事件名稱時回傳無作用的取消函式', () => {
    const api = createSvsApi(fakeTransport().transport)
    const off = (api.on as (e: string, l: () => void) => () => void)('nope', () => undefined)
    off()
    expect(typeof off).toBe('function')
  })
})
