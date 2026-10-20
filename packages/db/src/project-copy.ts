import { AppError } from '@svs/schema'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DB_FILE_NAME,
  PROJECT_DIR_SUFFIX,
  openProject,
  type ProjectEnv,
  type ProjectHandle,
} from './project-folder'
import { readProjectFile, writeProjectFile } from './project-file'

/** 複製時要帶過去的資料夾：素材（內容雜湊命名）與匯出的成品。`.tmp` 是寫到一半的暫存，不帶。 */
const COPIED_FOLDERS = ['assets', 'exports'] as const

/**
 * 把開著的專案複製成另一個專案資料夾（另存為）。**不是直接複製 project.sqlite**：專案開著時資料先寫在
 * `project.sqlite-wal`，只複製主檔會漏掉最近的內容；所以用 SQLite 的 backup API 取一份一致的快照。
 * 素材照內容雜湊的資料夾結構原樣複製（assets/<前兩碼>/<hash>.<副檔名>），資料庫裡不存絕對路徑，所以兩邊各自成立。
 * 複本沿用同一個專案 id（資料庫裡所有資料都以它關聯），只有名字不同；鎖檔與升級備份不帶。
 * 失敗會把做到一半的資料夾整個刪掉。原本的專案不會被動到。
 */
export async function copyProject(
  source: ProjectHandle,
  destDir: string,
  options: { name: string; env: ProjectEnv },
): Promise<void> {
  if (!destDir.endsWith(PROJECT_DIR_SUFFIX)) {
    throw new AppError({
      code: 'invalid_request',
      userMessage: `專案資料夾名稱必須以 ${PROJECT_DIR_SUFFIX} 結尾。`,
    })
  }
  if (existsSync(destDir)) {
    throw new AppError({
      code: 'project_exists',
      userMessage: '這個位置已經有同名的專案或資料夾了。',
    })
  }
  mkdirSync(destDir, { recursive: true })
  try {
    // 一致的資料庫快照（含 WAL 裡還沒整理回主檔的內容）
    await source.sqlite.backup(join(destDir, DB_FILE_NAME))
    for (const folder of COPIED_FOLDERS) {
      const from = join(source.dir, folder)
      if (existsSync(from)) {
        await cp(from, join(destDir, folder), {
          recursive: true,
          filter: (path) => !path.split(/[\\/]/).includes('.tmp'),
        })
      } else {
        mkdirSync(join(destDir, folder), { recursive: true })
      }
    }
    mkdirSync(join(destDir, 'backups'), { recursive: true })
    writeProjectFile(destDir, readProjectFile(source.dir))
    // 開一次複本改名字（資料庫與 project.json 兩份一起），再關掉
    const copy = openProject(destDir, options.env)
    try {
      copy.repos.projects.update({ name: options.name })
      writeProjectFile(destDir, { ...readProjectFile(destDir), name: options.name })
    } finally {
      copy.close()
    }
  } catch (error) {
    rmSync(destDir, { recursive: true, force: true })
    if (error instanceof AppError) throw error
    throw new AppError({
      code: 'internal_error',
      userMessage:
        '另存失敗：複製專案的時候出錯了（硬碟空間不夠或沒有寫入權限？）。原本的專案沒有受影響。',
      cause: error,
    })
  }
}
