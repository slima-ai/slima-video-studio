#!/usr/bin/env node
// 「檢查」拖很久的假 claude：--version 與 auth status 會卡到閘門檔案出現才回答，其他行為同 claude.mjs。
// e2e 用它控制檢查什麼時候有結果（檔案出現才放行），不靠真的等時間。
// （App 只給 claude 行程最小的環境變數，所以閘門的位置不能靠環境變數傳：閘門檔放在「啟動它的那支檔」旁邊，
// 測試每個 worker 各複製一支小轉接檔到自己的資料夾（見 claude-chat.e2e.ts 的 slowClaude），不共用固定路徑——
// 共用的話，兩條測試跑在不同 worker 時，一條放行會讓另一條的檢查也提早有結果。）
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SLOW_CHECK_GATE_FILE = join(dirname(process.argv[1] ?? '.'), 'check-gate')

const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === 'auth') {
  while (!existsSync(SLOW_CHECK_GATE_FILE)) await new Promise((resolve) => setTimeout(resolve, 20))
}
await import('./claude.mjs')
