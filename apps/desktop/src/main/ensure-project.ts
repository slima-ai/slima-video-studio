import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectManager } from './project-manager'
import { t } from '@svs/schema'

/** 檔名不能有的字元與空白換成「-」，並限制長度。 */
export function safeFileName(text: string, fallback: string): string {
  const cleaned = text
    .replaceAll(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 24)
  return cleaned === '' ? fallback : cleaned
}

/** 檔名用的時間戳，例如 20261012-103812。 */
export const stamp = (date: Date): string =>
  date.toISOString().slice(0, 19).replaceAll(/[-:]/g, '').replace('T', '-')

/**
 * 還沒有開啟專案時，自動建一個（使用者不用先想「專案」是什麼）。
 * 專案名稱取自 `title` 的前幾個字；已經有開啟的專案就什麼都不做。
 */
export function ensureProject(
  projects: ProjectManager,
  projectsDir: string,
  title: string,
  at: Date = new Date(),
): void {
  if (projects.current()) return
  mkdirSync(projectsDir, { recursive: true })
  const name = safeFileName(title, t('projects.myShortFilm'))
  projects.create(join(projectsDir, `${name}-${stamp(at)}.svsproj`), name)
}
