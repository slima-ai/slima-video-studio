import { AppError, type NodeRun } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { FOR_EACH_NODE } from './builtin'
import { WorkflowValidationError } from './graph'
import { Engine, type EngineEvent } from './runner'
import { MemoryRunStore } from './store'
import { bodyOf, forEachWorkflow, testRegistry, wf } from './test-helpers'

const setup = (deps: ConstructorParameters<typeof Engine>[0] = {}) => {
  const { registry, probe } = testRegistry()
  const store = new MemoryRunStore()
  const engine = new Engine({ registry, store, ...deps })
  return { engine, probe, store }
}

const status = (nodeRuns: NodeRun[], nodeId: string): string | undefined =>
  nodeRuns.find((n) => n.nodeId === nodeId)?.status

const chain = (value = 'hello', upperParams: Record<string, unknown> = {}) =>
  wf(
    [
      { id: 'src', type: 'test.source', params: { value } },
      { id: 'up', type: 'test.upper', params: upperParams },
      { id: 'img', type: 'test.image' },
    ],
    [
      ['src', 'value', 'up', 'text'],
      ['up', 'text', 'img', 'text'],
    ],
  )

describe('Engine.run 基本行為', () => {
  it('依相依順序執行，資料沿著連線傳遞', async () => {
    const { engine, probe } = setup()
    const result = await engine.run(chain())
    expect(result.run.status).toBe('succeeded')
    expect(result.outputs.get('img')).toEqual({ image: { prompt: 'HELLO' } })
    expect(probe.calls).toEqual({ 'test.source': 1, 'test.upper': 1, 'test.image': 1 })
    expect(result.nodeRuns.map((n) => n.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(result.nodeRuns.every((n) => /^[0-9a-f]{64}$/.test(n.cacheKey))).toBe(true)
  })

  it('工作流不合法時直接丟出可讀的錯誤，什麼節點都不會執行', async () => {
    const { engine, probe } = setup()
    const bad = wf(
      [
        { id: 'a', type: 'test.upper' },
        { id: 'b', type: 'test.upper' },
      ],
      [
        ['a', 'text', 'b', 'text'],
        ['b', 'text', 'a', 'text'],
      ],
    )
    await expect(engine.run(bad)).rejects.toBeInstanceOf(WorkflowValidationError)
    expect(probe.calls).toEqual({})
  })

  it('Run 與 NodeRun 都寫進 store，並發出事件', async () => {
    const events: EngineEvent[] = []
    const { engine, store } = setup({ onEvent: (e) => events.push(e) })
    const { run } = await engine.run(chain(), { projectId: 'p1' })
    expect(store.runs.get(run.id)).toMatchObject({ status: 'succeeded', projectId: 'p1' })
    expect(store.nodeRuns.size).toBe(3)
    expect(events[0]?.type).toBe('run-started')
    expect(events.at(-1)).toEqual({ type: 'run-finished', runId: run.id, status: 'succeeded' })
    expect(events.filter((e) => e.type === 'node-started')).toHaveLength(3)
    expect(events.filter((e) => e.type === 'node-finished')).toHaveLength(3)
  })

  it('沒有相依關係的節點會同時執行', async () => {
    const { engine, probe } = setup()
    const w = wf(
      [1, 2, 3].map((i) => ({
        id: `s${String(i)}`,
        type: 'test.source',
        params: { delayMs: 30, value: String(i) },
      })),
    )
    await engine.run(w)
    expect(probe.maxRunning).toBe(3)
  })

  it('maxConcurrency 限制同時執行的節點數', async () => {
    const { engine, probe } = setup({ maxConcurrency: 2 })
    const w = wf(
      [1, 2, 3, 4].map((i) => ({
        id: `s${String(i)}`,
        type: 'test.source',
        params: { delayMs: 20, value: String(i) },
      })),
    )
    const result = await engine.run(w)
    expect(result.run.status).toBe('succeeded')
    expect(probe.maxRunning).toBe(2)
  })

  it('有相依關係的節點不會提早執行', async () => {
    const { engine, probe } = setup()
    const w = wf(
      [
        { id: 'a', type: 'test.source', params: { delayMs: 30 } },
        { id: 'b', type: 'test.upper' },
      ],
      [['a', 'value', 'b', 'text']],
    )
    await engine.run(w)
    expect(probe.maxRunning).toBe(1)
  })

  it('節點輸出和定義不符時視為失敗', async () => {
    const { engine } = setup()
    const result = await engine.run(wf([{ id: 'x', type: 'test.bad-output' }]))
    const failed = result.nodeRuns[0]
    expect(failed?.status).toBe('failed')
    expect(failed?.error?.code).toBe('invalid_response')
    expect(failed?.error?.userMessage).toContain('缺少 value')
  })
})

describe('快取', () => {
  it('第二次執行同一張圖：0 次實際呼叫，全部沿用快取', async () => {
    const { engine, probe } = setup()
    const first = await engine.run(chain())
    expect(probe.calls['test.image']).toBe(1)
    const second = await engine.run(chain())
    expect(probe.calls).toEqual({ 'test.source': 1, 'test.upper': 1, 'test.image': 1 })
    expect(second.nodeRuns.map((n) => n.status)).toEqual(['cached', 'cached', 'cached'])
    expect(second.outputs.get('img')).toEqual(first.outputs.get('img'))
    expect(second.nodeRuns[2]?.outputHash).toBe(first.nodeRuns[2]?.outputHash)
  })

  it('改一個上游參數，只有它和它的下游重跑，其他分支仍沿用快取', async () => {
    const { engine, probe } = setup()
    const w = (value: string) =>
      wf(
        [
          { id: 'a', type: 'test.source', params: { value } },
          { id: 'b', type: 'test.source', params: { value: 'fixed' } },
          { id: 'up', type: 'test.upper' },
          { id: 'cat', type: 'test.concat' },
        ],
        [
          ['a', 'value', 'up', 'text'],
          ['up', 'text', 'cat', 'a'],
          ['b', 'value', 'cat', 'b'],
        ],
      )
    await engine.run(w('one'))
    const before = { ...probe.calls }
    const result = await engine.run(w('two'))
    expect(status(result.nodeRuns, 'a')).toBe('succeeded')
    expect(status(result.nodeRuns, 'up')).toBe('succeeded')
    expect(status(result.nodeRuns, 'cat')).toBe('succeeded')
    expect(status(result.nodeRuns, 'b')).toBe('cached')
    expect(probe.calls['test.source']).toBe((before['test.source'] ?? 0) + 1)
    expect(probe.calls['test.upper']).toBe((before['test.upper'] ?? 0) + 1)
    expect(result.outputs.get('cat')).toEqual({ text: 'TWOfixed' })
  })

  it('上游輸出沒變時，即使上游重跑，下游仍然命中快取', async () => {
    const { engine, probe } = setup()
    // test.random 不快取、每次輸出不同；但 up 的輸入是固定的 source，所以 up 命中
    const w = wf(
      [
        { id: 'src', type: 'test.source', params: { value: 'same', delayMs: 0 } },
        { id: 'rnd', type: 'test.random' },
        { id: 'up', type: 'test.upper' },
      ],
      [['src', 'value', 'up', 'text']],
    )
    await engine.run(w)
    await engine.run(w)
    expect(probe.calls['test.random']).toBe(2)
    expect(probe.calls['test.upper']).toBe(1)
    expect(probe.calls['test.source']).toBe(1)
  })

  it('cacheable: false 的節點每次都重跑，下游因為輸入雜湊不同而跟著重跑', async () => {
    const { engine, probe } = setup()
    const w = wf(
      [
        { id: 'rnd', type: 'test.random' },
        { id: 'up', type: 'test.upper' },
      ],
      [['rnd', 'value', 'up', 'text']],
    )
    await engine.run(w)
    await engine.run(w)
    expect(probe.calls['test.random']).toBe(2)
    expect(probe.calls['test.upper']).toBe(2)
  })

  it('節點版本、模型 ID 不同時不會誤用舊快取', async () => {
    const { engine, probe } = setup()
    await engine.run(wf([{ id: 'a', type: 'test.source', modelId: 'model-1' }]))
    await engine.run(wf([{ id: 'a', type: 'test.source', modelId: 'model-2' }]))
    await engine.run(wf([{ id: 'a', type: 'test.source', modelId: 'model-1' }]))
    expect(probe.calls['test.source']).toBe(2)
  })

  it('參數的預設值與 key 順序不影響快取鍵', async () => {
    const { engine, probe } = setup()
    await engine.run(wf([{ id: 'a', type: 'test.source', params: {} }]))
    await engine.run(wf([{ id: 'a', type: 'test.source', params: { value: 'x', delayMs: 0 } }]))
    await engine.run(wf([{ id: 'a', type: 'test.source', params: { delayMs: 0, value: 'x' } }]))
    expect(probe.calls['test.source']).toBe(1)
  })

  it('失敗的結果不會被當成快取', async () => {
    const { engine, probe } = setup()
    const w = wf([{ id: 'f', type: 'test.fail' }])
    await engine.run(w)
    await engine.run(w)
    expect(probe.calls['test.fail']).toBe(2)
  })
})

describe('失敗與取消', () => {
  const diamond = () =>
    wf(
      [
        { id: 'ok', type: 'test.source' },
        { id: 'bad', type: 'test.fail' },
        { id: 'afterBad', type: 'test.upper' },
        { id: 'afterAfter', type: 'test.upper' },
        { id: 'afterOk', type: 'test.upper' },
      ],
      [
        ['bad', 'text', 'afterBad', 'text'],
        ['afterBad', 'text', 'afterAfter', 'text'],
        ['ok', 'value', 'afterOk', 'text'],
      ],
    )

  it('節點失敗時下游標記 blocked、不會執行；獨立的分支照常完成', async () => {
    const { engine, probe } = setup()
    const result = await engine.run(diamond())
    expect(result.run.status).toBe('failed')
    expect(status(result.nodeRuns, 'bad')).toBe('failed')
    expect(status(result.nodeRuns, 'afterBad')).toBe('blocked')
    expect(status(result.nodeRuns, 'afterAfter')).toBe('blocked')
    expect(status(result.nodeRuns, 'ok')).toBe('succeeded')
    expect(status(result.nodeRuns, 'afterOk')).toBe('succeeded')
    expect(probe.calls['test.upper']).toBe(1)
  })

  it('錯誤是型別化的，不會把供應商的原始訊息帶出去', async () => {
    const { engine } = setup()
    const result = await engine.run(diamond())
    const error = result.nodeRuns.find((n) => n.nodeId === 'bad')?.error
    expect(error?.code).toBe('node_failed')
    expect(JSON.stringify(error)).not.toContain('secret')
  })

  it('節點丟出 AppError 時原樣保留 code 與 retryable', async () => {
    const { registry } = testRegistry()
    const { z } = await import('zod')
    const { defineNode } = await import('./node')
    registry.register(
      defineNode({
        type: 'test.rate-limited',
        version: 1,
        inputs: {},
        outputs: { value: 'text' },
        params: z.object({}),
        run: () => {
          throw new AppError({ code: 'internal_error', userMessage: '太頻繁了', retryable: true })
        },
      }),
    )
    const engine = new Engine({ registry })
    const result = await engine.run(wf([{ id: 'r', type: 'test.rate-limited' }]))
    expect(result.nodeRuns[0]?.error).toEqual({
      code: 'internal_error',
      retryable: true,
      userMessage: '太頻繁了',
    })
  })

  it('取消：執行中的節點收到 signal，尚未開始的節點標記 cancelled', async () => {
    const { engine } = setup()
    const controller = new AbortController()
    const w = wf(
      [
        { id: 'hang', type: 'test.hang' },
        { id: 'after', type: 'test.upper' },
      ],
      [['hang', 'value', 'after', 'text']],
    )
    const promise = engine.run(w, { signal: controller.signal })
    setTimeout(() => {
      controller.abort()
    }, 20)
    const result = await promise
    expect(result.run.status).toBe('cancelled')
    expect(status(result.nodeRuns, 'hang')).toBe('cancelled')
    expect(status(result.nodeRuns, 'after')).toBe('cancelled')
  })

  it('一開始就已經取消：所有節點都不會執行', async () => {
    const { engine, probe } = setup()
    const controller = new AbortController()
    controller.abort()
    const result = await engine.run(chain(), { signal: controller.signal })
    expect(result.run.status).toBe('cancelled')
    expect(probe.calls).toEqual({})
  })
})

describe('forEach：對每個項目執行', () => {
  const status0 = (r: { nodeRuns: NodeRun[] }, i: number, id: string): string | undefined =>
    status(r.nodeRuns, `fe[${String(i)}]/${id}`)

  it('每個項目各自成為子 Run，結果依原順序收集', async () => {
    const { engine, probe } = setup()
    const result = await engine.run(forEachWorkflow(['a', 'b', 'c'], bodyOf('test.jupper')))
    expect(result.run.status).toBe('succeeded')
    expect(result.outputs.get('fe')).toEqual({ results: ['A', 'B', 'C'] })
    expect(probe.calls['test.jupper']).toBe(3)
    // 子節點的 NodeRun 指回父節點，節點 ID 帶有項目索引
    const feRun = result.nodeRuns.find((n) => n.nodeId === 'fe')
    const children = result.nodeRuns.filter((n) => n.parentNodeRunId === feRun?.id)
    expect(children).toHaveLength(9)
    expect(children.some((n) => n.nodeId === 'fe[1]/step')).toBe(true)
  })

  it('只改一個項目時，只有那個項目的子節點重跑', async () => {
    const { engine, probe } = setup()
    await engine.run(forEachWorkflow(['a', 'b', 'c'], bodyOf('test.jupper')))
    expect(probe.calls['test.jupper']).toBe(3)
    const result = await engine.run(forEachWorkflow(['a', 'b2', 'c'], bodyOf('test.jupper')))
    expect(probe.calls['test.jupper']).toBe(4)
    expect(result.outputs.get('fe')).toEqual({ results: ['A', 'B2', 'C'] })
    expect([0, 1, 2].map((i) => status0(result, i, 'step'))).toEqual([
      'cached',
      'succeeded',
      'cached',
    ])
  })

  it('完全沒改時 0 次實際呼叫', async () => {
    const { engine, probe } = setup()
    await engine.run(forEachWorkflow(['a', 'b'], bodyOf('test.jupper')))
    await engine.run(forEachWorkflow(['a', 'b'], bodyOf('test.jupper')))
    expect(probe.calls['test.jupper']).toBe(2)
  })

  it('concurrency 限制同時處理的項目數', async () => {
    const { engine, probe } = setup()
    const w = forEachWorkflow([1, 2, 3, 4, 5, 6], bodyOf('test.jupper', { delayMs: 15 }), {
      concurrency: 2,
    })
    const result = await engine.run(w)
    expect(result.run.status).toBe('succeeded')
    expect(probe.maxRunning).toBe(2)
  })

  it('maxConcurrency 很小時，forEach 也不會卡死', async () => {
    const { engine } = setup({ maxConcurrency: 1 })
    const result = await engine.run(forEachWorkflow(['x', 'y', 'z'], bodyOf('test.jupper')))
    expect(result.outputs.get('fe')).toEqual({ results: ['X', 'Y', 'Z'] })
  })

  it('某個項目失敗：forEach 失敗，其他項目仍然完成', async () => {
    const { engine } = setup()
    const result = await engine.run(forEachWorkflow(['ok1', 'boom', 'ok2'], bodyOf('test.picky')))
    expect(result.run.status).toBe('failed')
    const fe = result.nodeRuns.find((n) => n.nodeId === 'fe')
    expect(fe?.status).toBe('failed')
    expect(fe?.error?.userMessage).toContain('1 個項目執行失敗')
    expect(status0(result, 0, 'step')).toBe('succeeded')
    expect(status0(result, 1, 'step')).toBe('failed')
    expect(status0(result, 1, 'out')).toBe('blocked')
    expect(status0(result, 2, 'step')).toBe('succeeded')
  })

  it('輸入不是陣列時失敗並給出明確訊息', async () => {
    const { registry } = testRegistry()
    const engine = new Engine({ registry })
    const w = wf(
      [
        { id: 'items', type: 'test.items', params: { items: [] } },
        { id: 'fe', type: FOR_EACH_NODE, params: { body: bodyOf('test.jupper') } },
      ],
      [['items', 'items', 'fe', 'items']],
    )
    // 繞過 test.items 的陣列限制：直接把非陣列值當輸出
    registry.get('test.items')
    const notArray = testRegistry()
    const { z } = await import('zod')
    const { defineNode } = await import('./node')
    notArray.registry.register(
      defineNode({
        type: 'test.scalar',
        version: 1,
        inputs: {},
        outputs: { items: 'json' },
        params: z.object({}),
        run: () => ({ items: 'not-an-array' }),
      }),
    )
    const result = await new Engine({ registry: notArray.registry }).run(
      wf(
        [
          { id: 'items', type: 'test.scalar' },
          { id: 'fe', type: FOR_EACH_NODE, params: { body: bodyOf('test.jupper') } },
        ],
        [['items', 'items', 'fe', 'items']],
      ),
    )
    const fe = result.nodeRuns.find((n) => n.nodeId === 'fe')
    expect(fe?.status).toBe('failed')
    expect(fe?.error?.userMessage).toContain('陣列')
    expect(w.nodes).toHaveLength(2)
    expect(engine).toBeDefined()
  })

  it('空陣列得到空結果', async () => {
    const { engine } = setup()
    const result = await engine.run(forEachWorkflow([], bodyOf('test.jupper')))
    expect(result.outputs.get('fe')).toEqual({ results: [] })
  })

  it('取消時子 Run 也會停止', async () => {
    const { engine } = setup()
    const controller = new AbortController()
    const promise = engine.run(
      forEachWorkflow([1, 2, 3, 4], bodyOf('test.jupper', { delayMs: 40 }), { concurrency: 1 }),
      { signal: controller.signal },
    )
    setTimeout(() => {
      controller.abort()
    }, 30)
    const result = await promise
    expect(result.run.status).toBe('cancelled')
  })
})
