import { NodeRunSchema, RunSchema, type NodeRun, type Run } from '@svs/schema'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'

import type { AppDb } from '../database'
import { dropNulls } from '../rows'
import { nodeRuns, runs } from '../tables/execution'

/**
 * 工作流執行紀錄與節點快取。結構上符合引擎的 RunStore（saveRun / saveNodeRun / findSucceeded），
 * 由 apps/desktop 直接注入引擎。快取鍵相同且成功過的 NodeRun 就是快取來源。
 */
export class RunsRepository {
  constructor(private readonly db: AppDb) {}

  saveRun(run: Run): void {
    const row = toRunRow(RunSchema.parse(run))
    this.db.insert(runs).values(row).onConflictDoUpdate({ target: runs.id, set: row }).run()
  }

  saveNodeRun(nodeRun: NodeRun): void {
    const row = toNodeRunRow(NodeRunSchema.parse(nodeRun))
    this.db.insert(nodeRuns).values(row).onConflictDoUpdate({ target: nodeRuns.id, set: row }).run()
  }

  /** 同一個快取鍵成功執行過、且有輸出的 NodeRun（最近的一筆）。 */
  findSucceeded(cacheKey: string): NodeRun | undefined {
    const row = this.db
      .select()
      .from(nodeRuns)
      .where(
        and(
          eq(nodeRuns.cacheKey, cacheKey),
          eq(nodeRuns.status, 'succeeded'),
          isNotNull(nodeRuns.output),
        ),
      )
      .orderBy(desc(nodeRuns.finishedAt))
      .limit(1)
      .get()
    return row ? toNodeRun(row) : undefined
  }

  getRun(id: string): Run | undefined {
    const row = this.db.select().from(runs).where(eq(runs.id, id)).get()
    return row ? toRun(row) : undefined
  }

  /** 最近的執行紀錄（新的在前）。 */
  listRuns(projectId: string, limit = 50): Run[] {
    return this.db
      .select()
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .all()
      .map(toRun)
  }

  getNodeRun(id: string): NodeRun | undefined {
    const row = this.db.select().from(nodeRuns).where(eq(nodeRuns.id, id)).get()
    return row ? toNodeRun(row) : undefined
  }

  listNodeRuns(runId: string): NodeRun[] {
    return this.db
      .select()
      .from(nodeRuns)
      .where(eq(nodeRuns.runId, runId))
      .orderBy(asc(nodeRuns.startedAt))
      .all()
      .map(toNodeRun)
  }
}

type RunRow = typeof runs.$inferSelect
type NodeRunRow = typeof nodeRuns.$inferSelect

const toRun = (row: RunRow): Run => RunSchema.parse(dropNulls(row))
const toNodeRun = (row: NodeRunRow): NodeRun => NodeRunSchema.parse(dropNulls(row))

function toRunRow(run: Run): typeof runs.$inferInsert {
  return {
    id: run.id,
    projectId: run.projectId,
    workflowId: run.workflowId,
    status: run.status,
    estimatedCostUsd: run.estimatedCostUsd,
    actualCostUsd: run.actualCostUsd,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    createdAt: run.createdAt,
  }
}

function toNodeRunRow(n: NodeRun): typeof nodeRuns.$inferInsert {
  return {
    id: n.id,
    runId: n.runId,
    nodeId: n.nodeId,
    parentNodeRunId: n.parentNodeRunId ?? null,
    status: n.status,
    cacheKey: n.cacheKey,
    outputHash: n.outputHash ?? null,
    output: n.output ?? null,
    error: n.error ?? null,
    startedAt: n.startedAt ?? null,
    finishedAt: n.finishedAt ?? null,
  }
}
