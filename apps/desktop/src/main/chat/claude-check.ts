import { execFile } from 'node:child_process'

import { CHAT_MIN_CLAUDE_VERSION } from '@svs/schema'

import { claudeEnv } from './claude-args'

/** 執行一個檔案、收它的標準輸出（參數用陣列，不經 shell）；失敗而且沒有任何輸出（找不到、逾時）就丟錯。 */
export type RunCapture = (file: string, args: string[]) => Promise<string>

export const runCaptureDirect: RunCapture = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 15_000, windowsHide: true, env: claudeEnv(process.env) },
      (error, stdout) => {
        // 沒登入時 `auth status` 可能用非 0 結束、但還是印了 JSON：有輸出就交給呼叫的人看
        if (error && stdout.trim() === '') reject(new Error(error.message))
        else resolve(stdout)
      },
    )
  })

/** `claude --version` 的輸出（例如「2.1.304 (Claude Code)」）取出版本號。 */
export function parseVersion(text: string): string | undefined {
  return /(\d+)\.(\d+)\.(\d+)/.exec(text)?.[0]
}

/** 比較 x.y.z 版本號：a 比較新回正數、一樣 0、較舊負數。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export type ClaudeCheck =
  | { state: 'not_installed' }
  | { state: 'too_old'; path: string; version: string; minVersion: string }
  | { state: 'not_logged_in'; path: string; version: string }
  | { state: 'ready'; path: string; version: string }

export interface ClaudeCheckDeps {
  /** 找 claude 執行檔的完整路徑（用使用者的登入環境找，PATH 才跟終端機一樣）；找不到回 undefined。 */
  findClaude: () => Promise<string | undefined>
  run: RunCapture
}

/**
 * 有沒有裝 Claude Code、版本夠不夠新、有沒有登入。我們不代為安裝、不代為登入、不碰他的憑證：
 * 登入只問 `claude auth status --json` 的 `loggedIn`（輸出裡還有 email 與組織名，一律不讀、不記）。
 * 這個指令的輸出解析不出來（舊版沒有、或格式變了）就不擋，讓第一輪的錯誤來說話。
 */
export async function checkClaude(deps: ClaudeCheckDeps): Promise<ClaudeCheck> {
  const path = await deps.findClaude().catch(() => undefined)
  if (path === undefined) return { state: 'not_installed' }
  const version = parseVersion(await deps.run(path, ['--version']).catch(() => ''))
  if (version === undefined) return { state: 'not_installed' }
  if (compareVersions(version, CHAT_MIN_CLAUDE_VERSION) < 0) {
    return { state: 'too_old', path, version, minVersion: CHAT_MIN_CLAUDE_VERSION }
  }
  const status = await deps.run(path, ['auth', 'status', '--json']).catch(() => undefined)
  if (status !== undefined) {
    try {
      const parsed: unknown = JSON.parse(status)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { loggedIn?: unknown }).loggedIn === false
      ) {
        return { state: 'not_logged_in', path, version }
      }
    } catch {
      // 解析不出來：不擋
    }
  }
  return { state: 'ready', path, version }
}
