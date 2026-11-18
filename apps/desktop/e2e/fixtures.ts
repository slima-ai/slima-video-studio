import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { saveHangEvidence } from './hang-evidence'
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

/** 超過這麼久還沒退出就先存證據（不強制結束、照常等它退）：機器不忙時偏慢的那幾次也有東西可看。 */
const SLOW_CLOSE_MS = 5_000

export interface CloseAppOptions {
  /** 測試用：縮短等待時間 */
  timeoutMs?: number
  /** 測試用：縮短「偏慢」的門檻 */
  slowMs?: number
  /** 證據資料夾；沒給就看環境變數 SVS_E2E_EVIDENCE_DIR（每次逾時各一個子資料夾，不被重跑蓋掉），再沒有就放在這個測試的輸出資料夾 */
  evidenceDir?: string
}

/** 設了 SVS_E2E_CLOSE_LOG 就把每次關 App 花的毫秒數記一行（量「平常多久退出」用）。 */
function logCloseDuration(testInfo: TestInfo, ms: number, status: 'ok' | 'slow' | 'TIMEOUT') {
  const file = process.env.SVS_E2E_CLOSE_LOG
  if (!file) return
  try {
    appendFileSync(
      file,
      `${new Date().toISOString()}\t${String(ms)}ms\t${status}\t${testInfo.title}\n`,
    )
  } catch {
    // 記不了就算了，不影響測試
  }
}

function evidenceDirFor(testInfo: TestInfo, options: CloseAppOptions): string {
  if (options.evidenceDir) return options.evidenceDir
  const root = process.env.SVS_E2E_EVIDENCE_DIR
  if (!root) return testInfo.outputPath('close-hang')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = testInfo.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)
  return join(root, `${stamp}-${slug}`)
}

/**
 * 關 App。偏慢（超過 5 秒）時先把證據存成檔（完整主行程 log、行程樹、開著的檔案與 port；不取 sample，
 * 它會干擾退出中的行程），不強制結束、照常等它退出；卡住（超過 20 秒，以前曾在全套並行時發生）則再存一份
 * （這次加上 macOS 的呼叫堆疊 sample）、強制結束行程，
 * 並讓這個測試失敗（不吞掉問題），不讓整個 worker 等到逾時、連帶下一個測試沒跑。
 */
export async function closeApp(
  app: ElectronApplication,
  userDataDir: string,
  testInfo: TestInfo,
  options: CloseAppOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? CLOSE_TIMEOUT_MS
  // SVS_E2E_SLOW_MS：只用來量「取證據讓退出慢多少」，平常不設
  const slowMs = options.slowMs ?? Number(process.env.SVS_E2E_SLOW_MS ?? SLOW_CLOSE_MS)
  const dir = evidenceDirFor(testInfo, options)
  const pid = app.process().pid
  const attachAll = async (prefix: string, files: string[]) => {
    for (const path of files) {
      await testInfo
        .attach(`${prefix}-${basename(path)}`, { path, contentType: 'text/plain' })
        .catch(() => undefined)
    }
  }

  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout')
    }, timeoutMs)
  })
  let slowEvidence: Promise<string[]> | undefined
  const slowTimer = setTimeout(() => {
    // 偏慢時不取 sample：它會干擾還在退出的行程
    slowEvidence = saveHangEvidence({ dir: join(dir, 'slow'), pid, userDataDir, sample: false })
  }, slowMs)

  const startedAt = Date.now()
  const result = await Promise.race([app.close().catch(() => 'closed' as const), timedOut])
  clearTimeout(timer)
  clearTimeout(slowTimer)
  const slowFiles = slowEvidence ? await slowEvidence : []
  await attachAll('close-slow', slowFiles)
  const status = result === 'timeout' ? 'TIMEOUT' : slowEvidence ? 'slow' : 'ok'
  logCloseDuration(testInfo, Date.now() - startedAt, status)
  if (result !== 'timeout') return

  // 逾時才取呼叫堆疊（行程反正要被結束）；兩次的檔案放不同資料夾（slow／timeout）
  await attachAll(
    'close-hang',
    await saveHangEvidence({ dir: join(dir, 'timeout'), pid, userDataDir }),
  )
  app.process().kill('SIGKILL')
  throw new Error(
    `App ${String(timeoutMs / 1000)} 秒內關不掉（主行程 log、行程樹、lsof、sample 存在 ${join(dir, 'timeout')}）`,
  )
}

export { expect }
