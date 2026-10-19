import { describe, expect, it } from 'vitest'

import { newProject } from '../__tests__/helpers'

const base = { provider: 'fal', modelId: 'fal/kling-3.0-pro', estimated: false }

describe('CostRepository', () => {
  it('record 寫入後 list 能完整讀回（含選填欄位）', () => {
    const { repos, projectId } = newProject()
    const a = repos.costs.record({ ...base, projectId, amountUsd: 0.42, runId: 'r1', jobId: 'j1' })
    const b = repos.costs.record({ ...base, projectId, amountUsd: 0.1, estimated: true })
    expect(a.id).not.toBe(b.id)
    expect(repos.costs.list(projectId)).toEqual([a, b])
    expect(repos.costs.list(projectId)[1]?.runId).toBeUndefined()
  })

  it('記得是哪個節點執行花的錢', () => {
    const { repos, projectId } = newProject()
    const a = repos.costs.record({
      ...base,
      projectId,
      amountUsd: 0.2,
      runId: 'r1',
      nodeRunId: 'n1',
    })
    expect(repos.costs.list(projectId, { runId: 'r1' })[0]?.nodeRunId).toBe('n1')
    expect(a.nodeRunId).toBe('n1')
  })

  it('加總正確：全部、依執行、估算的部分', () => {
    const { repos, projectId } = newProject()
    repos.costs.record({ ...base, projectId, amountUsd: 0.1, runId: 'r1' })
    repos.costs.record({ ...base, projectId, amountUsd: 0.2, runId: 'r1', estimated: true })
    repos.costs.record({ ...base, projectId, amountUsd: 0.4, runId: 'r2' })
    expect(repos.costs.totalUsd(projectId)).toBeCloseTo(0.7)
    expect(repos.costs.totalUsd(projectId, { runId: 'r1' })).toBeCloseTo(0.3)
    expect(repos.costs.estimatedUsd(projectId)).toBeCloseTo(0.2)
    expect(repos.costs.totalUsd('空的專案')).toBe(0)
  })

  it('可以不算某些供應商（示範模式的估算不是真的花費）', () => {
    const { repos, projectId } = newProject()
    repos.costs.record({ ...base, projectId, amountUsd: 0.5, provider: 'mock', estimated: true })
    repos.costs.record({ ...base, projectId, amountUsd: 0.25, provider: 'fal' })
    expect(repos.costs.totalUsd(projectId)).toBeCloseTo(0.75)
    expect(repos.costs.totalUsd(projectId, { excludeProviders: ['mock'] })).toBeCloseTo(0.25)
  })

  it('依時間範圍加總：本月花費只算當月（UTC）', () => {
    let current = new Date('2026-09-30T23:59:59.000Z')
    const handle = newProject('月報', undefined, { appVersion: 'test', now: () => current })
    for (const at of [
      '2026-09-30T23:59:59.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-10-31T23:59:59.000Z',
      '2026-11-01T00:00:00.000Z',
    ]) {
      current = new Date(at)
      handle.repos.costs.record({ ...base, projectId: handle.projectId, amountUsd: 1 })
    }
    const { costs } = handle.repos
    expect(costs.monthTotalUsd(handle.projectId, 2026, 10)).toBe(2)
    expect(costs.monthTotalUsd(handle.projectId, 2026, 9)).toBe(1)
    expect(costs.monthTotalUsd(handle.projectId, 2026, 12)).toBe(0)
  })

  it('拒絕負數金額', () => {
    const { repos, projectId } = newProject()
    expect(() => repos.costs.record({ ...base, projectId, amountUsd: -1 })).toThrow()
  })
})
