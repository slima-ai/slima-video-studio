import { z } from 'zod'

import { IdSchema, IsoDateTimeSchema } from './common'

/** 節點埠的資料型別（連線時用來做型別檢查）。 */
export const PortTypeSchema = z.enum([
  'text',
  'image',
  'imageList',
  'video',
  'audio',
  'characterRef',
  'refList',
  'shot',
  'json',
])
export type PortType = z.infer<typeof PortTypeSchema>

/**
 * 輸出埠 `from` 能不能接到輸入埠 `to`。
 * 引擎執行前與節點圖編輯器（M6）共用這一份規則。
 */
/** 除了「同型別」以外，額外允許的連線（輸出型別 → 可以接的輸入型別）。 */
const EXTRA_COMPATIBLE: Partial<Record<PortType, readonly PortType[]>> = {
  image: ['imageList', 'refList'],
  imageList: ['refList'],
  characterRef: ['refList'],
}

export function isPortCompatible(from: PortType, to: PortType): boolean {
  // json 是萬用埠：任何型別都可以接進去（「對每個項目執行」的出入口、結果收集都用它）
  return from === to || to === 'json' || (EXTRA_COMPATIBLE[from]?.includes(to) ?? false)
}

export const NodePositionSchema = z.object({ x: z.number(), y: z.number() })

export const WorkflowNodeSchema = z.object({
  id: IdSchema,
  /** 節點類型（對應引擎裡 defineNode 的 type）。 */
  type: z.string().min(1),
  /** 建立這個節點時的節點版本；節點定義升版時用來判斷是否需要遷移。 */
  version: z.number().int().positive(),
  /** 節點參數；各節點類型有自己的 Zod schema，由引擎在執行時驗證。 */
  params: z.record(z.string(), z.unknown()).default({}),
  modelId: z.string().optional(),
  position: NodePositionSchema.default({ x: 0, y: 0 }),
})
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>

export const WorkflowEndpointSchema = z.object({ nodeId: IdSchema, port: z.string().min(1) })

export const WorkflowEdgeSchema = z.object({
  id: IdSchema,
  from: WorkflowEndpointSchema,
  to: WorkflowEndpointSchema,
})
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>

export const WorkflowSchema = z.object({
  id: IdSchema,
  /** 沒有 projectId 代表內建模板。 */
  projectId: IdSchema.optional(),
  name: z.string().min(1),
  version: z.number().int().positive().default(1),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type Workflow = z.infer<typeof WorkflowSchema>
