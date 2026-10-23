import { type Budget } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import {
  MemoryCostLedger,
  budgetExceededError,
  checkBudget,
  estimateWorkflowCost,
  type CostEstimate,
} from './budget'
import { Engine, type EngineEvent } from './runner'
import { bodyOf, forEachWorkflow, testRegistry, wf } from './test-helpers'

const setup = () => {
  const { registry, probe } = testRegistry()
  const ledger = new MemoryCostLedger()
  const events: EngineEvent[] = []
  const engine = new Engine({
    registry,
    ledger,
    onEvent: (e) => events.push(e),
  })
  return { engine, registry, probe, ledger, events }
}

const paid = (id: string, cost: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'test.paid',
  modelId: 'fal/kling-3.0-pro',
  params: { cost, ...extra },
})

describe('checkBudget', () => {
  const budget: Budget = { perRunLimitUsd: 5, projectLimitUsd: 20 }

  it('剛好等於上限不算超過，超過一點點就算', () => {
    expect(checkBudget({ budget, runProjectedUsd: 5, projectBaseUsd: 0 })).toBeUndefined()
    expect(
      checkBudget({ budget, runProjectedUsd: 0.1 + 0.2 + 4.7, projectBaseUsd: 0 }),
    ).toBeUndefined()
    expect(checkBudget({ budget, runProjectedUsd: 5.01, projectBaseUsd: 0 })).toEqual({
      scope: 'run',
      limitUsd: 5,
      projectedUsd: 5.01,
    })
  })

  it('專案累計加上這次預估超過專案上限，回報 project；沒設專案上限就不檢查', () => {
    expect(checkBudget({ budget, runProjectedUsd: 3, projectBaseUsd: 18 })).toEqual({
      scope: 'project',
      limitUsd: 20,
      projectedUsd: 21,
    })
    expect(
      checkBudget({ budget: { perRunLimitUsd: 5 }, runProjectedUsd: 3, projectBaseUsd: 1e6 }),
    ).toBeUndefined()
  })
})

describe('estimateWorkflowCost', () => {
  it('加總各節點的預估費用；沒有 estimateCost 的節點是 0', () => {
    const { registry } = setup()
    const flow = wf(
      [{ id: 'src', type: 'test.source' }, paid('a', 0.5), paid('b', 1.25)],
      [['src', 'value', 'a', 'text']],
    )
    const estimate = estimateWorkflowCost(flow, registry)
    expect(estimate).toEqual<CostEstimate>({
      totalUsd: 1.75,
      byNode: { src: 0, a: 0.5, b: 1.25 },
      uncertainNodeIds: [],
    })
  })

  it('預估需要執行時才有的輸入：標記為無法預估，總額只是下限', () => {
    const { registry } = setup()
    const flow = wf(
      [{ id: 'src', type: 'test.source' }, { id: 'dyn', type: 'test.dynamic' }, paid('a', 2)],
      [['src', 'value', 'dyn', 'text']],
    )
    const estimate = estimateWorkflowCost(flow, registry)
    expect(estimate.uncertainNodeIds).toEqual(['dyn'])
    expect(estimate.totalUsd).toBe(2)
  })

  it('對每個項目執行：有給項目數就乘上子工作流的花費，沒給就標為無法預估', () => {
    const { registry } = setup()
    const flow = forEachWorkflow(['a', 'b'], bodyOf('test.jpaid', { cost: 1.5 }))
    expect(estimateWorkflowCost(flow, registry, { itemCounts: { fe: 4 } })).toMatchObject({
      totalUsd: 6,
      uncertainNodeIds: [],
    })
    expect(estimateWorkflowCost(flow, registry)).toMatchObject({
      totalUsd: 0,
      uncertainNodeIds: ['fe'],
    })
  })
})

describe('MemoryCostLedger', () => {
  it('依專案累計', () => {
    const ledger = new MemoryCostLedger()
    const base = { provider: 'fal', modelId: 'fal/x', estimated: false }
    ledger.record({ ...base, projectId: 'p1', amountUsd: 0.1 })
    ledger.record({ ...base, projectId: 'p1', amountUsd: 0.2 })
    ledger.record({ ...base, projectId: 'p2', amountUsd: 5 })
    expect(ledger.totalUsd('p1')).toBeCloseTo(0.3)
    expect(ledger.totalUsd('nobody')).toBe(0)
    expect(ledger.entries[0]?.id).toBeTruthy()
  })
})

describe('Engine 預算：執行前估算', () => {
  it('估算超過上限就一個任務都不送，也不留下 Run', async () => {
    const { engine, probe, events, ledger } = setup()
    const flow = wf([paid('a', 3), paid('b', 3)])
    await expect(engine.run(flow, { budget: { perRunLimitUsd: 5 } })).rejects.toMatchObject({
      code: 'budget_exceeded',
      retryable: false,
    })
    expect(probe.calls).toEqual({})
    expect(ledger.entries).toHaveLength(0)
    expect(events).toEqual([
      { type: 'budget-exceeded', runId: null, scope: 'run', limitUsd: 5, projectedUsd: 6 },
    ])
  })

  it('超過單次上限的訊息用設定頁的名字，並說到哪裡調；專案上限的訊息不提「單次花費上限」', () => {
    const run = budgetExceededError({ scope: 'run', projectedUsd: 5.5, limitUsd: 5 }).userMessage
    expect(run).toContain('超過「單次花費上限」 US$5.00')
    expect(run).toContain('到「設定 → 一般」調高「單次花費上限」')
    expect(run).not.toContain('單次執行')
    const project = budgetExceededError({
      scope: 'project',
      projectedUsd: 12,
      limitUsd: 10,
    }).userMessage
    expect(project).toContain('超過專案的上限 US$10.00')
    expect(project).not.toContain('單次花費上限')
  })

  it('預設單次上限是 US$5：5 元可以跑、5.5 元不行', async () => {
    const { engine } = setup()
    await expect(engine.run(wf([paid('a', 5)]))).resolves.toMatchObject({
      run: { status: 'succeeded', estimatedCostUsd: 5 },
    })
    await expect(engine.run(wf([paid('a', 5.5)]))).rejects.toThrow(
      /US\$5\.50.*「單次花費上限」.*US\$5\.00/,
    )
  })

  it('專案累計花費加上這次預估超過專案上限也會擋下', async () => {
    const { engine, ledger, probe } = setup()
    ledger.record({
      projectId: 'p1',
      provider: 'fal',
      modelId: 'fal/x',
      amountUsd: 9,
      estimated: false,
    })
    const budget = { perRunLimitUsd: 5, projectLimitUsd: 10 }
    await expect(engine.run(wf([paid('a', 2)]), { projectId: 'p1', budget })).rejects.toThrow(
      /專案/,
    )
    expect(probe.calls).toEqual({})
    // 別的專案不受影響
    await expect(engine.run(wf([paid('a', 2)]), { projectId: 'p2', budget })).resolves.toBeDefined()
  })

  it('提供項目數時，對每個項目執行的預估也會被擋下', async () => {
    const { engine, probe } = setup()
    const flow = forEachWorkflow(['a', 'b', 'c'], bodyOf('test.jpaid', { cost: 2 }))
    await expect(engine.run(flow, { itemCounts: { fe: 3 } })).rejects.toMatchObject({
      code: 'budget_exceeded',
    })
    expect(probe.calls).toEqual({})
  })
})

describe('Engine 預算：花費入帳', () => {
  it('優先用節點回報的實際金額，加總寫進帳本與 Run', async () => {
    const { engine, ledger, events } = setup()
    const flow = wf([paid('a', 1, { actual: 0.3 }), paid('b', 1, { actual: 0.55 })])
    const { run } = await engine.run(flow, { projectId: 'p1' })

    expect(run.estimatedCostUsd).toBe(2)
    expect(run.actualCostUsd).toBeCloseTo(0.85)
    expect(ledger.entries).toHaveLength(2)
    expect(ledger.entries.every((e) => !e.estimated && e.provider === 'fal')).toBe(true)
    expect(ledger.entries.every((e) => e.runId === run.id && e.projectId === 'p1')).toBe(true)
    expect(ledger.totalUsd('p1')).toBeCloseTo(0.85)
    expect(events.filter((e) => e.type === 'cost-recorded')).toHaveLength(2)
  })

  it('每筆花費記著是哪個節點執行產生的（實際金額與估算都一樣）', async () => {
    const { engine, ledger } = setup()
    const flow = wf([paid('a', 1, { actual: 0.3 }), paid('b', 0.4)])
    const { nodeRuns } = await engine.run(flow, { projectId: 'p1' })
    const nodeRunOf = (nodeId: string) => nodeRuns.find((r) => r.nodeId === nodeId)?.id
    expect(ledger.entries.map((e) => e.nodeRunId).sort()).toEqual(
      [nodeRunOf('a'), nodeRunOf('b')].sort(),
    )
  })

  it('節點沒回報時用估算值入帳並標記為估算；供應商取自 modelId', async () => {
    const { engine, ledger } = setup()
    const { run } = await engine.run(wf([paid('a', 0.4), { id: 'free', type: 'test.source' }]))
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toMatchObject({
      provider: 'fal',
      modelId: 'fal/kling-3.0-pro',
      amountUsd: 0.4,
      estimated: true,
    })
    expect(run.actualCostUsd).toBeCloseTo(0.4)
  })

  it('沒有指定模型時供應商記為 unknown；沿用快取的節點不再收費', async () => {
    const { engine, ledger } = setup()
    const flow = wf([{ id: 'a', type: 'test.paid', params: { cost: 1 } }])
    await engine.run(flow)
    const second = await engine.run(flow)
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toMatchObject({ provider: 'unknown', modelId: 'test.paid' })
    expect(second.run.actualCostUsd).toBe(0)
    expect(second.nodeRuns[0]?.status).toBe('cached')
  })

  it('節點失敗且沒回報金額就不收費', async () => {
    const { engine, ledger } = setup()
    const flow = wf([{ id: 'boom', type: 'test.fail' }, paid('a', 1)])
    const { run } = await engine.run(flow)
    expect(run.status).toBe('failed')
    expect(ledger.entries).toHaveLength(1) // 只有 a
  })
})

describe('Engine 預算：執行中超過上限', () => {
  it('預估在執行前看不出來，節點啟動時依實際輸入再檢查：停下並通知，下游不再執行', async () => {
    const { engine, probe, events } = setup()
    const flow = wf(
      [
        { id: 'src', type: 'test.source', params: { value: 'xxxxxxx' } }, // 7 個字元 → US$7
        { id: 'dyn', type: 'test.dynamic' },
        { id: 'after', type: 'test.upper' },
      ],
      [
        ['src', 'value', 'dyn', 'text'],
        ['dyn', 'text', 'after', 'text'],
      ],
    )
    const result = await engine.run(flow, { budget: { perRunLimitUsd: 5 } })

    expect(result.run.status).toBe('failed')
    expect(result.budgetExceeded).toEqual({ scope: 'run', limitUsd: 5, projectedUsd: 7 })
    expect(result.nodeRuns.map((n) => [n.nodeId, n.status])).toEqual([
      ['src', 'succeeded'],
      ['dyn', 'blocked'],
      ['after', 'blocked'],
    ])
    expect(result.nodeRuns[1]?.error).toMatchObject({ code: 'budget_exceeded', retryable: false })
    expect(probe.calls).toEqual({ 'test.source': 1 })
    expect(events.filter((e) => e.type === 'budget-exceeded')).toHaveLength(1)
  })

  it('超過後不再啟動任何新節點（包含免費的），已完成的不受影響；調高上限重跑會從中斷處繼續', async () => {
    const { engine, probe, ledger, events } = setup()
    const body = bodyOf('test.jpaid', { cost: 2 })
    const flow = forEachWorkflow(['a', 'b', 'c', 'd'], body, { concurrency: 1 })

    const first = await engine.run(flow, { budget: { perRunLimitUsd: 5 } })
    expect(first.run.status).toBe('failed')
    expect(first.budgetExceeded).toMatchObject({ scope: 'run', limitUsd: 5, projectedUsd: 6 })
    expect(first.nodeRuns.find((n) => n.nodeId === 'fe')?.error?.code).toBe('budget_exceeded')
    expect(probe.calls['test.jpaid']).toBe(2)
    expect(first.run.actualCostUsd).toBe(4)
    expect(ledger.totalUsd('local')).toBe(4)
    expect(events.filter((e) => e.type === 'budget-exceeded')).toHaveLength(1)

    // 使用者調高上限後重跑：前兩個項目走快取、不再收費
    const second = await engine.run(flow, { budget: { perRunLimitUsd: 10 } })
    expect(second.run.status).toBe('succeeded')
    expect(probe.calls['test.jpaid']).toBe(4)
    expect(second.run.actualCostUsd).toBe(4)
    expect(ledger.totalUsd('local')).toBe(8)
  })
})

describe('英文介面的超額訊息', () => {
  it('單次與專案兩種：英文、不含中文，金額照填；繁中維持原句', async () => {
    const { setLocale, DEFAULT_LOCALE } = await import('@svs/schema')
    const exceeded = (scope: 'run' | 'project') => ({ scope, projectedUsd: 1.5, limitUsd: 1 })
    try {
      expect(budgetExceededError(exceeded('run')).userMessage).toContain('「單次花費上限」 US$1.00')
      setLocale('en')
      for (const scope of ['run', 'project'] as const) {
        const text = budgetExceededError(exceeded(scope)).userMessage
        expect(text).not.toMatch(/[㐀-鿿]/)
        expect(text).toContain('US$1.50')
        expect(text).toContain('US$1.00')
      }
      expect(budgetExceededError(exceeded('run')).userMessage).toContain('Per-run spending limit')
    } finally {
      setLocale(DEFAULT_LOCALE)
    }
  })
})
