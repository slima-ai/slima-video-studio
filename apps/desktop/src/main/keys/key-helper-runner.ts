import { spawn } from 'node:child_process'

import {
  HelperCrashedError,
  HelperResponseSchema,
  HelperTimeoutError,
  type HelperRequest,
  type HelperResponse,
  type HelperRunner,
} from './key-crypto'
import { KEY_HELPER_FLAG } from './key-helper-flag'

export interface HelperRunnerOptions {
  /** App 自己的執行檔（打包版是 .app 裡的執行檔，開發時是 electron）。 */
  execPath: string
  /** App 的程式位置（app.getAppPath()）；開發時 electron 要靠它才知道要跑哪個 App。 */
  appPath: string
  /** 等多久（毫秒）；提示沒人按就逾時，主行程照常運作。 */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

const MAX_OUTPUT = 1_000_000

/** 真的啟動小幫手行程。請求只走 stdin，結果只走 stdout；命令列上沒有任何機密。 */
export function createHelperRunner(options: HelperRunnerOptions): HelperRunner {
  const timeoutMs = options.timeoutMs ?? 120_000
  return (request: HelperRequest): Promise<HelperResponse> =>
    new Promise((resolve, reject) => {
      // ELECTRON_RUN_AS_NODE 會讓 Electron 當成純 Node 跑，沒有 safeStorage
      const env = { ...(options.env ?? process.env) }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(options.execPath, [options.appPath, KEY_HELPER_FLAG], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env,
        windowsHide: true,
      })
      let output = ''
      let settled = false
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        action()
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(() => {
          reject(new HelperTimeoutError('金鑰小幫手逾時'))
        })
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > MAX_OUTPUT) child.kill('SIGKILL')
      })
      child.on('error', (error) => {
        finish(() => {
          reject(new HelperCrashedError(`金鑰小幫手啟動失敗：${error.message}`))
        })
      })
      child.on('close', () => {
        finish(() => {
          try {
            resolve(HelperResponseSchema.parse(JSON.parse(output)))
          } catch {
            reject(new HelperCrashedError('金鑰小幫手沒有回傳正確的內容'))
          }
        })
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(JSON.stringify(request))
    })
}
