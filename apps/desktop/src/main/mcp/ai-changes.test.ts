import type { CanvasNode } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { diffMarks, marksOf, withAiChangeNotice, type CanvasMarks } from './ai-changes'
import type { McpCaller } from './bridge'
import { dataOf, startRealMcp } from './test-support'

const node = (key: string, over: Partial<CanvasNode> = {}): CanvasNode => ({
  key,
  kind: 'shot',
  x: 0,
  y: 0,
  auto: true,
  title: key,
  ...over,
})
const marks = (...nodes: CanvasNode[]): CanvasMarks => marksOf({ nodes })

describe('diffMarks：AI 前後的畫布差在哪', () => {
  it('內容變了、新出現、不見了各自歸類；刪掉的帶標題與種類', () => {
    const before = marks(node('shot:a', { title: '第 1 鏡' }), node('shot:b', { title: '第 2 鏡' }))
    const after = marks(node('shot:a', { title: '第 1 鏡', summary: '改過了' }), node('shot:c'))
    expect(diffMarks(before, after)).toEqual({
      changed: ['shot:a'],
      added: ['shot:c'],
      removed: [{ key: 'shot:b', title: '第 2 鏡', kind: 'shot' }],
    })
  })

  it('只是被自動排版挪動、或步驟展開，不算改過', () => {
    const before = marks(node('shot:a', { x: 0, y: 0, auto: true, expanded: false }))
    const after = marks(node('shot:a', { x: 300, y: 120, auto: false, expanded: true, width: 9 }))
    expect(diffMarks(before, after)).toEqual({ changed: [], added: [], removed: [] })
  })
})

describe('withAiChangeNotice', () => {
  const inner = (): McpCaller & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      call: vi.fn((channel: string) => {
        calls.push(channel)
        return Promise.resolve({})
      }) as unknown as McpCaller['call'],
    }
  }

  it('會改畫布的呼叫：有變動就發 canvas.aiChanged，帶通道名與時間', async () => {
    const states = [marks(node('shot:a')), marks(node('shot:a'), node('shot:b'))]
    const emit = vi.fn()
    const caller = withAiChangeNotice(inner(), {
      marks: () => Promise.resolve(states.shift()),
      emit,
      now: () => new Date('2026-10-20T10:00:00.000Z'),
    })
    await caller.call('shots.create', {})
    expect(emit).toHaveBeenCalledWith('canvas.aiChanged', {
      at: '2026-10-20T10:00:00.000Z',
      channel: 'shots.create',
      changed: [],
      added: ['shot:b'],
      removed: [],
    })
  })

  it('沒有變動、只讀的呼叫、換專案：都不發，也不取畫布', async () => {
    const emit = vi.fn()
    const read = vi.fn(() => Promise.resolve(marks(node('shot:a'))))
    const caller = withAiChangeNotice(inner(), { marks: read, emit })
    await caller.call('shots.update', {} as never)
    expect(emit).not.toHaveBeenCalled()
    read.mockClear()
    await caller.call('shots.list', {})
    await caller.call('project.open', {} as never)
    expect(read).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('呼叫失敗也要比較（失敗前可能已經改了一部分），而且錯誤照樣丟出去', async () => {
    const states = [marks(node('shot:a')), marks()]
    const emit = vi.fn()
    const failing: McpCaller = { call: () => Promise.reject(new Error('壞了')) }
    const caller = withAiChangeNotice(failing, {
      marks: () => Promise.resolve(states.shift()),
      emit,
    })
    await expect(caller.call('shots.delete', {} as never)).rejects.toThrow('壞了')
    expect(emit).toHaveBeenCalledWith(
      'canvas.aiChanged',
      expect.objectContaining({ removed: [{ key: 'shot:a', title: 'shot:a', kind: 'shot' }] }),
    )
  })

  it('取不到畫布（沒開專案）就不發，也不影響呼叫', async () => {
    const emit = vi.fn()
    const base = inner()
    const caller = withAiChangeNotice(base, { marks: () => Promise.resolve(undefined), emit })
    await caller.call('shots.create', {})
    expect(base.calls).toEqual(['shots.create'])
    expect(emit).not.toHaveBeenCalled()
  })
})

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

describe('真的 MCP 伺服器：AI 工具改了鏡頭，畫面收到 canvas.aiChanged', () => {
  it('create_shot → 新的鏡頭節點；delete_shots → 刪掉的帶「第 N 鏡」標題', async () => {
    const r = await startRealMcp()
    running.push(r)
    await r.registry.dispatch(
      { channel: 'project.createNew', payload: { name: '測試' } },
      { emit: () => undefined },
    )
    r.broadcast.mockClear()

    const created = dataOf(z.looseObject({ id: z.string() }), await r.call('create_shot'))
    const events = (): {
      channel: string
      changed: string[]
      added: string[]
      removed: { key: string; title: string }[]
    }[] =>
      r.broadcast.mock.calls
        .filter(([name]) => name === 'canvas.aiChanged')
        .map(([, payload]) => payload as never)
    expect(events()).toHaveLength(1)
    expect(events()[0]?.channel).toBe('shots.create')
    expect(events()[0]?.added).toContain(`shot:${created.id}`)

    r.broadcast.mockClear()
    await r.call('delete_shots', { shotIds: [created.id] })
    const removed = events()[0]?.removed ?? []
    expect(removed.find((n) => n.key === `shot:${created.id}`)?.title).toMatch(/第 \d+ 鏡/)

    // 只讀的工具不發
    r.broadcast.mockClear()
    await r.call('list_shots')
    expect(events()).toHaveLength(0)
  })
})
