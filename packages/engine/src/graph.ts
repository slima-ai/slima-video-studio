import { AppError, type Workflow, type WorkflowEdge, type WorkflowNode } from '@svs/schema'

import { FOR_EACH_NODE, ForEachParamsSchema, checkBody } from './builtin'
import { type NodeRegistry, canConnect } from './node'

export type IssueCode =
  | 'duplicate_node_id'
  | 'unknown_node_type'
  | 'version_mismatch'
  | 'invalid_params'
  | 'unknown_node'
  | 'unknown_port'
  | 'type_mismatch'
  | 'duplicate_input'
  | 'missing_input'
  | 'self_loop'
  | 'cycle'
  | 'invalid_body'

export interface WorkflowIssue {
  code: IssueCode
  message: string
  nodeId?: string
  edgeId?: string
}

export class WorkflowValidationError extends AppError {
  readonly issues: readonly WorkflowIssue[]

  constructor(issues: readonly WorkflowIssue[]) {
    const first = issues[0]?.message ?? '工作流不正確'
    super({
      code: 'workflow_invalid',
      userMessage:
        issues.length > 1 ? `${first}（另外還有 ${String(issues.length - 1)} 個問題）` : first,
    })
    this.name = 'WorkflowValidationError'
    this.issues = issues
  }
}

const label = (node: WorkflowNode): string => `節點「${node.type}」(${node.id})`

/** 找出圖中的環：回傳環上的節點 ID（沒有環時回傳空陣列）。 */
export function findCycle(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): string[] {
  const { order } = topologicalOrder(nodes, edges)
  if (order.length === nodes.length) return []
  const sorted = new Set(order)
  return nodes.map((n) => n.id).filter((id) => !sorted.has(id))
}

/** Kahn 演算法。回傳依相依順序排好的節點 ID，以及每個節點的層級（可平行的節點同層）。 */
export function topologicalOrder(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): { order: string[]; level: Map<string, number> } {
  const ids = new Set(nodes.map((n) => n.id))
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  const downstream = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!ids.has(e.from.nodeId) || !ids.has(e.to.nodeId)) continue
    indegree.set(e.to.nodeId, (indegree.get(e.to.nodeId) ?? 0) + 1)
    downstream.get(e.from.nodeId)?.push(e.to.nodeId)
  }
  const level = new Map<string, number>()
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  for (const id of queue) level.set(id, 0)
  const order: string[] = []
  // 迭代中會 push 新節點進 queue，for-of 會繼續走到新加入的元素
  for (const id of queue) {
    order.push(id)
    for (const next of downstream.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1))
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return { order, level }
}

/**
 * 執行前的完整檢查：節點類型、版本、參數、連線埠與型別、必填輸入、環。
 * 回傳所有問題（不是遇到第一個就停），訊息都是使用者看得懂的中文。
 */
export function validateWorkflow(workflow: Workflow, registry: NodeRegistry): WorkflowIssue[] {
  return validateGraph(workflow.nodes, workflow.edges, registry)
}

export function validateGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  registry: NodeRegistry,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  const byId = new Map<string, WorkflowNode>()

  for (const node of nodes) {
    if (byId.has(node.id)) {
      issues.push({
        code: 'duplicate_node_id',
        nodeId: node.id,
        message: `節點 ID 重複：${node.id}`,
      })
      continue
    }
    byId.set(node.id, node)
    const def = registry.get(node.type)
    if (!def) {
      issues.push({
        code: 'unknown_node_type',
        nodeId: node.id,
        message: `${label(node)}：沒有這種節點類型`,
      })
      continue
    }
    if (def.version !== node.version) {
      issues.push({
        code: 'version_mismatch',
        nodeId: node.id,
        message: `${label(node)}：節點版本是 ${String(node.version)}，但目前支援的是 ${String(def.version)}`,
      })
    }
    const params = def.params.safeParse(node.params)
    if (params.success && node.type === FOR_EACH_NODE) {
      issues.push(...validateBody(node, ForEachParamsSchema.parse(node.params).body, registry))
    }
    if (!params.success) {
      const detail = params.error.issues
        .map((i) => `${i.path.join('.') || '(根)'}：${i.message}`)
        .join('；')
      issues.push({
        code: 'invalid_params',
        nodeId: node.id,
        message: `${label(node)}：參數不正確（${detail}）`,
      })
    }
  }

  const connected = new Set<string>()
  for (const edge of edges) {
    if (edge.from.nodeId === edge.to.nodeId) {
      issues.push({
        code: 'self_loop',
        edgeId: edge.id,
        nodeId: edge.from.nodeId,
        message: `連線 ${edge.id}：節點不能連到自己`,
      })
      continue
    }
    const from = byId.get(edge.from.nodeId)
    const to = byId.get(edge.to.nodeId)
    if (!from || !to) {
      issues.push({
        code: 'unknown_node',
        edgeId: edge.id,
        message: `連線 ${edge.id}：指向不存在的節點`,
      })
      continue
    }
    const fromDef = registry.get(from.type)
    const toDef = registry.get(to.type)
    if (!fromDef || !toDef) continue // 類型未知已經在上面回報過

    const outType = fromDef.outputs[edge.from.port]
    const inSpec = toDef.inputs[edge.to.port]
    if (outType === undefined) {
      issues.push({
        code: 'unknown_port',
        edgeId: edge.id,
        nodeId: from.id,
        message: `${label(from)}：沒有輸出埠「${edge.from.port}」`,
      })
      continue
    }
    if (inSpec === undefined) {
      issues.push({
        code: 'unknown_port',
        edgeId: edge.id,
        nodeId: to.id,
        message: `${label(to)}：沒有輸入埠「${edge.to.port}」`,
      })
      continue
    }
    if (!canConnect(outType, inSpec.type)) {
      issues.push({
        code: 'type_mismatch',
        edgeId: edge.id,
        nodeId: to.id,
        message: `連線 ${edge.id}：「${edge.from.port}」是 ${outType}，不能接到「${edge.to.port}」（需要 ${inSpec.type}）`,
      })
      continue
    }
    const key = `${to.id}\0${edge.to.port}`
    if (connected.has(key)) {
      issues.push({
        code: 'duplicate_input',
        edgeId: edge.id,
        nodeId: to.id,
        message: `${label(to)}：輸入埠「${edge.to.port}」被連了不只一條線`,
      })
    }
    connected.add(key)
  }

  for (const node of byId.values()) {
    const def = registry.get(node.type)
    if (!def) continue
    for (const [port, spec] of Object.entries(def.inputs)) {
      if (!spec.optional && !connected.has(`${node.id}\0${port}`)) {
        issues.push({
          code: 'missing_input',
          nodeId: node.id,
          message: `${label(node)}：必填的輸入埠「${port}」沒有連線`,
        })
      }
    }
  }

  const cycle = findCycle([...byId.values()], edges)
  if (cycle.length > 0) {
    issues.push({
      code: 'cycle',
      ...(cycle[0] ? { nodeId: cycle[0] } : {}),
      message: `工作流有循環相依，涉及節點：${cycle.join('、')}`,
    })
  }
  return issues
}

export function assertValidWorkflow(workflow: Workflow, registry: NodeRegistry): void {
  const issues = validateWorkflow(workflow, registry)
  if (issues.length > 0) throw new WorkflowValidationError(issues)
}

function validateBody(node: WorkflowNode, body: Workflow, registry: NodeRegistry): WorkflowIssue[] {
  const structural = checkBody(body)
  const inner = validateGraph(body.nodes, body.edges, registry).map((issue) => ({
    ...issue,
    message: `${label(node)} 的子工作流：${issue.message}`,
  }))
  return structural
    ? [
        { code: 'invalid_body', nodeId: node.id, message: `${label(node)}：${structural}` },
        ...inner,
      ]
    : inner
}
