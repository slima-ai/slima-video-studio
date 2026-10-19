import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launchApp } from './launch'

interface Fixtures {
  /** 已啟動的 Electron App（每個測試獨立的 userData 與專案資料夾） */
  app: ElectronApplication
  /** 主視窗 */
  page: Page
  /** 這個測試專用的 userData 資料夾 */
  userDataDir: string
  /** 這個測試專用的暫存專案資料夾 */
  projectDir: string
  /** 讀取主行程 log */
  readMainLog: () => string
  /** 這個檔案 / describe 的 App 額外環境變數（`test.use({ appEnv: {...} })`） */
  appEnv: Record<string, string>
}

export const test = base.extend<Fixtures>({
  appEnv: [{}, { option: true }],

  // Playwright fixture 一定要用解構參數，所以空的解構是必要的
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'svs-e2e-userdata-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

  // eslint-disable-next-line no-empty-pattern
  projectDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'svs-e2e-project-'))
    mkdirSync(join(dir, 'assets'), { recursive: true })
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

  app: async ({ userDataDir, appEnv }, use, testInfo) => {
    const { app } = await launchApp({ userDataDir, env: appEnv })
    await use(app)
    await closeApp(app, userDataDir, testInfo)
  },

  page: async ({ app }, use, testInfo) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
    // 每個測試結束時自動截圖（CI 會上傳成 artifact）
    if (!page.isClosed()) {
      const path = testInfo.outputPath('final.png')
      await page.screenshot({ path }).catch(() => undefined)
      await testInfo
        .attach('final-screenshot', { path, contentType: 'image/png' })
        .catch(() => undefined)
    }
  },

  readMainLog: async ({ userDataDir }, use) => {
    await use(() => {
      try {
        return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
      } catch {
        return ''
      }
    })
  },
})

/** 關 App 最多等這麼久；超過就是主行程卡住了。 */
const CLOSE_TIMEOUT_MS = 20_000

/**
 * 關 App。卡住時（以前曾在全套並行時發生）不讓整個 worker 等到逾時、連帶下一個測試沒跑：
 * 把主行程 log 附在報告上、強制結束行程，並讓這個測試失敗（不吞掉問題）。
 */
export async function closeApp(app: ElectronApplication, userDataDir: string, testInfo: TestInfo) {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout')
    }, CLOSE_TIMEOUT_MS)
  })
  const result = await Promise.race([app.close().catch(() => 'closed' as const), timedOut])
  clearTimeout(timer)
  if (result !== 'timeout') return
  let log = ''
  try {
    log = readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
  } catch {
    // 沒有 log 就只附說明
  }
  await testInfo
    .attach('main-log-when-close-hung', {
      body: log || '（沒有主行程 log）',
      contentType: 'text/plain',
    })
    .catch(() => undefined)
  app.process().kill('SIGKILL')
  throw new Error(
    `App ${String(CLOSE_TIMEOUT_MS / 1000)} 秒內關不掉（主行程 log 附在報告的 main-log-when-close-hung）`,
  )
}

export { expect }
