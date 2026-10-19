import { z } from 'zod'

import { ContentHashSchema, IdSchema, IsoDateTimeSchema, LockStatusSchema } from './common'

export const StyleKindSchema = z.enum(['realistic', 'anime', '3d', 'watercolor', 'custom'])
export type StyleKind = z.infer<typeof StyleKindSchema>

export const StyleSchema = z.object({
  id: IdSchema,
  /** 沒有 projectId 代表內建風格。 */
  projectId: IdSchema.optional(),
  name: z.string().min(1),
  kind: StyleKindSchema,
  /** 會附加到 Prompt 的風格片段。 */
  promptFragment: z.string().default(''),
  /** 十六進位色碼。 */
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),
})
export type Style = z.infer<typeof StyleSchema>

export const CostumeSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
})
export type Costume = z.infer<typeof CostumeSchema>

export const CharacterSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  name: z.string().min(1),
  age: z.string().optional(),
  personality: z.string().default(''),
  /** 外觀文字描述（使用者輸入）。 */
  appearance: z.string().default(''),
  costumes: z.array(CostumeSchema).default([]),
  styleId: IdSchema.optional(),
  /** 各 TTS 供應商的 voice ID。 */
  voices: z.record(z.string(), z.string()).default({}),
  /** 目前採用的角色包版本。 */
  currentPackId: IdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type Character = z.infer<typeof CharacterSchema>

/** 三視圖，每張都是素材庫裡的圖片。 */
export const TurnaroundSchema = z.object({
  front: ContentHashSchema,
  side: ContentHashSchema,
  back: ContentHashSchema,
})
export type Turnaround = z.infer<typeof TurnaroundSchema>

/** 角色包：一致性的單一真相來源。每次重新鎖定版本 +1，舊版本保留。 */
export const CharacterPackSchema = z.object({
  id: IdSchema,
  characterId: IdSchema,
  version: z.number().int().positive(),
  status: LockStatusSchema.default('draft'),
  /** 固定、精簡的外觀錨點，之後每個 Prompt 都原封不動帶入。 */
  anchorText: z.string().default(''),
  heroAssetHash: ContentHashSchema.optional(),
  turnaround: TurnaroundSchema.optional(),
  createdAt: IsoDateTimeSchema,
})
export type CharacterPack = z.infer<typeof CharacterPackSchema>

export const LocationSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  anchorText: z.string().default(''),
  mainAssetHash: ContentHashSchema.optional(),
  /** 依序是 [反方向, 拉遠全景]；還沒生成的角度用空字串占位。 */
  angleAssetHashes: z.array(z.union([ContentHashSchema, z.literal('')])).default([]),
  status: LockStatusSchema.default('draft'),
})
export type Location = z.infer<typeof LocationSchema>
