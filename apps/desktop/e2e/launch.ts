import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Electron 執行檔路徑（`require('electron')` 在 Node 下回傳的是路徑字串）。 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node 下 electron 套件的匯出就是執行檔路徑字串，沒有型別化的 ESM 寫法
const electronPath = require('electron') as string

const APP_ROOT = join(__dirname, '..')
const FAKE_SLIMA_SERVER = join(__dirname, '../../../packages/test-utils/src/fake-slima-server.mjs')

/** 容器 / CI 沒有 user namespace 與 GPU，需要這些旗標才啟動得了。 */
export function isHeadless(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === '1' || env.CI === 'true' || env.SVS_HEADLESS === '1'
}

export function ciArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return isHeadless(env)
    ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--password-store=basic']
    : []
}

/**
 * 這個 worker 專用的顯示器（`pnpm test:e2e` 在 Linux 沒有 DISPLAY 時，每個 worker 起一個自己的 Xvfb，
 * 編號放在 SVS_E2E_DISPLAYS；原因見 scripts/e2e.mjs）。沒設就用環境原本的 DISPLAY。
 */
export function workerDisplay(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const displays = (env.SVS_E2E_DISPLAYS ?? '').split(',').filter((item) => item !== '')
  if (displays.length === 0) return undefined
  return displays[Number(env.TEST_PARALLEL_INDEX ?? '0') % displays.length]
}

export interface LaunchOptions {
  /** 測試專用 userData；沒給就建暫存資料夾 */
  userDataDir?: string
  /** 額外環境變數（會覆蓋預設值） */
  env?: Record<string, string>
  /** 放在 App 路徑前面的 Electron 參數（例如 `--require <檔>`：在主行程一開始就先載入一支腳本）。 */
  electronArgs?: string[]
}

export interface LaunchedApp {
  app: ElectronApplication
  userDataDir: string
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'svs-e2e-userdata-'))
  const display = workerDisplay()
  const app = await electron.launch({
    executablePath: electronPath,
    args: [...(options.electronArgs ?? []), APP_ROOT, ...ciArgs()],
    env: {
      ...(process.env as Record<string, string>),
      SVS_PROVIDER_MODE: 'mock',
      SVS_USER_DATA: userDataDir,
      SVS_DISABLE_ONBOARDING: '1',
      // 介面語言固定繁體中文：預設是「跟著作業系統」，CI（Linux）的系統語言多半是英文，不固定的話整套 e2e 會一起變英文。
      // 要拍英文截圖或測英文介面，在執行時設 SVS_LOCALE=en（或 test.use({ appEnv: { SVS_LOCALE: 'en' } })）。
      SVS_LOCALE: process.env.SVS_LOCALE ?? 'zh-TW',
      // 開 App 沒有專案可以接時，正式使用會先到「首頁」；測試預設跳過它，一開 App 就是空畫布
      // （不必每支 e2e 都先點過首頁）。只有非打包版才吃這個變數，打包版就算設了也無效。
      // 要測首頁的測試用 `test.use({ appEnv: { SVS_DISABLE_HOME: '' } })` 關掉它。
      SVS_DISABLE_HOME: '1',
      // 自動建立的專案放在測試專用的資料夾，不碰使用者的「文件」
      SVS_PROJECTS_DIR: join(userDataDir, 'projects'),
      // Slima 一律連假的 slima-mcp 伺服器，CI 不連正式環境
      SVS_SLIMA_SERVER: FAKE_SLIMA_SERVER,
      // 視窗不跳到桌面上、不搶焦點（要看視窗除錯時：SVS_E2E_VISIBLE=1 pnpm test:e2e …）。
      // CI（xvfb）沒有使用者的桌面可以打擾，而且開了之後整套 E2E 慢了一倍以上、撐到逾時，所以 CI 不開；
      // 要驗安靜模式本身的測試（window-mode）自己用 test.use({ appEnv }) 開。
      SVS_QUIET_WINDOWS: process.env.SVS_E2E_VISIBLE === '1' || isHeadless() ? '' : '1',
      ...(display === undefined ? {} : { DISPLAY: display }),
      ...options.env,
      // E2E 絕不碰作業系統的鑰匙圈：放在最後，測試的 appEnv 想改也改不掉
      SVS_REAL_VAULT: '',
      SVS_TEST_VAULT: 'memory',
    },
  })
  return { app, userDataDir }
}
