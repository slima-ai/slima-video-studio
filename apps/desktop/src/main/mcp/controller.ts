import { type McpStatus } from '@svs/schema'
import { join } from 'node:path'

import type { Logger } from '../logger'
import type { IpcRegistry } from '../ipc/registry'
import type { KeyVault } from '../keys/key-vault'
import type { Broadcast } from '../runtime/project-runtime'
import type { SettingsStore } from '../settings/settings-store'
import { createAllowance, type Allowance } from './allowance'
import { createMcpCaller } from './bridge'
import { createMcpServer } from './create-server'
import { createRedactor } from './redact'
import { createMcpHttp, type McpHttp } from './server'
import { createTokenStore } from './token'

export interface McpController {
  /** 依目前設定（開／關、埠）啟動或停止伺服器；設定改了就呼叫一次。 */
  sync: () => Promise<void>
  status: () => McpStatus
  regenerateToken: () => McpStatus
  resetCommitted: () => McpStatus
  allowance: Allowance
  stop: () => Promise<void>
}

export interface McpControllerDeps {
  registry: IpcRegistry
  settings: SettingsStore
  keys: KeyVault
  /** 通知 App 的視窗（AI 工具改了東西，畫面要跟著更新）。 */
  broadcast: Broadcast
  /** 使用者資料夾：放 token 與「已預留」金額的檔案。 */
  userDataDir: string
  info: { name: string; version: string }
  log: Logger
}

export function createMcpController(deps: McpControllerDeps): McpController {
  const { settings, log } = deps
  const tokens = createTokenStore(join(deps.userDataDir, 'mcp-token'))
  const allowance = createAllowance({
    file: join(deps.userDataDir, 'mcp-committed.json'),
    allowanceUsd: () => settings.get().mcp.allowanceUsd,
    demoMode: () => settings.get().demoMode,
  })
  const caller = createMcpCaller(deps.registry, (event, payload) => {
    deps.broadcast(event, payload)
  })
  const redactor = createRedactor(() => [
    tokens.get(),
    ...deps.keys.providers().map((provider) => deps.keys.get(provider)),
  ])

  let http: McpHttp | undefined
  let runningPort: number | undefined
  let error: string | undefined

  const stop = async (): Promise<void> => {
    const current = http
    http = undefined
    runningPort = undefined
    await current?.stop()
  }

  const status = (): McpStatus => {
    const { enabled, port } = settings.get().mcp
    const { allowanceUsd, committedUsd } = allowance.status()
    return {
      enabled,
      running: runningPort !== undefined,
      port: runningPort ?? port,
      ...(runningPort === undefined
        ? {}
        : { url: `http://127.0.0.1:${String(runningPort)}/mcp`, token: tokens.get() }),
      ...(error === undefined ? {} : { error }),
      allowanceUsd,
      committedUsd,
    }
  }

  return {
    allowance,
    status,
    sync: async () => {
      const { enabled, port } = settings.get().mcp
      if (!enabled) {
        error = undefined
        await stop()
        return
      }
      if (http && runningPort === port) return
      await stop()
      const next = createMcpHttp({
        port,
        token: tokens.get,
        log,
        redactor,
        createMcpServer: () =>
          createMcpServer({ caller, settings, allowance, redactor, info: deps.info }),
      })
      try {
        const bound = await next.start()
        http = next
        runningPort = bound.port
        error = undefined
      } catch (e) {
        const inUse = e instanceof Error && 'code' in e && e.code === 'EADDRINUSE'
        error = inUse
          ? `埠 ${String(port)} 已經被別的程式用了，請換一個埠。`
          : '無法啟動 AI 工具連線，請看 App 的 log。'
        log.error(`MCP 伺服器啟動失敗：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    regenerateToken: () => {
      tokens.regenerate()
      return status()
    },
    resetCommitted: () => {
      allowance.reset()
      return status()
    },
    stop,
  }
}
