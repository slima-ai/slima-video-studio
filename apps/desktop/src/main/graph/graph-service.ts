import { createRegistry, type NodeRegistry } from '@svs/engine'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  type GraphEdgeView,
  type GraphNodeStatus,
  type GraphNodeView,
  type GraphPreview,
  type NodeRun,
  type ShotGraph,
  type Workflow,
  t,
  displayNameOf,
} from '@svs/schema'
import { NODE_INFO, NODE_TYPES, registerQuickStartNodes } from '@svs/workflows'

import type { ProjectManager } from '../project-manager'
import type { ShotService } from '../shots/shot-service'

export interface GraphService {
  /** 一個鏡頭的生成流程圖，連同它最近一次生成的結果（唯讀）。 */
  shot: (shotId: string) => ShotGraph
}

export interface GraphServiceDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'flowOf'>
  models: Pick<ModelRegistry, 'get'>
}

const COLUMN_WIDTH = 320
const ROW_HEIGHT = 260

const STATUS: Readonly<Record<NodeRun['status'], GraphNodeStatus>> = {
  pending: 'idle',
  running: 'running',
  succeeded: 'succeeded',
  cached: 'cached',
  failed: 'failed',
  blocked: 'blocked',
  cancelled: 'cancelled',
}

/** 帶參考圖的連線畫成虛線。 */
const REFERENCE_PORTS = new Set(['references'])

/**
 * 由左到右的分層排版：每個節點放在「離起點最遠的上游」的下一欄，同一欄由上往下排。
 * 只依連線決定位置，節點多的時候也是線性時間。
 */
export function layoutNodes(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const id of nodeIds) {
    incoming.set(id, [])
    outgoing.set(id, [])
  }
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to)
    incoming.get(edge.to)?.push(edge.from)
  }
  const depth = new Map<string, number>()
  const remaining = new Map(nodeIds.map((id) => [id, incoming.get(id)?.length ?? 0]))
  const queue = nodeIds.filter((id) => remaining.get(id) === 0)
  for (const id of queue) depth.set(id, 0)
  // queue 在迴圈裡會繼續增加，所以用索引走訪
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i] ?? ''
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1))
      const left = (remaining.get(next) ?? 1) - 1
      remaining.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  const rows = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const id of nodeIds) {
    // 有環（不該發生）的節點排在最後一欄
    const column = depth.get(id) ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    positions.set(id, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT })
  }
  return positions
}

function previewOf(output: unknown, port: string): GraphPreview | undefined {
  if (typeof output !== 'object' || output === null) return undefined
  const value = (output as Record<string, unknown>)[port]
  if (typeof value === 'string') return value === '' ? undefined : { kind: 'text', text: value }
  const asset = AssetRefSchema.safeParse(value)
  if (!asset.success) return undefined
  if (asset.data.kind === 'image') return { kind: 'image', hash: asset.data.hash }
  if (asset.data.kind === 'video') return { kind: 'video', hash: asset.data.hash }
  return undefined
}

/** 節點卡片上要預覽的輸出埠。 */
const PREVIEW_PORT: Readonly<Record<string, string>> = {
  [NODE_TYPES.shotPrompt]: 'imagePrompt',
  [NODE_TYPES.image]: 'image',
  [NODE_TYPES.imageEdit]: 'image',
  [NODE_TYPES.video]: 'video',
  [NODE_TYPES.concat]: 'video',
}

export function createGraphService(deps: GraphServiceDeps): GraphService {
  const registry: NodeRegistry = createRegistry()
  registerQuickStartNodes(registry)

  const text = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''

  const summaryOf = (node: Workflow['nodes'][number]): string | undefined => {
    const { params } = node
    switch (node.type) {
      case NODE_TYPES.shotPrompt: {
        const anchors = Array.isArray(params.anchors) ? params.anchors.length : 0
        const scenes = Array.isArray(params.scenes) ? params.scenes.length : 0
        return t('services.styleUsingCharactersAndLocations', {
          value: text(params.style),
          value2: String(anchors),
          value3: String(scenes),
        })
      }
      case NODE_TYPES.image:
        return typeof params.editModel === 'string'
          ? t('services.whenCharactersOrLocationsHave')
          : t('services.picture', { value: text(params.aspectRatio) })
      case NODE_TYPES.video:
        return t('services.s', {
          value: text(params.durationSec),
          value2: text(params.aspectRatio),
        })
      default:
        return undefined
    }
  }

  return {
    shot(shotId) {
      const handle = deps.projects.current()
      if (!handle || handle.closed) {
        throw new AppError({
          code: 'project_not_found',
          userMessage: t('services.openOrCreateAProject'),
        })
      }
      const { shots, costs } = handle.repos
      const shot = shots.get(shotId)
      if (!shot) {
        throw new AppError({ code: 'invalid_request', userMessage: t('services.canTFindThisShot') })
      }
      const flow = deps.shots.flowOf(shotId)

      // 顯示的結果：採用中的影片那一次生成；沒有就取最新的影片或首幀圖
      const videos = shots.listTakes(shotId, 'video')
      const frames = shots.listTakes(shotId, 'first_frame')
      const take =
        videos.find((t) => t.adopted) ??
        videos.at(-1) ??
        frames.find((t) => t.adopted) ??
        frames.at(-1)
      const runId = take?.runId ?? undefined
      // 快速開始的子流程節點 ID 有前綴（例如 each[3]/video）；單鏡頭重生沒有前綴。
      // 從產生這個版本的那個節點執行紀錄找出前綴，再取同一個前綴底下的節點。
      const nodeRuns = new Map<string, NodeRun>()
      if (runId) {
        const all = handle.repos.runs.listNodeRuns(runId)
        const source = all.find((r) => r.id === take?.nodeRunId)
        const prefix = source ? source.nodeId.slice(0, source.nodeId.lastIndexOf('/') + 1) : ''
        for (const nodeRun of all) {
          if (!nodeRun.nodeId.startsWith(prefix)) continue
          const rest = nodeRun.nodeId.slice(prefix.length)
          if (!rest.includes('/')) nodeRuns.set(rest, nodeRun)
        }
      }

      // 每個節點的花費：帳本裡記著是哪個節點執行產生的
      const nodeCost = new Map<string, number>()
      if (runId) {
        const nodeOfRun = new Map([...nodeRuns].map(([nodeId, r]) => [r.id, nodeId]))
        for (const entry of costs.list(handle.projectId, { runId })) {
          const nodeId = entry.nodeRunId ? nodeOfRun.get(entry.nodeRunId) : undefined
          if (nodeId) nodeCost.set(nodeId, (nodeCost.get(nodeId) ?? 0) + entry.amountUsd)
        }
      }

      const titleOf = (type: string): string => NODE_INFO[type]?.title ?? type
      const byId = new Map(flow.nodes.map((n) => [n.id, n]))
      const positions = layoutNodes(
        flow.nodes.map((n) => n.id),
        flow.edges.map((e) => ({ from: e.from.nodeId, to: e.to.nodeId })),
      )

      const nodes: GraphNodeView[] = flow.nodes.map((node) => {
        const def = registry.get(node.type)
        const run = nodeRuns.get(node.id)
        const connected = new Set(
          flow.edges.filter((e) => e.to.nodeId === node.id).map((e) => e.to.port),
        )
        const sources = [
          ...new Set(
            flow.edges
              .filter((e) => e.to.nodeId === node.id)
              .map((e) => titleOf(byId.get(e.from.nodeId)?.type ?? '')),
          ),
        ]
        const port = PREVIEW_PORT[node.type]
        const preview = run?.output !== undefined && port ? previewOf(run.output, port) : undefined
        const startedAt = run?.startedAt ? Date.parse(run.startedAt) : Number.NaN
        const finishedAt = run?.finishedAt ? Date.parse(run.finishedAt) : Number.NaN
        const durationMs =
          Number.isFinite(startedAt) && Number.isFinite(finishedAt) && run?.status === 'succeeded'
            ? Math.max(0, finishedAt - startedAt)
            : undefined
        const modelId = node.modelId === '' ? undefined : node.modelId
        const modelName = modelId ? displayNameOf(deps.models.get(modelId), modelId) : undefined
        const summary = summaryOf(node)
        const cost = nodeCost.get(node.id)
        return {
          id: node.id,
          type: node.type,
          title: titleOf(node.type),
          category: NODE_INFO[node.type]?.category ?? 'prompt',
          position: positions.get(node.id) ?? node.position,
          ...(modelName ? { modelName } : {}),
          ...(summary ? { summary } : {}),
          sources,
          inputs: Object.entries(def?.inputs ?? {}).map(([name, spec]) => ({
            name,
            type: spec.type,
            connected: connected.has(name),
            ...(spec.optional ? { optional: true } : {}),
          })),
          outputs: Object.entries(def?.outputs ?? {}).map(([name, type]) => ({ name, type })),
          status: run ? STATUS[run.status] : 'idle',
          ...(durationMs === undefined ? {} : { durationMs }),
          ...(cost === undefined ? {} : { costUsd: cost }),
          ...(preview ? { preview } : {}),
          ...(run?.error ? { error: run.error.userMessage } : {}),
        }
      })

      const edges: GraphEdgeView[] = flow.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        kind: REFERENCE_PORTS.has(edge.to.port) ? 'reference' : 'data',
      }))

      const total = [...nodeCost.values()].reduce((sum, v) => sum + v, 0)
      return {
        shotId,
        number: shot.number,
        nodes,
        edges,
        ...(runId ? { runId } : {}),
        ...(nodeCost.size > 0 ? { totalCostUsd: total } : {}),
      }
    },
  }
}
