import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Logger } from './logger'
import type { ProjectManager } from './project-manager'

/** 最近的專案最多記幾個。 */
export const RECENT_LIMIT = 10

export interface RecentEntry {
  dir: string
  lastOpenedAt: string
}

export interface RecentStore {
  /** 最近開過的在前。 */
  list: () => RecentEntry[]
  add: (dir: string, at: Date) => void
  forget: (dir: string) => void
}

const same = (a: string, b: string): boolean => resolve(a) === resolve(b)

/**
 * 記住最近開過哪些專案（只存路徑與最後開啟的時間，最多 10 個），給首頁與專案選單的「最近的專案」用。
 * 路徑在不在不在這裡管：清單顯示時才去看，找不到的標出來、讓人自己移除。檔案壞掉就當作是空的。
 */
export function createRecentStore(file: string, log: Pick<Logger, 'warn'>): RecentStore {
  let entries = read(file)
  const save = (): void => {
    try {
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify({ projects: entries }))
      renameSync(tmp, file)
    } catch (error) {
      log.warn(
        `Could not remember the recent project: ${error instanceof Error ? error.message : ''}`,
      )
    }
  }
  return {
    list: () => [...entries],
    add(dir, at) {
      entries = [
        { dir, lastOpenedAt: at.toISOString() },
        ...entries.filter((entry) => !same(entry.dir, dir)),
      ].slice(0, RECENT_LIMIT)
      save()
    },
    forget(dir) {
      const next = entries.filter((entry) => !same(entry.dir, dir))
      if (next.length === entries.length) return
      entries = next
      save()
    },
  }
}

/** 專案開啟時（含啟動時接著上次的）就記一筆。回傳取消訂閱函式。 */
export function trackRecentProjects(
  store: RecentStore,
  projects: ProjectManager,
  now: () => Date = () => new Date(),
): () => void {
  const current = projects.current()
  if (current) store.add(current.dir, now())
  return projects.onChange((handle) => {
    if (handle) store.add(handle.dir, now())
  })
}

function read(file: string): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('projects' in parsed)) return []
    const list = parsed.projects
    if (!Array.isArray(list)) return []
    const entries: RecentEntry[] = []
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) continue
      const { dir, lastOpenedAt } = item as Record<string, unknown>
      if (typeof dir === 'string' && dir !== '' && typeof lastOpenedAt === 'string') {
        entries.push({ dir, lastOpenedAt })
      }
    }
    return entries.slice(0, RECENT_LIMIT)
  } catch {
    // 檔案不存在或壞掉：沒有記錄
    return []
  }
}
