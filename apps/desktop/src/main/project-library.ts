import { projectModifiedAt, readProjectFile } from '@svs/db'
import { AppError, type ProjectInfo, type ProjectSummary } from '@svs/schema'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { safeFileName, stamp } from './ensure-project'
import type { ProjectManager } from './project-manager'

export interface ProjectLibraryDeps {
  projects: ProjectManager
  /** 預設的專案資料夾（文件／Slima Video Studio）。 */
  projectsDir: string
  reveal: (path: string) => void
  /** 跳出選資料夾的視窗；取消回 undefined。沒給（測試）就當作取消。 */
  pickFolder?: () => Promise<string | undefined>
  now?: () => Date
}

export interface ProjectLibrary {
  list: () => { folder: string; projects: ProjectSummary[] }
  /** `parentDir` 只有畫面用的 `project.createAt` 會給；MCP 的 `project.createNew` 永遠放預設資料夾。 */
  createNew: (name?: string, parentDir?: string) => ProjectInfo
  pickFolder: () => Promise<string | undefined>
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

  return {
    list,

    createNew(name, parentDir) {
      const trimmed = name?.trim() ?? ''
      const title = trimmed === '' ? '我的短片' : trimmed
      if (parentDir === undefined) {
        mkdirSync(projectsDir, { recursive: true })
      } else if (!isAbsolute(parentDir) || !isDirectory(parentDir)) {
        // 指定的位置一定要是已經存在的資料夾（選資料夾的視窗選出來的），不替人建一串不存在的路徑
        throw invalid('找不到這個資料夾，請重新選一個存放的位置。')
      }
      const at = deps.now?.() ?? new Date()
      return projects.create(
        join(parentDir ?? projectsDir, `${safeFileName(title, '我的短片')}-${stamp(at)}.svsproj`),
        title,
      )
    },

    pickFolder: async () => (await deps.pickFolder?.()) ?? undefined,

    reveal(dir) {
      const target = dir ?? projects.current()?.dir
      if (target === undefined) throw invalid('還沒有開著的專案。')
      // 只接受清單裡的專案，不接受任意路徑
      if (!list().projects.some((p) => resolve(p.dir) === resolve(target))) {
        throw invalid('找不到這個專案。')
      }
      deps.reveal(target)
    },
  }
}
