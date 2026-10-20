import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AppErrorShape, WorkflowEdge, WorkflowNode } from '@svs/schema'

import { projects } from './core'

export const assets = sqliteTable('assets', {
  hash: text('hash').primaryKey(),
  kind: text('kind').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationSec: real('duration_sec'),
  createdAt: text('created_at').notNull(),
})

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: integer('version').notNull(),
  nodes: text('nodes', { mode: 'json' }).$type<WorkflowNode[]>().notNull(),
  edges: text('edges', { mode: 'json' }).$type<WorkflowEdge[]>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').notNull(),
    status: text('status').notNull(),
    estimatedCostUsd: real('estimated_cost_usd').notNull().default(0),
    actualCostUsd: real('actual_cost_usd').notNull().default(0),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('runs_project_idx').on(t.projectId, t.createdAt)],
)

export const nodeRuns = sqliteTable(
  'node_runs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    parentNodeRunId: text('parent_node_run_id'),
    status: text('status').notNull(),
    cacheKey: text('cache_key').notNull(),
    outputHash: text('output_hash'),
    output: text('output', { mode: 'json' }),
    error: text('error', { mode: 'json' }).$type<AppErrorShape>(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('node_runs_run_idx').on(t.runId),
    // 快取查詢：同一個快取鍵成功過就直接沿用
    index('node_runs_cache_idx').on(t.cacheKey, t.status),
  ],
)

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    nodeRunId: text('node_run_id'),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    providerJobId: text('provider_job_id'),
    input: text('input', { mode: 'json' }),
    output: text('output', { mode: 'json' }),
    costUsd: real('cost_usd'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextRunAt: text('next_run_at'),
    error: text('error', { mode: 'json' }).$type<AppErrorShape>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('jobs_status_idx').on(t.status, t.nextRunAt)],
)

export const costLedger = sqliteTable(
  'cost_ledger',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    jobId: text('job_id'),
    nodeRunId: text('node_run_id'),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    amountUsd: real('amount_usd').notNull(),
    estimated: integer('estimated', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('cost_ledger_project_idx').on(t.projectId, t.createdAt)],
)
