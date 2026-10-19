import { z } from 'zod'

import { IdSchema } from './common'

/** 大綱裡的一個場。 */
export const OutlineSceneViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  summary: z.string(),
  locationId: IdSchema.optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
})
export type OutlineSceneView = z.infer<typeof OutlineSceneViewSchema>

/** 大綱裡的一幕與它底下的場（依順序）。 */
export const OutlineActViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  summary: z.string(),
  scenes: z.array(OutlineSceneViewSchema),
})
export type OutlineActView = z.infer<typeof OutlineActViewSchema>

export const OutlineLocationViewSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
})
export type OutlineLocationView = z.infer<typeof OutlineLocationViewSchema>

/** 整份大綱：幕 → 場，以及故事裡出現的地點。 */
export const OutlineViewSchema = z.object({
  acts: z.array(OutlineActViewSchema),
  locations: z.array(OutlineLocationViewSchema),
})
export type OutlineView = z.infer<typeof OutlineViewSchema>

const DirectionSchema = z.enum(['up', 'down'])
const Text = z.string().max(4000)

/** 對大綱的一個修改動作。 */
export const OutlineOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addAct') }),
  z.object({
    op: z.literal('updateAct'),
    actId: IdSchema,
    patch: z.object({ title: z.string().max(200).optional(), summary: Text.optional() }),
  }),
  z.object({ op: z.literal('deleteAct'), actId: IdSchema }),
  z.object({ op: z.literal('moveAct'), actId: IdSchema, direction: DirectionSchema }),
  z.object({ op: z.literal('addScene'), actId: IdSchema }),
  z.object({
    op: z.literal('updateScene'),
    sceneId: IdSchema,
    patch: z.object({
      title: z.string().max(200).optional(),
      summary: Text.optional(),
      /** 搬到另一幕（放在那一幕的最後面）。 */
      actId: IdSchema.optional(),
      /** null 代表清掉。 */
      locationId: IdSchema.nullable().optional(),
      timeOfDay: z.string().max(100).nullable().optional(),
      mood: z.string().max(100).nullable().optional(),
    }),
  }),
  z.object({ op: z.literal('deleteScene'), sceneId: IdSchema }),
  z.object({ op: z.literal('moveScene'), sceneId: IdSchema, direction: DirectionSchema }),
  z.object({ op: z.literal('addLocation') }),
  z.object({
    op: z.literal('updateLocation'),
    locationId: IdSchema,
    patch: z.object({ name: z.string().min(1).max(100).optional(), description: Text.optional() }),
  }),
  z.object({ op: z.literal('deleteLocation'), locationId: IdSchema }),
])
export type OutlineOp = z.infer<typeof OutlineOpSchema>

/** 貼進來讓 AI 拆成分場的文字長度上限。 */
export const OUTLINE_TEXT_MAX = 60_000

export const OutlineTextSchema = z
  .string()
  .trim()
  .min(1, '請先貼上要拆成分場的文字')
  .max(OUTLINE_TEXT_MAX, `文字太長了，請控制在 ${String(OUTLINE_TEXT_MAX)} 字以內`)

/** 讓 AI 拆成分場之前的檢查與預估花費。 */
export const OutlineSplitCheckSchema = z.object({
  ok: z.boolean(),
  /** 不能拆的原因（白話）。 */
  issue: z.string().optional(),
  estimatedUsd: z.number().nonnegative(),
  modelName: z.string().optional(),
  demoMode: z.boolean(),
  /** 目前已經有大綱：拆完會整份換掉。 */
  replacesExisting: z.boolean(),
})
export type OutlineSplitCheck = z.infer<typeof OutlineSplitCheckSchema>

/** 拆完之後新增了什麼。 */
export const OutlineSplitResultSchema = z.object({
  outline: OutlineViewSchema,
  /** 新建立的角色（草稿）名字。 */
  newCharacters: z.array(z.string()),
  /** 新建立的地點名字。 */
  newLocations: z.array(z.string()),
})
export type OutlineSplitResult = z.infer<typeof OutlineSplitResultSchema>
