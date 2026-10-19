import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

import { createProject, openProject, type ProjectEnv, type ProjectHandle } from '../project-folder'

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

export const env: ProjectEnv = { appVersion: '0.0.0-test' }

/** 建立暫存資料夾，測試結束自動刪除（並關閉其中開啟的專案）。 */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svs-db-test-'))
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

export function newProject(name = '測試專案', dir = tempDir(), e: ProjectEnv = env): ProjectHandle {
  const handle = createProject({ dir: join(dir, `${name}.svsproj`), name }, e)
  cleanups.push(() => {
    try {
      handle.close()
    } catch {
      // 測試裡可能已經關閉
    }
  })
  return handle
}

export function reopen(handle: ProjectHandle, e: ProjectEnv = env): ProjectHandle {
  const reopened = openProject(handle.dir, e)
  cleanups.push(() => {
    try {
      reopened.close()
    } catch {
      // 測試裡可能已經關閉
    }
  })
  return reopened
}
