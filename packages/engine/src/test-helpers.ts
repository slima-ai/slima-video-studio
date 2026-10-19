import type { Workflow, WorkflowEdge, WorkflowNode } from '@svs/schema'
import { z } from 'zod'

import { createRegistry } from './builtin'
import { defineNode, type NodeRegistry } from './node'

export const NOW = '2026-10-12T00:00:00.000Z'

export function wf(
  nodes: Pick<WorkflowNode, 'id' | 'type'>[] & Partial<WorkflowNode>[],
  edges: [string, string, string, string][] = [],
  id = 'wf',
): Workflow {
  return {
    id,
    name: id,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    nodes: nodes.map((n) => ({
      version: 1,
      params: {},
      position: { x: 0, y: 0 },
      ...n,
    })),
    edges: edges.map(([fromNode, fromPort, toNode, toPort], i): WorkflowEdge => ({
      id: `e${String(i)}`,
      from: { nodeId: fromNode, port: fromPort },
      to: { nodeId: toNode, port: toPort },
    })),
  }
}

export interface Probe {
  /** 每種節點類型被真正執行（不是快取命中）的次數 */
  calls: Record<string, number>
  /** 目前同時執行中的節點數與歷史最大值 */
  running: number
  maxRunning: number
}

/** 測試用節點：記錄呼叫次數與並行數。 */
export function testRegistry(probe: Probe = { calls: {}, running: 0, maxRunning: 0 }): {
  registry: NodeRegistry
  probe: Probe
} {
  const registry = createRegistry()
  const track = async <T>(type: string, fn: () => Promise<T> | T, delayMs = 0): Promise<T> => {
    probe.calls[type] = (probe.calls[type] ?? 0) + 1
    probe.running++
    probe.maxRunning = Math.max(probe.maxRunning, probe.running)
    try {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      return await fn()
    } finally {
      probe.running--
    }
  }

  registry.register(
    defineNode({
      type: 'test.source',
      version: 1,
      inputs: {},
      outputs: { value: 'text' },
      params: z.object({ value: z.string().default('x'), delayMs: z.number().default(0) }),
      run: ({ params }) => track('test.source', () => ({ value: params.value }), params.delayMs),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.upper',
      version: 1,
      inputs: { text: { type: 'text' } },
      outputs: { text: 'text' },
      params: z.object({ delayMs: z.number().default(0) }),
      run: ({ inputs, params }) =>
        track('test.upper', () => ({ text: String(inputs.text).toUpperCase() }), params.delayMs),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.concat',
      version: 1,
      inputs: { a: { type: 'text' }, b: { type: 'text', optional: true } },
      outputs: { text: 'text' },
      params: z.object({}),
      run: ({ inputs }) =>
        track('test.concat', () => ({
          text: `${String(inputs.a)}${typeof inputs.b === 'string' ? inputs.b : ''}`,
        })),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.fail',
      version: 1,
      inputs: { text: { type: 'text', optional: true } },
      outputs: { text: 'text' },
      params: z.object({}),
      run: () =>
        track('test.fail', () => {
          throw new Error('供應商炸了：secret')
        }),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.image',
      version: 1,
      inputs: { text: { type: 'text' } },
      outputs: { image: 'image' },
      params: z.object({}),
      run: ({ inputs }) => track('test.image', () => ({ image: { prompt: inputs.text } })),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.bad-output',
      version: 1,
      inputs: {},
      outputs: { value: 'text' },
      params: z.object({}),
      run: () => ({ other: 'x' }),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.hang',
      version: 1,
      inputs: {},
      outputs: { value: 'text' },
      params: z.object({}),
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.random',
      version: 1,
      inputs: {},
      outputs: { value: 'text' },
      params: z.object({}),
      cacheable: false,
      run: () => track('test.random', () => ({ value: Math.random().toString() })),
    }),
  )
  // 會花錢的節點：預估費用取自參數；actual 有值時回報供應商實際金額
  registry.register(
    defineNode({
      type: 'test.paid',
      version: 1,
      inputs: { text: { type: 'text', optional: true } },
      outputs: { text: 'text' },
      params: z.object({
        cost: z.number().default(1),
        actual: z.number().optional(),
        tag: z.string().default(''),
      }),
      estimateCost: ({ params }) => params.cost,
      run: ({ params, reportCost }) =>
        track('test.paid', () => {
          if (params.actual !== undefined) {
            reportCost({ provider: 'fal', modelId: 'fal/kling-3.0-pro', amountUsd: params.actual })
          }
          return { text: params.tag }
        }),
    }),
  )
  // 預估費用要看上游輸入（執行前估不出來）：每個字元 US$1
  registry.register(
    defineNode({
      type: 'test.dynamic',
      version: 1,
      inputs: { text: { type: 'text' } },
      outputs: { text: 'text' },
      params: z.object({}),
      estimateCost: ({ inputs }) => {
        if (typeof inputs.text !== 'string') throw new Error('執行前不知道輸入')
        return inputs.text.length
      },
      run: ({ inputs }) => track('test.dynamic', () => ({ text: String(inputs.text) })),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.jpaid',
      version: 1,
      inputs: { value: { type: 'json' } },
      outputs: { value: 'json' },
      params: z.object({ cost: z.number().default(1) }),
      estimateCost: ({ params }) => params.cost,
      run: ({ inputs }) => track('test.jpaid', () => ({ value: inputs.value })),
    }),
  )
  // 以下是 json 埠的節點，給 forEach 測試用（$input / $output / forEach 的埠都是 json）
  registry.register(
    defineNode({
      type: 'test.items',
      version: 1,
      inputs: {},
      outputs: { items: 'json' },
      params: z.object({ items: z.array(z.unknown()).default([]) }),
      run: ({ params }) => ({ items: params.items }),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.jupper',
      version: 1,
      inputs: { value: { type: 'json' } },
      outputs: { value: 'json' },
      params: z.object({ delayMs: z.number().default(0) }),
      run: ({ inputs, params }) =>
        track('test.jupper', () => ({ value: String(inputs.value).toUpperCase() }), params.delayMs),
    }),
  )
  registry.register(
    defineNode({
      type: 'test.picky',
      version: 1,
      inputs: { value: { type: 'json' } },
      outputs: { value: 'json' },
      params: z.object({}),
      run: ({ inputs }) =>
        track('test.picky', () => {
          if (inputs.value === 'boom') throw new Error('壞掉')
          return { value: inputs.value }
        }),
    }),
  )
  return { registry, probe }
}

/** 子工作流：$input.item → <type> → $output。 */
export function bodyOf(
  type: 'test.jupper' | 'test.picky' | 'test.jpaid',
  params: Record<string, unknown> = {},
): Workflow {
  return wf(
    [
      { id: 'in', type: '$input' },
      { id: 'step', type, params },
      { id: 'out', type: '$output' },
    ],
    [
      ['in', 'item', 'step', 'value'],
      ['step', 'value', 'out', 'value'],
    ],
    'body',
  )
}

/** 頂層：test.items → forEach(body)。 */
export function forEachWorkflow(
  items: unknown[],
  body: Workflow,
  extra: Record<string, unknown> = {},
): Workflow {
  return wf(
    [
      { id: 'items', type: 'test.items', params: { items } },
      { id: 'fe', type: 'forEach', params: { body, ...extra } },
    ],
    [['items', 'items', 'fe', 'items']],
  )
}
