import type { CanvasNode } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { diffMarks, marksOf, withAiChangeNotice, type CanvasMarks } from './ai-changes'
import { NEW_SHOT_DESCRIPTION } from '../shots/defaults'
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
      removed: [{ key: 'shot:b', title: '第 2 鏡', kind: 'shot', empty: true }],
    })
  })

  it('只是被自動排版挪動、或步驟展開，不算改過', () => {
    const before = marks(node('shot:a', { x: 0, y: 0, auto: true, expanded: false }))
    const after = marks(node('shot:a', { x: 300, y: 120, auto: false, expanded: true, width: 9 }))
    expect(diffMarks(before, after)).toEqual({ changed: [], added: [], removed: [] })
  })
})

describe('diffMarks：刪掉的格子帶「是不是空的」與內容摘要（提示用）', () => {
  it('鏡頭：沒描述（或還是新增時預設的那句）、沒旁白、沒圖影片才算空的；有描述的帶摘要', () => {
    const before = marks(
      node('shot:a', { title: '第 1 鏡', summary: NEW_SHOT_DESCRIPTION }),
      node('shot:b', { title: '第 2 鏡', summary: '看見暖光' }),
      node('shot:c', { title: '第 3 鏡' }),
      node('shot:c:image', { kind: 'image', shotKey: 'shot:c', assetHash: 'a'.repeat(64) }),
    )
    const removed = diffMarks(before, marks()).removed
    expect(removed.find((r) => r.key === 'shot:a')).toMatchObject({ empty: true })
    expect(removed.find((r) => r.key === 'shot:b')).toMatchObject({
      empty: false,
      summary: '看見暖光',
    })
    // 已經生成過圖：不算空的
    expect(removed.find((r) => r.key === 'shot:c')).toMatchObject({ empty: false })
  })

  it('場：裡面沒有鏡頭才算空的', () => {
    const before = marks(
      node('scene:a', { kind: 'scene', title: '第 1 場・示範短片' }),
      node('scene:b', { kind: 'scene', title: '第 2 場・示範短片' }),
      node('shot:x', { sceneKey: 'scene:b' }),
    )
    const removed = diffMarks(before, marks()).removed
    expect(removed.find((r) => r.key === 'scene:a')).toMatchObject({ empty: true })
    expect(removed.find((r) => r.key === 'scene:b')).toMatchObject({ empty: false })
  })
})

describe('diffMarks：只標真的有新內容的格子（不標只是跟著上游變了狀態的）', () => {
  const video = (over: Partial<CanvasNode> = {}): CanvasNode =>
    node('shot:a:video', { kind: 'video', title: '第 1 鏡・影片', status: 'idle', ...over })

  it('被 AI 直接改的格子（鏡頭描述）照標', () => {
    const before = marks(node('shot:a', { summary: '舊的描述' }))
    const after = marks(node('shot:a', { summary: '小機器人坐在旋轉木馬旁' }))
    expect(diffMarks(before, after).changed).toEqual(['shot:a'])
  })

  it('有新結果的格子（首幀做完：縮圖、版本、模型、花費）照標，狀態跟著變也一樣標', () => {
    const before = marks(node('shot:a:image', { kind: 'image', status: 'running' }))
    const after = marks(
      node('shot:a:image', {
        kind: 'image',
        status: 'done',
        assetHash: 'a'.repeat(64),
        version: 1,
        modelId: 'mock/image',
        summary: '示範圖片',
        usage: { durationMs: 64, createdAt: '2026-10-21T00:00:00.000Z' },
      }),
    )
    expect(diffMarks(before, after).changed).toEqual(['shot:a:image'])
  })

  it('只是因為上游變了而狀態改變（排隊中、需要重跑、失敗原因）的格子不標', () => {
    const before = marks(
      video(),
      node('shot:b:video', { kind: 'video', status: 'done', assetHash: 'b'.repeat(64) }),
    )
    const after = marks(
      video({ status: 'queued' }),
      node('shot:b:video', {
        kind: 'video',
        status: 'stale',
        assetHash: 'b'.repeat(64),
        error: '要重跑',
      }),
    )
    expect(diffMarks(before, after)).toEqual({ changed: [], added: [], removed: [] })
  })
})

describe('diffMarks：只是編號或順序跟著變的格子不算改（刪掉第 3 鏡，原本的第 4 鏡變成第 3 鏡）', () => {
  const shotNodes = (n: number, over: Partial<CanvasNode> = {}): CanvasNode[] => [
    node('shot:d', { title: `第 ${String(n)} 鏡`, summary: '描述', ...over }),
    node('shot:d:image', { kind: 'image', title: `第 ${String(n)} 鏡・第一張畫面` }),
    node('shot:d:video', { kind: 'video', title: `第 ${String(n)} 鏡・影片` }),
  ]

  it('標題裡的「第 N 鏡」變了、內容沒變：鏡頭、首幀圖、影片都不標', () => {
    expect(diffMarks(marks(...shotNodes(4)), marks(...shotNodes(3)))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('場的編號（sceneNo、「第 N 場」）跟著變也不標；場名自己改了才標', () => {
    const scene = (n: number, name: string): CanvasNode =>
      node('scene:a', { kind: 'scene', title: `第 ${String(n)} 場・${name}`, sceneNo: n })
    expect(diffMarks(marks(scene(2, '街角')), marks(scene(1, '街角'))).changed).toEqual([])
    expect(diffMarks(marks(scene(2, '街角')), marks(scene(1, '碼頭'))).changed).toEqual(['scene:a'])
  })

  it('編號變了、內容也真的被改了：照標', () => {
    const changed = diffMarks(
      marks(...shotNodes(4)),
      marks(...shotNodes(3, { summary: '新的描述' })),
    )
    expect(changed.changed).toEqual(['shot:d'])
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
      expect.objectContaining({
        removed: [{ key: 'shot:a', title: 'shot:a', kind: 'shot', empty: true }],
      }),
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

  it('刪掉第 2 鏡：後面的鏡頭只是編號往前，不算 AI 改了它；被刪的那一鏡照報', async () => {
    const r = await startRealMcp()
    running.push(r)
    await r.registry.dispatch(
      { channel: 'project.createNew', payload: { name: '測試' } },
      { emit: () => undefined },
    )
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      ids.push(dataOf(z.looseObject({ id: z.string() }), await r.call('create_shot')).id)
    }
    r.broadcast.mockClear()
    await r.call('delete_shots', { shotIds: [ids[1] ?? ''] })
    const event = r.broadcast.mock.calls
      .filter(([name]) => name === 'canvas.aiChanged')
      .map(([, payload]) => payload as { changed: string[]; removed: { key: string }[] })[0]
    expect(event?.removed.map((n) => n.key)).toContain(`shot:${ids[1] ?? ''}`)
    const third = `shot:${ids[2] ?? ''}`
    expect(event?.changed.filter((key) => key.startsWith(third))).toEqual([])
  })

  it('使用者按復原／重做：哪些節點因此變了，用 canvas.marksReverted 告訴畫面，畫面才拿掉它們的「AI 剛改」', async () => {
    const r = await startRealMcp()
    running.push(r)
    const emitted: { name: string; payload: unknown }[] = []
    const ctx = {
      emit: (name: string, payload: unknown): void => {
        emitted.push({ name, payload })
      },
    }
    await r.registry.dispatch({ channel: 'project.createNew', payload: { name: '測試' } }, ctx)
    const shotId = dataOf(z.looseObject({ id: z.string() }), await r.call('create_shot')).id
    await r.call('update_shot', { shotId, description: 'AI 改的描述' })
    emitted.length = 0

    const undone = await r.registry.dispatch({ channel: 'history.undo', payload: {} }, ctx)
    expect(undone.ok && (undone.data as { applied: boolean }).applied).toBe(true)
    const reverted = emitted.filter((e) => e.name === 'canvas.marksReverted')
    expect(reverted).toHaveLength(1)
    expect(reverted[0]?.payload).toMatchObject({ direction: 'undo' })
    expect((reverted[0]?.payload as { keys: string[] }).keys).toContain(`shot:${shotId}`)

    emitted.length = 0
    await r.registry.dispatch({ channel: 'history.redo', payload: {} }, ctx)
    expect(emitted.find((e) => e.name === 'canvas.marksReverted')?.payload).toMatchObject({
      direction: 'redo',
    })

    // 沒有可復原的（退到底再按一次）：什麼都不發
    emitted.length = 0
    await r.registry.dispatch({ channel: 'history.undo', payload: {} }, ctx)
    await r.registry.dispatch({ channel: 'history.undo', payload: {} }, ctx)
    await r.registry.dispatch({ channel: 'history.undo', payload: {} }, ctx)
    emitted.length = 0
    const nothing = await r.registry.dispatch({ channel: 'history.undo', payload: {} }, ctx)
    expect(nothing.ok && (nothing.data as { applied: boolean }).applied).toBe(false)
    expect(emitted.filter((e) => e.name === 'canvas.marksReverted')).toEqual([])
  })
})
