// pnpm test:e2e：建置 → （Linux 無顯示器時用 xvfb-run 包起來）→ 跑 Playwright。
// SVS_SKIP_BUILD=1 可略過建置（CI 的 build 步驟已經做過時使用）。
import { spawnSync } from 'node:child_process'

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

let result
if (needsXvfb) {
  const hasXvfb = spawnSync('which', ['xvfb-run']).status === 0
  if (!hasXvfb) {
    console.error('找不到 DISPLAY，也沒有安裝 xvfb-run（apt install xvfb）。')
    process.exit(1)
  }
  result = run('xvfb-run', ['-a', '--server-args=-screen 0 1920x1080x24', 'pnpm', ...args], {
    SVS_HEADLESS: '1',
  })
} else {
  result = run('pnpm', args)
}
process.exit(result.status ?? 1)
