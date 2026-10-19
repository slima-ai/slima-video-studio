import type { NodeRun, Run } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from '../__tests__/helpers'

const NOW = '2026-10-12T08:00:00.000Z'
const HASH = (c: string): string => c.repeat(64)

const run = (projectId: string, patch: Partial<Run> = {}): Run => ({
  id: 'r1',
  projectId,
  workflowId: 'w1',
  status: 'running',
  estimatedCostUsd: 1.5,
  actualCostUsd: 0,
  startedAt: NOW,
  createdAt: NOW,
  ...patch,
})

const nodeRun = (patch: Partial<NodeRun> = {}): NodeRun => ({
  id: 'n1',
  runId: 'r1',
  nodeId: 'a',
  status: 'succeeded',
  cacheKey: HASH('a'),
  output: { text: 'HELLO' },
  outputHash: HASH('b'),
  startedAt: NOW,
  finishedAt: NOW,
  ...patch,
})

describe('RunsRepository', () => {
  it('Run 與 NodeRun 寫入後能完整讀回，同 id 再寫入是更新', () => {
    const { repos, projectId } = newProject()
    repos.runs.saveRun(run(projectId))
    repos.runs.saveRun(
      run(projectId, { status: 'succeeded', actualCostUsd: 0.84, finishedAt: NOW }),
    )
    expect(repos.runs.getRun('r1')).toEqual(
      run(projectId, { status: 'succeeded', actualCostUsd: 0.84, finishedAt: NOW }),
    )
    expect(repos.runs.getRun('nope')).toBeUndefined()

    const parent = nodeRun({ id: 'n0', nodeId: 'fe', cacheKey: HASH('c') })
    const child = nodeRun({
      id: 'n2',
      nodeId: 'fe[0]/step',
      parentNodeRunId: 'n0',
      status: 'failed',
      output: undefined,
      outputHash: undefined,
      error: { code: 'node_failed', retryable: false, userMessage: '失敗' },
    })
    repos.runs.saveNodeRun(parent)
    repos.runs.saveNodeRun(child)
    repos.runs.saveNodeRun({ ...parent, status: 'cancelled' })
    expect(repos.runs.listNodeRuns('r1').map((n) => [n.id, n.status])).toEqual([
      ['n0', 'cancelled'],
      ['n2', 'failed'],
    ])
    expect(repos.runs.listNodeRuns('r1').find((n) => n.id === 'n2')).toEqual(child)
    expect(repos.runs.getNodeRun('n2')).toEqual(child)
    expect(repos.runs.getNodeRun('沒有這筆')).toBeUndefined()
  })

  it('findSucceeded 只回傳成功且有輸出的紀錄，取最近的一筆', () => {
    const { repos, projectId } = newProject()
    repos.runs.saveRun(run(projectId))
    repos.runs.saveNodeRun(
      nodeRun({ id: 'old', output: { text: 'OLD' }, finishedAt: '2026-10-12T07:00:00.000Z' }),
    )
    repos.runs.saveNodeRun(
      nodeRun({ id: 'new', output: { text: 'NEW' }, finishedAt: '2026-10-12T09:00:00.000Z' }),
    )
    repos.runs.saveNodeRun(
      nodeRun({ id: 'bad', cacheKey: HASH('d'), status: 'failed', output: undefined }),
    )
    repos.runs.saveNodeRun(nodeRun({ id: 'cached', cacheKey: HASH('e'), status: 'cached' }))

    expect(repos.runs.findSucceeded(HASH('a'))?.output).toEqual({ text: 'NEW' })
    expect(repos.runs.findSucceeded(HASH('d'))).toBeUndefined()
    expect(repos.runs.findSucceeded(HASH('e'))).toBeUndefined() // 沿用快取的不當來源
    expect(repos.runs.findSucceeded(HASH('f'))).toBeUndefined()
  })

  it('listRuns 新的在前並限制數量；刪除專案資料時 Run 一併消失（外鍵）', () => {
    const { repos, projectId } = newProject()
    repos.runs.saveRun(run(projectId, { id: 'a', createdAt: '2026-10-12T08:00:01.000Z' }))
    repos.runs.saveRun(run(projectId, { id: 'b', createdAt: '2026-10-12T08:00:02.000Z' }))
    repos.runs.saveRun(run(projectId, { id: 'c', createdAt: '2026-10-12T08:00:03.000Z' }))
    expect(repos.runs.listRuns(projectId).map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(repos.runs.listRuns(projectId, 2).map((r) => r.id)).toEqual(['c', 'b'])
    expect(repos.runs.listRuns('other')).toEqual([])
  })

  it('快取跨重開保留：關掉再開仍然找得到', () => {
    const handle = newProject()
    handle.repos.runs.saveRun(run(handle.projectId))
    handle.repos.runs.saveNodeRun(nodeRun())
    handle.close()
    const again = reopen(handle)
    expect(again.repos.runs.findSucceeded(HASH('a'))?.output).toEqual({ text: 'HELLO' })
  })
})
