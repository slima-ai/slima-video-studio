import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * App 層的花費帳本：不屬於任何專案、刪專案也不會受影響。
 * 用在「花了錢、但專案已經不在了」的情況（例如寫預告片腳本失敗，剛建的空專案被刪掉）。
 * 這裡的金額會算進「已花」與專案花費上限（掛在每個專案的花費帳本上，見 `CostRepository.setExternalTotal`）。
 */
export const AppLedgerEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  provider: z.string(),
  modelId: z.string(),
  amountUsd: z.number().nonnegative(),
  jobId: z.string().optional(),
  /** 這筆錢是為什麼記在這裡（給人看紀錄用）。 */
  reason: z.string(),
})
export type AppLedgerEntry = z.infer<typeof AppLedgerEntrySchema>

const FileSchema = z.object({ entries: z.array(AppLedgerEntrySchema) })

export type NewAppLedgerEntry = Omit<AppLedgerEntry, 'id' | 'createdAt'>

export interface AppSpendLedger {
  record: (entry: NewAppLedgerEntry) => AppLedgerEntry
  /** 加總；`excludeProviders` 跟專案帳本的規則一樣（示範用的 mock 不算真的花費）。 */
  totalUsd: (filter?: { excludeProviders?: readonly string[] }) => number
  list: () => AppLedgerEntry[]
}

export interface AppLedgerOptions {
  /** 帳本檔（JSON，放在使用者資料夾）；沒給就只放記憶體（測試用）。 */
  file?: string
  now?: () => Date
  warn?: (message: string) => void
}

/** 先寫暫存檔再改名：寫到一半斷電也不會把帳寫壞。 */
function writeAtomic(file: string, entries: readonly AppLedgerEntry[]): void {
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify({ entries }, null, 2))
  renameSync(temp, file)
}

export function createAppLedger(options: AppLedgerOptions): AppSpendLedger {
  const { file } = options
  const now = options.now ?? (() => new Date())
  const warn = options.warn ?? (() => undefined)

  const load = (): AppLedgerEntry[] => {
    if (file === undefined || !existsSync(file)) return []
    try {
      return FileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).entries
    } catch (error) {
      // 壞掉的檔案改名留著（裡面也許還救得回來），用空帳繼續，不讓 App 打不開
      const backup = `${file}.broken-${String(Date.now())}`
      try {
        renameSync(file, backup)
      } catch {
        // 備份失敗也繼續
      }
      warn(
        `The spend ledger could not be read; backed it up as ${backup} and started empty: ${String(error)}`,
      )
      return []
    }
  }

  const entries = load()

  return {
    record(entry) {
      const full = AppLedgerEntrySchema.parse({
        ...entry,
        id: randomUUID(),
        createdAt: now().toISOString(),
      })
      entries.push(full)
      if (file !== undefined) writeAtomic(file, entries)
      return full
    },
    totalUsd(filter = {}) {
      const skip = new Set(filter.excludeProviders ?? [])
      return entries.reduce((sum, e) => (skip.has(e.provider) ? sum : sum + e.amountUsd), 0)
    },
    list: () => [...entries],
  }
}
