import { ipcContract, type IpcChannel } from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import { CHANGE_EVENTS, withChangeEvents } from './change-events'
import { createIpcRegistry, type HandlerContext } from './registry'

const log = { warn: vi.fn(), error: vi.fn() }
const ctx = (): HandlerContext & { emitted: string[] } => {
  const emitted: string[] = []
  return {
    emitted,
    emit: (event) => {
      emitted.push(event)
    },
  }
}

describe('角色、地點、大綱的變更事件', () => {
  it('改角色成功之後發 characters.changed；失敗不發', async () => {
    const registry = withChangeEvents(createIpcRegistry(log))
    let fail = false
    registry.registerHandler('characters.update', () => {
      if (fail) throw new Error('壞了')
      return {
        id: 'c1',
        name: '阿鐵',
        appearance: '',
        personality: '',
        outfit: '',
        anchorStatus: 'none',
        anchorText: '',
        version: 0,
        updatedAt: '2026-10-13T00:00:00.000Z',
      } as never
    })
    const ok = ctx()
    await registry.dispatch(
      { channel: 'characters.update', payload: { characterId: 'c1', patch: { name: '阿鐵' } } },
      ok,
    )
    expect(ok.emitted).toEqual(['characters.changed'])

    fail = true
    const bad = ctx()
    const result = await registry.dispatch(
      { channel: 'characters.update', payload: { characterId: 'c1', patch: { name: '阿鐵' } } },
      bad,
    )
    expect(result.ok).toBe(false)
    expect(bad.emitted).toEqual([])
  })

  it('改大綱同時通知地點頁（地點名字存在大綱）；復原／重做三種都發', () => {
    expect(CHANGE_EVENTS['outline.edit']).toEqual(['outline.changed', 'locations.changed'])
    for (const channel of ['history.undo', 'history.redo', 'canvas.paste'] as const) {
      expect(CHANGE_EVENTS[channel]).toEqual([
        'characters.changed',
        'locations.changed',
        'outline.changed',
      ])
    }
  })

  it('表上的每個 channel 都在合約裡；只讀的 channel 不發事件', async () => {
    for (const channel of Object.keys(CHANGE_EVENTS)) {
      expect(Object.keys(ipcContract)).toContain(channel)
    }
    const registry = withChangeEvents(createIpcRegistry(log))
    registry.registerHandler('characters.list', () => ({ characters: [] }))
    const c = ctx()
    await registry.dispatch({ channel: 'characters.list' satisfies IpcChannel, payload: {} }, c)
    expect(c.emitted).toEqual([])
  })
})
