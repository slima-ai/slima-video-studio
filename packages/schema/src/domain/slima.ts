import { z } from 'zod'

import { IdSchema, IsoDateTimeSchema } from './common'

export const SlimaEntityTypeSchema = z.enum(['outline', 'scene', 'character', 'location'])
export type SlimaEntityType = z.infer<typeof SlimaEntityTypeSchema>

/** 匯入資料與 Slima 來源的對應，用來提示「Slima 有新版本」。 */
export const SlimaLinkSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  /** 本專案中被匯入的實體。 */
  entityType: SlimaEntityTypeSchema,
  entityId: IdSchema,
  bookToken: z.string().min(1),
  /** 書本內的檔案路徑，例如 .script_studio/characters/hero.character。 */
  path: z.string().min(1),
  /** Slima 端的 commit 或更新時間，用來比對是否有新版本。 */
  remoteVersion: z.string().optional(),
  importedAt: IsoDateTimeSchema,
})
export type SlimaLink = z.infer<typeof SlimaLinkSchema>

/** Slima 連線狀態：沒填 Token、連線中、可以用、連不上。 */
export const SlimaConnectionStateSchema = z.enum(['no_token', 'connecting', 'ready', 'error'])
export type SlimaConnectionState = z.infer<typeof SlimaConnectionStateSchema>

export const SlimaStatusSchema = z.object({
  state: SlimaConnectionStateSchema,
  /** 給使用者看的說明（連不上的原因、重新連線中…）。 */
  message: z.string().optional(),
  /** 目前開放給 App 使用的唯讀工具數。 */
  toolCount: z.number().int().nonnegative().optional(),
  /** 設定了 Token 的末四碼（Token 夠長才有）。 */
  last4: z.string().length(4).optional(),
})
export type SlimaStatus = z.infer<typeof SlimaStatusSchema>

/** 書本類型：長篇小說（Writing Studio）、劇本（Script Studio）、團隊知識庫。 */
export const SlimaBookKindSchema = z.enum(['writing', 'script', 'knowledge'])
export type SlimaBookKind = z.infer<typeof SlimaBookKindSchema>

export const SlimaBookSchema = z.object({
  token: z.string().min(1),
  title: z.string(),
  kind: SlimaBookKindSchema,
  author: z.string().optional(),
  words: z.number().int().nonnegative(),
})
export type SlimaBook = z.infer<typeof SlimaBookSchema>

export const SlimaBooksSchema = z.object({ books: z.array(SlimaBookSchema) })
export type SlimaBooks = z.infer<typeof SlimaBooksSchema>

/** 匯入時，一個檔案要當成什麼：故事內容（拆成分場）、角色、地點、一場戲。 */
export const SlimaFileUseSchema = z.enum(['story', 'character', 'location', 'scene'])
export type SlimaFileUse = z.infer<typeof SlimaFileUseSchema>

export const SlimaFileSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  words: z.number().int().nonnegative(),
  /** 依副檔名與資料夾猜的用途，使用者可以改。 */
  suggestedUse: SlimaFileUseSchema,
})
export type SlimaFile = z.infer<typeof SlimaFileSchema>

export const SlimaTreeSchema = z.object({
  book: SlimaBookSchema,
  files: z.array(SlimaFileSchema),
})
export type SlimaTree = z.infer<typeof SlimaTreeSchema>

export const SLIMA_IMPORT_MAX_ITEMS = 50

export const SlimaImportItemSchema = z.object({
  path: z.string().min(1),
  use: SlimaFileUseSchema,
})
export type SlimaImportItem = z.infer<typeof SlimaImportItemSchema>

export const SlimaImportRequestSchema = z.object({
  bookToken: z.string().min(1),
  items: z.array(SlimaImportItemSchema).max(SLIMA_IMPORT_MAX_ITEMS),
})
export type SlimaImportRequest = z.infer<typeof SlimaImportRequestSchema>

export const SlimaSkippedSchema = z.object({ path: z.string(), reason: z.string() })
export type SlimaSkipped = z.infer<typeof SlimaSkippedSchema>

/** 匯入之前的檢查：會做什麼、花多少、會不會換掉現有的大綱。 */
export const SlimaImportCheckSchema = z.object({
  ok: z.boolean(),
  issue: z.string().optional(),
  /** 要拿去拆成分場的檔案數與字數。 */
  storyFiles: z.number().int().nonnegative(),
  storyChars: z.number().int().nonnegative(),
  characters: z.array(z.string()),
  locations: z.array(z.string()),
  scenes: z.array(z.string()),
  skipped: z.array(SlimaSkippedSchema),
  estimatedUsd: z.number().nonnegative(),
  modelName: z.string().optional(),
  demoMode: z.boolean(),
  /** 拆成分場會換掉目前的大綱。 */
  replacesOutline: z.boolean(),
})
export type SlimaImportCheck = z.infer<typeof SlimaImportCheckSchema>

export const SlimaImportResultSchema = z.object({
  /** 有拆成分場時：新增的幕數。 */
  actsFromStory: z.number().int().nonnegative(),
  characters: z.array(z.string()),
  locations: z.array(z.string()),
  scenes: z.array(z.string()),
  skipped: z.array(SlimaSkippedSchema),
})
export type SlimaImportResult = z.infer<typeof SlimaImportResultSchema>
