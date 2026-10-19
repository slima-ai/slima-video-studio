import { z } from 'zod'

import { ContentHashSchema } from './common'
import { PortTypeSchema } from './workflow'

/** 節點卡片的色條分類。 */
export const GraphCategorySchema = z.enum(['input', 'prompt', 'image', 'video', 'join', 'output'])
export type GraphCategory = z.infer<typeof GraphCategorySchema>

/** 節點在最近一次執行裡的狀態（還沒執行過是 idle）。 */
export const GraphNodeStatusSchema = z.enum([
  'idle',
  'running',
  'succeeded',
  'cached',
  'failed',
  'blocked',
  'cancelled',
])
export type GraphNodeStatus = z.infer<typeof GraphNodeStatusSchema>

export const GraphPortSchema = z.object({
  name: z.string(),
  type: PortTypeSchema,
  /** 輸入埠：有沒有被連線（沒連線也可以的選填埠才會是 false）。 */
  connected: z.boolean().optional(),
  optional: z.boolean().optional(),
})
export type GraphPort = z.infer<typeof GraphPortSchema>

export const GraphPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), hash: ContentHashSchema }),
  z.object({ kind: z.literal('video'), hash: ContentHashSchema }),
  z.object({ kind: z.literal('text'), text: z.string() }),
])
export type GraphPreview = z.infer<typeof GraphPreviewSchema>

export const GraphNodeViewSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** 白話名稱。 */
  title: z.string(),
  category: GraphCategorySchema,
  position: z.object({ x: z.number(), y: z.number() }),
  modelName: z.string().optional(),
  /** 卡片上的一行說明（這一步做什麼、用了哪些設定）。 */
  summary: z.string().optional(),
  /** 這個節點的輸入來自哪幾個上游節點（白話名稱）。 */
  sources: z.array(z.string()),
  inputs: z.array(GraphPortSchema),
  outputs: z.array(GraphPortSchema),
  status: GraphNodeStatusSchema,
  durationMs: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  preview: GraphPreviewSchema.optional(),
  error: z.string().optional(),
})
export type GraphNodeView = z.infer<typeof GraphNodeViewSchema>

export const GraphEdgeViewSchema = z.object({
  id: z.string(),
  from: z.object({ nodeId: z.string(), port: z.string() }),
  to: z.object({ nodeId: z.string(), port: z.string() }),
  /** 參考連線（角色、場景的參考圖）畫成虛線。 */
  kind: z.enum(['data', 'reference']),
})
export type GraphEdgeView = z.infer<typeof GraphEdgeViewSchema>

/** 一個鏡頭的生成流程圖，連同最近一次生成的結果。 */
export const ShotGraphSchema = z.object({
  shotId: z.string(),
  number: z.number().int().positive(),
  nodes: z.array(GraphNodeViewSchema),
  edges: z.array(GraphEdgeViewSchema),
  /** 顯示的是哪一次生成的結果；還沒生成過就沒有。 */
  runId: z.string().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
})
export type ShotGraph = z.infer<typeof ShotGraphSchema>
