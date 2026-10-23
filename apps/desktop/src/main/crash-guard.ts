import type { Logger } from './logger'

/** 錯誤的白話描述（給 log 看，含堆疊）。 */
export function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

/**
 * 主行程沒接住的錯誤寫進 log，不讓 Electron 跳出帶程式堆疊的錯誤視窗：
 * 那個視窗使用者看不懂，而且在關 App 時跳出來會擋住結束（E2E 在 xvfb 下就卡在這裡）。
 */
export function installCrashGuards(
  target: {
    on: (
      event: 'uncaughtException' | 'unhandledRejection',
      listener: (error: unknown) => void,
    ) => unknown
  },
  log: Pick<Logger, 'error'>,
): void {
  target.on('uncaughtException', (error) => {
    log.error(`Uncaught error in the main process: ${describeError(error)}`)
  })
  target.on('unhandledRejection', (reason) => {
    log.error(`Unhandled promise rejection in the main process: ${describeError(reason)}`)
  })
}

/** 關 App 時依序收拾；一步失敗（同步丟錯或 Promise 被拒）只寫 log，不擋下一步，也不擋結束。 */
export function runShutdown(
  steps: readonly (readonly [label: string, run: () => unknown])[],
  log: Pick<Logger, 'info' | 'error'>,
): void {
  log.info('Quitting: cleaning up')
  for (const [label, run] of steps) {
    try {
      const result = run()
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          log.error(`Failed to ${label} while quitting: ${describeError(error)}`)
        })
      }
    } catch (error) {
      log.error(`Failed to ${label} while quitting: ${describeError(error)}`)
    }
  }
}
