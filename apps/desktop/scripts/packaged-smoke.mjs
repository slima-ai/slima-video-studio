/* global window */
// 打包版冒煙：用 electron-builder 打出來的 App（不是開發版），走一次第一次使用的「先試玩看看」（示範模式）
// → 畫布寫一句話長出短片 → 接成成品。會用到打包版裡的 better-sqlite3（asar 外的 .node）、
// 內建 FFmpeg（asar 外的執行檔）、示範圖（畫面視窗的 canvas）。打包版不吃測試用的環境變數，
// 所以用暫存的 HOME 與 XDG_CONFIG_HOME，不碰這台電腦原本的設定與「文件」。
// 用法（Linux）：
//   pnpm --filter @svs/desktop dist:dir
//   xvfb-run -a -s "-screen 0 1440x900x24" node scripts/packaged-smoke.mjs [App 執行檔] [截圖資料夾]
// 預設執行檔：release/linux-unpacked/slima-video-studio
import { _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 打包版一定用作業系統的鑰匙圈。macOS 的鑰匙圈會跳密碼視窗、授權又綁執行檔，反覆跑會一直打擾使用者，
// 所以 macOS 上預設不准跑（這支是給 Linux CI 用的）；真的要在 Mac 上驗，要明確同意。
if (process.platform === 'darwin' && process.env.SVS_ALLOW_REAL_KEYCHAIN !== '1') {
  throw new Error(
    '打包版冒煙會用到真的 macOS 鑰匙圈（會跳密碼視窗）。要在 Mac 上跑請明確設 SVS_ALLOW_REAL_KEYCHAIN=1。',
  )
}

const here = dirname(fileURLToPath(import.meta.url))
const executablePath = process.argv[2] ?? join(here, '../release/linux-unpacked/slima-video-studio')
const shotsDir = process.argv[3]
if (!existsSync(executablePath)) {
  throw new Error(
    `找不到打包好的 App：${executablePath}（先跑 pnpm --filter @svs/desktop dist:dir）`,
  )
}
const home = mkdtempSync(join(tmpdir(), 'svs-packaged-'))
const config = join(home, '.config')
mkdirSync(config, { recursive: true })

const say = (line) => {
  process.stdout.write(`${line}\n`)
}
const started = Date.now()
const step = (label) => {
  say(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s ${label}`)
}

const app = await electron.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--password-store=basic'],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config },
})
// 跑到最後才知道結果；中途丟錯就直接失敗結束
let ok
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const packaged = await app.evaluate(({ app: electronApp }) => ({
    packaged: electronApp.isPackaged,
    userData: electronApp.getPath('userData'),
    version: electronApp.getVersion(),
  }))
  step(`打開了：版本 ${packaged.version}，打包版=${String(packaged.packaged)}`)
  if (!packaged.packaged) throw new Error('這不是打包版')

  // 第一次使用：先試玩看看（示範模式）
  await page.getByTestId('wizard-demo').click()
  await page.getByTestId('app-layout').waitFor()
  step('第一次使用的引導：選了先試玩看看')

  // 畫布：一句話長出 3 鏡短片（每鏡 3 秒）
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await page.getByTestId('empty-add-oneliner').click()
  await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
  await page.getByTestId('oneliner-story').blur()
  await page.getByTestId('oneliner-generate').click()
  await page.getByTestId('run-confirm-ok').click()
  await page.waitForSelector('[data-testid="canvas-root"][data-growing="true"]')
  step('開始生成')
  await page.waitForSelector('[data-testid="canvas-root"][data-growing="false"]', {
    timeout: 180_000,
  })
  await page.getByTestId('toast').filter({ hasText: '短片生成好了' }).waitFor({ timeout: 30_000 })
  step('短片生成好了（SQLite 讀寫、示範圖、FFmpeg 接片都在打包版裡跑過）')

  // 成品真的接出來了：專案資料夾裡有成品檔
  const project = await page.evaluate(() => window.svs.invoke('project.current', {}))
  if (!project.ok || !project.data) throw new Error('沒有開著的專案')
  // 素材用內容雜湊命名，放在雜湊前兩碼的子資料夾
  const assets = readdirSync(join(project.data.dir, 'assets'), { recursive: true }).filter((name) =>
    /\.[a-z0-9]+$/.test(String(name)),
  )
  const videos = assets.filter((name) => String(name).endsWith('.mp4'))
  step(
    `專案 ${project.data.name}：素材 ${String(assets.length)} 個，其中影片 ${String(videos.length)} 個`,
  )
  if (videos.length === 0) throw new Error('專案裡沒有影片檔')

  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true })
    await page.screenshot({ path: join(shotsDir, 'packaged-canvas.png') })
  }
  const log = readFileSync(join(packaged.userData, 'logs', 'main.log'), 'utf8')
  const errors = log.split('\n').filter((line) => line.includes('[error]'))
  step(`主行程 log：${String(errors.length)} 行錯誤`)
  for (const line of errors) say(`    ${line}`)
  ok = errors.length === 0
} finally {
  await app.close().catch(() => undefined)
}
step(ok ? '打包版冒煙通過' : '打包版冒煙沒通過')
if (!ok) process.exitCode = 1
