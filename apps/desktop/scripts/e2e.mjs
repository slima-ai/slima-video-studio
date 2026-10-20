// pnpm test:e2e：建置 → （Linux 無顯示器時，每個 worker 起一個自己的 Xvfb）→ 跑 Playwright。
// SVS_SKIP_BUILD=1 可略過建置（CI 的 build 步驟已經做過時使用）。
import { spawn, spawnSync } from 'node:child_process'

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })

if (process.env.SVS_SKIP_BUILD !== '1') {
  const build = run('pnpm', ['build'])
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const extra = process.argv.slice(2)
// 只跑效能測試（e2e/perf/）時不用先跑完其他測試（perf 專案平常依賴 app 專案，見 playwright.config）
if (extra.some((a) => a.includes('perf/')) && !extra.includes('--no-deps')) extra.push('--no-deps')
const args = ['exec', 'playwright', 'test', ...extra]
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY

/**
 * 起一個 Xvfb，回傳它的顯示器編號（讓 Xvfb 自己挑沒人用的，用 -displayfd 回報）。
 * 每個 worker 要有自己的顯示器：兩個 worker 的視窗放在同一個 Xvfb 時，另一個視窗開、關都會讓這邊的視窗
 * 收到 X 送來的進入／離開事件，Chromium 把它當成滑鼠跳到視窗正中央——正在滑過的說明被收掉、拖到一半的平移少走一段
 * （CI 上 canvas-run、canvas-select 的偶發失敗；同一個 run 裡共用 13/150、5/150 失敗，各用各的 0/150、0/150）。
 */
function startXvfb() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'Xvfb',
      ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] },
    )
    let seen = ''
    child.stdio[3].on('data', (chunk) => {
      seen += String(chunk)
      if (seen.includes('\n')) resolve({ child, display: `:${seen.trim()}` })
    })
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`Xvfb 提早結束（${String(code)}）`)))
  })
}

let result
if (needsXvfb) {
  if (spawnSync('which', ['Xvfb']).status !== 0) {
    console.error('找不到 DISPLAY，也沒有安裝 Xvfb（apt install xvfb）。')
    process.exit(1)
  }
  // 要和 playwright.config.ts 的 workers 一樣多（命令列另外給 --workers 變多時，多出來的 worker 會輪流共用）
  const workers = Number(process.env.SVS_E2E_WORKERS ?? '2')
  const servers = await Promise.all(Array.from({ length: workers }, startXvfb))
  process.on('exit', () => {
    for (const { child } of servers) child.kill()
  })
  result = run('pnpm', args, {
    SVS_HEADLESS: '1',
    SVS_E2E_DISPLAYS: servers.map((server) => server.display).join(','),
  })
} else {
  result = run('pnpm', args)
}
process.exit(result.status ?? 1)
