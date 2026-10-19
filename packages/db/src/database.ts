import BetterSqlite3, { type Database } from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as core from './tables/core'
import * as execution from './tables/execution'

export const dbSchema = { ...core, ...execution }
export type AppDb = BetterSQLite3Database<typeof dbSchema>

export interface OpenedDatabase {
  sqlite: Database
  db: AppDb
}

/** 開啟（或建立）SQLite 檔，套用本專案要求的 pragma。 */
export function openDatabase(file: string): OpenedDatabase {
  const sqlite = new BetterSqlite3(file)
  // WAL：讀寫不互相阻塞，當機後也能還原
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite, { schema: dbSchema }) }
}
