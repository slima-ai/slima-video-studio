import { AppError } from '@svs/schema'
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

export const LOCK_FILE_NAME = 'project.lock'

interface LockInfo {
  pid: number
  host: string
  startedAt: string
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM：行程存在但沒有權限，仍然算活著
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLock(path: string): LockInfo | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo
  } catch {
    return undefined
  }
}

export interface ProjectLock {
  release: () => void
}

/**
 * 用 `wx` 旗標原子性地建立鎖檔，防止同一個專案被兩個視窗（或兩個 App）同時開啟。
 * 鎖的持有者行程已經不存在（上次當機）時，視為過期鎖並接手。
 */
export function acquireProjectLock(dir: string): ProjectLock {
  const path = join(dir, LOCK_FILE_NAME)
  const info: LockInfo = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, JSON.stringify(info))
      closeSync(fd)
      return {
        release: () => {
          // 只刪除自己持有的鎖
          if (readLock(path)?.pid === process.pid) rmSync(path, { force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const holder = readLock(path)
      const stale = !holder || (holder.host === info.host && !isProcessAlive(holder.pid))
      if (!stale) {
        throw new AppError({
          code: 'project_locked',
          userMessage: '這個專案已經在另一個視窗開啟了，請先關閉那個視窗再試一次。',
        })
      }
      rmSync(path, { force: true })
    }
  }
  throw new AppError({
    code: 'project_locked',
    userMessage: '無法取得專案的使用權，請稍後再試。',
  })
}
