import { projectModifiedAt, readProjectFile } from '@svs/db'
import { AppError, type ProjectInfo, type ProjectSummary, type RecentProject, t } from '@svs/schema'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

import { safeFileName, stamp } from './ensure-project'
import type { ProjectManager } from './project-manager'
import { RECENT_LIMIT, type RecentStore } from './recent-projects'

export interface ProjectLibraryDeps {
  projects: ProjectManager
  /** 預設的專案資料夾（文件／Slima Video Studio）。 */
  projectsDir: string
  reveal: (path: string) => void
  /** 跳出選資料夾的視窗（save：選新專案要存哪；open：選一個舊專案）；取消回 undefined。沒給（測試）就當作取消。 */
  pickFolder?: (purpose: 'save' | 'open') => Promise<string | undefined>
  /** 最近開過的專案；沒給（測試）就只看專案資料夾裡的。 */
  recent?: RecentStore
  now?: () => Date
}

export interface ProjectLibrary {
  list: () => { folder: string; projects: ProjectSummary[] }
  /** `parentDir` 只有畫面用的 `project.createAt` 會給；MCP 的 `project.createNew` 永遠放預設資料夾。 */
  createNew: (name?: string, parentDir?: string) => ProjectInfo
  pickFolder: () => Promise<string | undefined>
  /** 另存為：複製目前的專案（含素材）到 `parentDir`（沒給就是預設資料夾），改名，切過去開那一份。 */
  saveAs: (name: string, parentDir?: string) => Promise<ProjectInfo>
  /** 最近的專案（最多 10 個）：記住的加上專案資料夾裡的，找不到的標出來。 */
  recent: () => RecentProject[]
  /** 打開最近的專案清單裡的一個；只接受清單裡的路徑。 */
  openRecent: (dir: string) => ProjectInfo
  forgetRecent: (dir: string) => void
  /** 選一個舊專案的資料夾並打開；取消回 null。 */
  pickAndOpen: () => Promise<ProjectInfo | null>
  reveal: (dir?: string) => void
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 專案頁用：列出專案資料夾裡的專案（加上目前開著的，即使它放在別處）、開新的空專案、
 * 在檔案總管顯示。只看資料夾的第一層，讀 project.json 拿名字，壞掉的跳過。
 */
export function createProjectLibrary(deps: ProjectLibraryDeps): ProjectLibrary {
  const { projects, projectsDir } = deps

  /** 新專案（或另存的複本）的資料夾：放在指定位置（要是已存在的絕對路徑資料夾）或預設的專案資料夾。 */
  const newProjectDir = (title: string, parentDir: string | undefined): string => {
    if (parentDir === undefined) {
      mkdirSync(projectsDir, { recursive: true })
    } else if (!isAbsolute(parentDir) || !isDirectory(parentDir)) {
      // 指定的位置一定要是已經存在的資料夾（選資料夾的視窗選出來的），不替人建一串不存在的路徑
      throw invalid(t('projects.canTFindThatFolder'))
    }
    const at = deps.now?.() ?? new Date()
    return join(parentDir ?? projectsDir, `${safeFileName(title, '我的短片')}-${stamp(at)}.svsproj`)
  }

  const summaryOf = (dir: string, currentDir: string | undefined): ProjectSummary | undefined => {
    try {
      const file = readProjectFile(dir)
      const updated = projectModifiedAt(dir)
      return {
        dir,
        name: file.name,
        createdAt: file.createdAt,
        updatedAt: updated.toISOString(),
        current: currentDir !== undefined && resolve(dir) === resolve(currentDir),
      }
    } catch {
      return undefined
    }
  }

  const list = (): { folder: string; projects: ProjectSummary[] } => {
    const currentDir = projects.current()?.dir
    const dirs = existsSync(projectsDir)
      ? readdirSync(projectsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(projectsDir, entry.name))
      : []
    if (currentDir !== undefined && !dirs.some((dir) => resolve(dir) === resolve(currentDir))) {
      dirs.push(currentDir)
    }
    const found = dirs
      .map((dir) => summaryOf(dir, currentDir))
      .filter((summary): summary is ProjectSummary => summary !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { folder: projectsDir, projects: found }
  }

  /** 記住的專案（最近開過的）＋專案資料夾裡的，依最後開啟或修改的時間，最新在前，最多 10 個。 */
  const recent = (): RecentProject[] => {
    const currentDir = projects.current()?.dir
    const isCurrent = (dir: string): boolean =>
      currentDir !== undefined && resolve(dir) === resolve(currentDir)
    const rows = new Map<string, RecentProject>()
    for (const entry of deps.recent?.list() ?? []) {
      const summary = summaryOf(entry.dir, currentDir)
      rows.set(resolve(entry.dir), {
        dir: entry.dir,
        name: summary?.name ?? basename(entry.dir).replace(/\.svsproj$/, ''),
        lastOpenedAt: entry.lastOpenedAt,
        updatedAt: summary?.updatedAt ?? null,
        current: isCurrent(entry.dir),
        // 資料夾還在但讀不出專案（壞掉）也當作找不到
        missing: summary === undefined,
      })
    }
    for (const summary of list().projects) {
      if (rows.has(resolve(summary.dir))) continue
      rows.set(resolve(summary.dir), {
        dir: summary.dir,
        name: summary.name,
        lastOpenedAt: null,
        updatedAt: summary.updatedAt,
        current: summary.current,
        missing: false,
      })
    }
    return [...rows.values()]
      .sort((a, b) =>
        (b.lastOpenedAt ?? b.updatedAt ?? '').localeCompare(a.lastOpenedAt ?? a.updatedAt ?? ''),
      )
      .slice(0, RECENT_LIMIT)
  }

  return {
    list,

    createNew(name, parentDir) {
      const trimmed = name?.trim() ?? ''
      const title = trimmed === '' ? t('projects.myShortFilm') : trimmed
      return projects.create(newProjectDir(title, parentDir), title)
    },

    async saveAs(name, parentDir) {
      const title = name.trim()
      if (title === '') throw invalid(t('projects.giveThisProjectAName'))
      return projects.saveAs(newProjectDir(title, parentDir), title)
    },

    pickFolder: async () => (await deps.pickFolder?.('save')) ?? undefined,

    recent,

    openRecent(dir) {
      const entry = recent().find((p) => resolve(p.dir) === resolve(dir))
      if (!entry) throw invalid(t('projects.canTFindThisProject'))
      if (entry.missing) throw invalid(t('projects.thisProjectIsMissingIt'))
      return projects.open(entry.dir)
    },

    forgetRecent(dir) {
      deps.recent?.forget(dir)
    },

    async pickAndOpen() {
      const dir = await deps.pickFolder?.('open')
      if (dir === undefined) return null
      try {
        readProjectFile(dir)
      } catch {
        throw invalid(t('projects.thisFolderIsNotA'))
      }
      return projects.open(dir)
    },

    reveal(dir) {
      const target = dir ?? projects.current()?.dir
      if (target === undefined) throw invalid(t('projects.noProjectIsOpen'))
      // 只接受清單裡的專案，不接受任意路徑
      if (!list().projects.some((p) => resolve(p.dir) === resolve(target))) {
        throw invalid(t('projects.canTFindThisProject'))
      }
      deps.reveal(target)
    },
  }
}
