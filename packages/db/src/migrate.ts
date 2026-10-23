import { AppError, t } from '@svs/schema'
import type { Database } from 'better-sqlite3'

import type { Migration } from './migrations.generated'

export interface MigrationResult {
  /** migrate 前的版本（已套用的 migration 數量）。 */
  from: number
  /** migrate 後的版本。 */
  to: number
}

export interface MigrateOptions {
  /** 有 migration 要套用、真正動手之前呼叫（用來備份 sqlite 檔）。 */
  beforeMigrate?: (result: MigrationResult) => void
}

/** 目前資料庫的版本：用 SQLite 的 user_version 記錄已套用的 migration 數量。 */
export function getSchemaVersion(sqlite: Database): number {
  return sqlite.pragma('user_version', { simple: true }) as number
}

/**
 * 依序套用還沒套用的 migration；每個 migration 各自一個 transaction，失敗就整個 rollback。
 * 資料庫版本比 App 新（被新版 App 開過）時拒絕開啟，避免舊版 App 弄壞資料。
 */
export function runMigrations(
  sqlite: Database,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): MigrationResult {
  const from = getSchemaVersion(sqlite)
  const to = migrations.length

  if (from > to) {
    throw new AppError({
      code: 'project_too_new',
      userMessage: t('errors.thisProjectWasCreatedWith'),
    })
  }
  if (from === to) return { from, to }

  options.beforeMigrate?.({ from, to })

  for (const [index, migration] of migrations.entries()) {
    if (index < from) continue
    const apply = sqlite.transaction(() => {
      for (const statement of migration.statements) sqlite.exec(statement)
      sqlite.pragma(`user_version = ${String(index + 1)}`)
    })
    try {
      apply()
    } catch (cause) {
      throw new AppError({
        code: 'project_invalid',
        userMessage: t('errors.couldnTUpgradeTheProject', { tag: migration.tag }),
        cause,
      })
    }
  }
  return { from, to }
}
