import { createProject, openProject } from '@svs/db'
import { NodeRegistry, defineNode } from '@svs/engine'
import type { Workflow } from '@svs/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createProjectEngine, stepLabelOfRun } from './project-engine'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const NOW = '2026-10-12T08:00:00.000Z'
let calls = 0
const registry = new NodeRegistry().register(
  defineNode({
    type: 'test.gen',
    version: 1,
    inputs: {},
    outputs: { text: 'text' },
    params: z.object({ cost: z.number() }),
    estimateCost: ({ params }) => params.cost,
    run: ({ reportCost }) => {
      calls++
      reportCost({ provider: 'fal', modelId: 'fal/nano-banana-2', amountUsd: 0.08 })
      return { text: 'done' }
    },
  }),
)

const flow = (cost: number): Workflow => ({
  id: 'w1',
  name: '測試',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  nodes: [{ id: 'gen', type: 'test.gen', version: 1, params: { cost }, position: { x: 0, y: 0 } }],
  edges: [],
})

describe('專案資料庫上的執行引擎（真的 SQLite）', () => {
  it('執行紀錄、花費與快取都存進專案；重開專案後同一個節點沿用快取、不再收費', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-pe-'))
    dirs.push(root)
    const dir = join(root, '短片.svsproj')
    const env = { appVersion: 'test' }

    const first = createProject({ dir, name: '短片' }, env)
    const engine1 = createProjectEngine(first, { registry })
    const r1 = await engine1.run(flow(0.1), { projectId: first.projectId })
    expect(r1.run).toMatchObject({ status: 'succeeded', estimatedCostUsd: 0.1 })
    expect(r1.run.actualCostUsd).toBeCloseTo(0.08)
    expect(first.repos.runs.getRun(r1.run.id)?.status).toBe('succeeded')
    expect(first.repos.costs.totalUsd(first.projectId)).toBeCloseTo(0.08)
    first.close()

    const second = openProject(dir, env)
    const engine2 = createProjectEngine(second, { registry })
    const r2 = await engine2.run(flow(0.1), { projectId: second.projectId })
    expect(r2.nodeRuns[0]?.status).toBe('cached')
    expect(r2.run.actualCostUsd).toBe(0)
    expect(calls).toBe(1)
    expect(second.repos.costs.totalUsd(second.projectId)).toBeCloseTo(0.08)
    expect(second.repos.runs.listRuns(second.projectId)).toHaveLength(2)

    // 專案累計花費也會參與預算檢查
    await expect(
      engine2.run(flow(0.2), {
        projectId: second.projectId,
        budget: { perRunLimitUsd: 5, projectLimitUsd: 0.2 },
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' })
    second.close()
  })

  it('節點一開始執行就能查到它是第幾鏡（資料庫要等節點跑完才有紀錄）；單鏡頭重生用指定的名稱', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-pe-'))
    dirs.push(root)
    const handle = createProject(
      { dir: join(root, '短片.svsproj'), name: '短片' },
      { appVersion: 'test' },
    )
    const seen: { nodeRunId: string; inDb: boolean; indexed: string | undefined }[] = []
    const probe = new NodeRegistry().register(
      defineNode({
        type: 'test.probe',
        version: 1,
        inputs: {},
        outputs: { text: 'text' },
        params: z.object({}),
        run: ({ nodeRunId }) => {
          seen.push({
            nodeRunId: nodeRunId,
            inDb: handle.repos.runs.getNodeRun(nodeRunId) !== undefined,
            indexed: stepLabelOfRun(handle, nodeRunId),
          })
          return { text: 'ok' }
        },
      }),
    )
    const events: string[] = []
    const engine = createProjectEngine(handle, {
      registry: probe,
      onEvent: (event) => events.push(event.type),
    })
    const wf: Workflow = {
      ...flow(0),
      nodes: [
        {
          id: 'each[0]/image',
          type: 'test.probe',
          version: 1,
          params: {},
          position: { x: 0, y: 0 },
        },
      ],
    }
    await engine.run(wf, { projectId: handle.projectId })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ inDb: false, indexed: '第 1 鏡' })
    // 原本的事件監聽照常收到
    expect(events).toContain('node-started')
    handle.close()
  })
})
