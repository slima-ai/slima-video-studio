import { t, type McpStatus } from '@svs/schema'
import { join } from 'node:path'

import type { Logger } from '../logger'
import type { HandlerContext, IpcRegistry } from '../ipc/registry'
import type { KeyVault } from '../keys/key-vault'
import type { MediaTools } from '@svs/media'

import type { ProjectManager } from '../project-manager'
import type { Broadcast } from '../runtime/project-runtime'
import type { SettingsStore } from '../settings/settings-store'
import { createCanvasMarker, withAiChangeNotice } from './ai-changes'
import { createAllowance, type Allowance } from './allowance'
import { createAssetViewer } from './viewer'
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
  /** 目前開著的專案（看圖要用它的素材庫）。 */
  projects: Pick<ProjectManager, 'current' | 'status'>
  /** 內建的 FFmpeg（給 AI 看的縮圖與影片抽格）。 */
  tools: () => MediaTools | undefined
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
    // 實際花費要看專案帳本，所以這裡只在主行程讀；路徑與金額不會經過任何 MCP 通道
    spend: () => {
      const project = deps.projects.status()
      return project ? { dir: project.dir, spentUsd: project.spentUsd } : undefined
    },
  })
  const emit: HandlerContext['emit'] = (event, payload) => {
    deps.broadcast(event, payload)
  }
  // 走 MCP 進來的呼叫都是 AI 工具做的：改了畫布就通知畫面（亮一下、標「AI 剛改」、刪了什麼）
  const caller = withAiChangeNotice(createMcpCaller(deps.registry, emit), {
    marks: createCanvasMarker(deps.registry),
    emit,
  })
  const redactor = createRedactor(() => [
    tokens.get(),
    // 只看記憶體裡已經有的金鑰，絕不為了過濾回傳內容去碰鑰匙圈
    ...deps.keys.knownSecrets(),
  ])

  const viewer = createAssetViewer({ projects: deps.projects, tools: deps.tools })
  let http: McpHttp | undefined
  let runningPort: number | undefined
  let error: string | undefined
  let lastSeen: { at: string; client?: string } | undefined

  const stop = async (): Promise<void> => {
    const current = http
    http = undefined
    runningPort = undefined
    await current?.stop()
  }

  const status = (): McpStatus => {
    const { enabled, port } = settings.get().mcp
    const { allowanceUsd, committedUsd } = allowance.status()
    const spentUsd = deps.projects.status()?.spentUsd
    return {
      enabled,
      running: runningPort !== undefined,
      port: runningPort ?? port,
      ...(runningPort === undefined
        ? {}
        : { url: `http://127.0.0.1:${String(runningPort)}/mcp`, token: tokens.get() }),
      ...(error === undefined ? {} : { error }),
      ...(lastSeen === undefined ? {} : { lastSeen }),
      allowanceUsd,
      committedUsd,
      ...(spentUsd === undefined ? {} : { spentUsd }),
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
      // 伺服器一開就把 token 檔建好：stdio 轉接是直接讀這個檔，不能等到有人看過設定頁才有
      tokens.get()
      const next = createMcpHttp({
        port,
        token: tokens.get,
        log,
        redactor,
        // AI 工具是無狀態地一個請求一個請求來的：「最近有人連進來」就看最後一個請求；名字只有 initialize 才有，沒帶就沿用上一個
        onRequest: ({ client }) => {
          const name = client ?? lastSeen?.client
          lastSeen = {
            at: new Date().toISOString(),
            ...(name === undefined ? {} : { client: name }),
          }
        },
        createMcpServer: () =>
          createMcpServer({ caller, settings, allowance, redactor, viewer, info: deps.info }),
      })
      try {
        const bound = await next.start()
        http = next
        runningPort = bound.port
        error = undefined
      } catch (e) {
        const inUse = e instanceof Error && 'code' in e && e.code === 'EADDRINUSE'
        error = inUse ? t('mcp.portInUse', { port: String(port) }) : t('mcp.cantStartConnection')
        log.error(`Failed to start the MCP server: ${e instanceof Error ? e.message : String(e)}`)
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
