import { AppError, type Project } from '@svs/schema'
import type { Database } from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { AssetStore } from './asset-store'
import { openDatabase, type AppDb } from './database'
import { acquireProjectLock } from './lock'
import { getSchemaVersion, runMigrations, type MigrationResult } from './migrate'
import { MIGRATIONS, type Migration } from './migrations.generated'
import {
  PROJECT_FILE_NAME,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  readProjectFile,
  writeProjectFile,
} from './project-file'
import { CanvasRepository } from './repositories/canvas'
import { CostRepository } from './repositories/costs'
import { FinalCutRepository } from './repositories/final-cuts'
import { SoundRepository } from './repositories/sound'
import { JobsRepository } from './repositories/jobs'
import { LocationCardsRepository } from './repositories/location-cards'
import { OutlineRepository } from './repositories/outline'
import { ProjectsRepository } from './repositories/projects'
import { RunsRepository } from './repositories/runs'
import { CharactersRepository } from './repositories/characters'
import { ShotsRepository } from './repositories/shots'
import { SlimaLinksRepository } from './repositories/slima-links'

export const PROJECT_DIR_SUFFIX = '.svsproj'
export const DB_FILE_NAME = 'project.sqlite'
const SUBFOLDERS = ['assets', 'exports', 'backups'] as const

export interface ProjectEnv {
  /** 目前 App 版本，寫進 project.json。 */
  appVersion: string
  /** 測試用：覆蓋 migration 清單。 */
  migrations?: readonly Migration[]
  now?: () => Date
}

export interface ProjectHandle {
  /** 專案資料夾（名稱.svsproj）的絕對路徑。 */
  readonly dir: string
  readonly sqlite: Database
  readonly db: AppDb
  /** 開啟時是否升級了資料庫（有的話 backupPath 是升級前的備份）。 */
  readonly migration: MigrationResult & { backupPath?: string }
  /** 這個專案的內容雜湊素材庫（assets/）。 */
  readonly assets: AssetStore
  readonly repos: {
    readonly projects: ProjectsRepository
    readonly shots: ShotsRepository
    readonly characters: CharactersRepository
    readonly outline: OutlineRepository
    readonly locationCards: LocationCardsRepository
    readonly slimaLinks: SlimaLinksRepository
    readonly jobs: JobsRepository
    readonly costs: CostRepository
    readonly runs: RunsRepository
    readonly canvas: CanvasRepository
    readonly finalCuts: FinalCutRepository
    readonly sound: SoundRepository
  }
  /** 資料庫層級的 project id。 */
  readonly projectId: string
  /** 已經關閉（資料庫不能再讀寫）。關閉專案時還在跑的背景工作，用它判斷要不要繼續寫入。 */
  readonly closed: boolean
  close: () => void
}

export interface CreateProjectInput {
  /** 專案資料夾的完整路徑，必須以 .svsproj 結尾，且還不存在。 */
  dir: string
  name: string
}

function backupDatabase(dir: string, from: number, now: Date): string {
  const stamp = now.toISOString().replaceAll(/[:.]/g, '-')
  const backupDir = join(dir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, `project-v${String(from)}-${stamp}.sqlite`)
  copyFileSync(join(dir, DB_FILE_NAME), backupPath)
  return backupPath
}

function build(dir: string, env: ProjectEnv, create?: { name: string }): ProjectHandle {
  const migrations = env.migrations ?? MIGRATIONS
  const now = env.now ?? (() => new Date())
  const lock = acquireProjectLock(dir)
  let opened: ReturnType<typeof openDatabase> | undefined
  try {
    const dbFile = join(dir, DB_FILE_NAME)
    if (!create && !existsSync(dbFile)) {
      throw new AppError({
        code: 'project_invalid',
        userMessage: '專案資料夾裡沒有 project.sqlite，專案可能已損壞。',
      })
    }
    opened = openDatabase(dbFile)

    // 升級前先備份（全新專案沒有東西可備份）
    let backupPath: string | undefined
    const migration = runMigrations(opened.sqlite, migrations, {
      beforeMigrate: ({ from }) => {
        if (from > 0) {
          // 把 WAL 內容寫回主檔，備份才完整
          opened?.sqlite.pragma('wal_checkpoint(TRUNCATE)')
          backupPath = backupDatabase(dir, from, now())
        }
      },
    })

    const projects = new ProjectsRepository(opened.db, now)
    let project: Project
    if (create) {
      const stamp = now().toISOString()
      project = projects.insert({
        id: randomUUID(),
        name: create.name,
        schemaVersion: migrations.length,
        aspectRatio: '16:9',
        budget: { perRunLimitUsd: 5 },
        models: {},
        createdAt: stamp,
        updatedAt: stamp,
      })
      writeProjectFile(dir, {
        format: PROJECT_FORMAT,
        formatVersion: PROJECT_FORMAT_VERSION,
        projectId: project.id,
        name: project.name,
        appVersion: env.appVersion,
        createdAt: stamp,
      })
    } else {
      const file = readProjectFile(dir)
      project = projects.get()
      if (file.projectId !== project.id) {
        throw new AppError({
          code: 'project_invalid',
          userMessage: 'project.json 與資料庫不屬於同一個專案。',
        })
      }
      if (project.schemaVersion !== migrations.length) projects.setSchemaVersion(migrations.length)
      writeProjectFile(dir, { ...file, name: project.name, appVersion: env.appVersion })
    }

    const { sqlite, db } = opened
    let closed = false
    const assets = new AssetStore(join(dir, 'assets'), db, { now })
    assets.cleanTmp()
    return {
      dir,
      sqlite,
      db,
      migration: { ...migration, ...(backupPath ? { backupPath } : {}) },
      projectId: project.id,
      assets,
      repos: {
        projects,
        shots: new ShotsRepository(db, project.id, now),
        characters: new CharactersRepository(db, project.id, now),
        outline: new OutlineRepository(db, project.id),
        locationCards: new LocationCardsRepository(db, project.id),
        slimaLinks: new SlimaLinksRepository(db, project.id, now),
        jobs: new JobsRepository(db),
        costs: new CostRepository(db, now),
        runs: new RunsRepository(db),
        canvas: new CanvasRepository(db, project.id, now),
        finalCuts: new FinalCutRepository(db, project.id, now),
        sound: new SoundRepository(db, project.id, now),
      },
      get closed() {
        return closed
      },
      close: () => {
        if (closed) return
        closed = true
        sqlite.close()
        lock.release()
      },
    }
  } catch (error) {
    opened?.sqlite.close()
    lock.release()
    throw error
  }
}

/** 建立新專案：資料夾、project.json、project.sqlite、assets/、exports/。 */
export function createProject(input: CreateProjectInput, env: ProjectEnv): ProjectHandle {
  if (!input.dir.endsWith(PROJECT_DIR_SUFFIX)) {
    throw new AppError({
      code: 'invalid_request',
      userMessage: `專案資料夾名稱必須以 ${PROJECT_DIR_SUFFIX} 結尾。`,
    })
  }
  if (existsSync(input.dir)) {
    throw new AppError({
      code: 'project_exists',
      userMessage: '這個位置已經有同名的專案或資料夾了。',
    })
  }
  mkdirSync(input.dir, { recursive: true })
  for (const sub of SUBFOLDERS) mkdirSync(join(input.dir, sub), { recursive: true })
  return build(input.dir, env, { name: input.name })
}

/** 開啟既有專案：驗證 project.json、取得鎖、必要時先備份再升級資料庫。 */
export function openProject(dir: string, env: ProjectEnv): ProjectHandle {
  if (
    !existsSync(dir) ||
    !statSync(dir).isDirectory() ||
    !readdirSync(dir).includes(PROJECT_FILE_NAME)
  ) {
    throw new AppError({
      code: 'project_not_found',
      userMessage: '找不到專案，請確認資料夾位置。',
    })
  }
  for (const sub of SUBFOLDERS) mkdirSync(join(dir, sub), { recursive: true })
  return build(dir, env)
}

export { getSchemaVersion }

/**
 * 專案最後一次寫入的時間。專案開著時資料先寫進 WAL（project.sqlite-wal），要等整理回主檔才會動到
 * project.sqlite 的修改時間；所以兩個檔取較新的。都沒有（空資料夾）就用資料夾本身的時間。
 */
export function projectModifiedAt(dir: string): Date {
  const times = [DB_FILE_NAME, `${DB_FILE_NAME}-wal`]
    .map((name) => join(dir, name))
    .filter((path) => existsSync(path))
    .map((path) => statSync(path).mtime)
  return times.length > 0
    ? new Date(Math.max(...times.map((t) => t.getTime())))
    : statSync(dir).mtime
}
