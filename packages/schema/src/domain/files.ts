import { z } from 'zod'

import { ContentHashSchema, IsoDateTimeSchema } from './common'
import { AssetKindSchema } from './execution'

/** 專案裡的一個檔案，以及它被用在哪裡。 */
export const FileEntrySchema = z.object({
  hash: ContentHashSchema,
  kind: AssetKindSchema,
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().nonnegative().optional(),
  createdAt: IsoDateTimeSchema,
  /** 檔案在電腦上的位置。 */
  path: z.string(),
  /** 白話的用途：「第 2 鏡・首幀圖 v1（採用中）」。沒有任何用途就是空的。 */
  usedBy: z.array(z.string()),
})
export type FileEntry = z.infer<typeof FileEntrySchema>

/** 匯出到專案 exports 資料夾的成品。 */
export const ExportEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  modifiedAt: IsoDateTimeSchema,
})
export type ExportEntry = z.infer<typeof ExportEntrySchema>

export const FilesFilterSchema = z.object({
  kind: z.enum(['image', 'video']).optional(),
  /** 只看沒有被任何地方使用的檔案。 */
  unusedOnly: z.boolean().optional(),
})
export type FilesFilter = z.infer<typeof FilesFilterSchema>

export const FilesSnapshotSchema = z.object({
  /** 新的在前。 */
  files: z.array(FileEntrySchema),
  exports: z.array(ExportEntrySchema),
  /** 符合篩選的檔案總大小。 */
  totalBytes: z.number().int().nonnegative(),
  /** 專案所在資料夾。 */
  projectDir: z.string().optional(),
})
export type FilesSnapshot = z.infer<typeof FilesSnapshotSchema>

export const FileRevealRequestSchema = z.union([
  z.object({ hash: ContentHashSchema }),
  z.object({ exportName: z.string().min(1) }),
])
export type FileRevealRequest = z.infer<typeof FileRevealRequestSchema>
