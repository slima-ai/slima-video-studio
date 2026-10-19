import { AppError, IdSchema, IsoDateTimeSchema } from '@svs/schema'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const PROJECT_FILE_NAME = 'project.json'
export const PROJECT_FORMAT = 'svs-project'
/** project.json 本身的格式版本（和資料庫 schema 版本無關）。 */
export const PROJECT_FORMAT_VERSION = 1

export const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.number().int().positive(),
  projectId: IdSchema,
  name: z.string().min(1),
  /** 最後一次開啟這個專案的 App 版本。 */
  appVersion: z.string(),
  createdAt: IsoDateTimeSchema,
})
export type ProjectFile = z.infer<typeof ProjectFileSchema>

export function readProjectFile(dir: string): ProjectFile {
  const path = join(dir, PROJECT_FILE_NAME)
  if (!existsSync(path)) {
    throw new AppError({
      code: 'project_not_found',
      userMessage: '找不到專案，這個資料夾裡沒有 project.json。',
    })
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new AppError({
      code: 'project_invalid',
      userMessage: 'project.json 損壞，無法讀取。',
      cause,
    })
  }
  const parsed = ProjectFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError({
      code: 'project_invalid',
      userMessage: 'project.json 的格式不正確。',
      cause: parsed.error,
    })
  }
  if (parsed.data.formatVersion > PROJECT_FORMAT_VERSION) {
    throw new AppError({
      code: 'project_too_new',
      userMessage: '這個專案是用比較新版本的 Slima Video Studio 建立的，請先更新 App。',
    })
  }
  return parsed.data
}

/** 先寫暫存檔再改名，避免寫到一半當機造成 project.json 損壞。 */
export function writeProjectFile(dir: string, file: ProjectFile): void {
  const path = join(dir, PROJECT_FILE_NAME)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
  renameSync(tmp, path)
}
