import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import type { Logger } from './logger'
import type { ProjectManager } from './project-manager'

/**
 * 記住最後開啟的專案，下次啟動自動接著用，使用者不用自己去找檔案
 * （角色和做到一半的短片都在專案裡，重開 App 應該還在）。
 */
export function restoreLastProject(
  file: string,
  projects: ProjectManager,
  log: Pick<Logger, 'info' | 'warn'>,
): void {
  const last = readLast(file)
  if (last && existsSync(last)) {
    try {
      projects.open(last)
      log.info(`已接著上次的專案：${last}`)
    } catch (error) {
      // 專案被移走、損壞或被別的視窗開著：當作沒有上次的專案，不要擋住啟動
      log.warn(`無法開啟上次的專案（${last}）：${error instanceof Error ? error.message : ''}`)
    }
  }
  // 只記「開啟」；關閉專案（包含結束 App 時）不清掉記錄
  projects.onChange((handle) => {
    if (!handle) return
    try {
      writeFileSync(file, JSON.stringify({ dir: handle.dir }))
    } catch (error) {
      log.warn(`無法記住最後開啟的專案：${error instanceof Error ? error.message : ''}`)
    }
  })
}

function readLast(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'dir' in parsed) {
      return typeof parsed.dir === 'string' && parsed.dir !== '' ? parsed.dir : undefined
    }
  } catch {
    // 檔案不存在或壞掉：沒有上次的專案
  }
  return undefined
}
