import { AppError, type McpConnectInfo } from '@svs/schema'
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/** 寫進 AI 工具設定裡的名字。 */
export const SERVER_NAME = 'slima-video-studio'

/** 啟動轉接的方式：用 App 自己的 Electron 當 Node 跑 stdio 轉接檔，不需要裝任何東西。 */
export interface BridgeCommand {
  command: string
  args: string[]
  env: Record<string, string>
}

export function bridgeCommand(
  execPath: string,
  scriptPath: string,
  userDataDir: string,
): BridgeCommand {
  return {
    command: execPath,
    args: [scriptPath, '--user-data', userDataDir],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/** Claude Desktop 的設定檔位置；這個作業系統沒有 Claude Desktop 就回 undefined。 */
export function desktopConfigPath(
  platform: NodeJS.Platform,
  home: string,
  appData: string | undefined,
): string | undefined {
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (platform === 'win32' && appData) return join(appData, 'Claude', 'claude_desktop_config.json')
  return undefined
}

/** 給人看／複製的設定片段（貼進 Claude Desktop 設定檔的 mcpServers 裡）。 */
export function desktopSnippet(bridge: BridgeCommand): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: bridge } }, null, 2)
}

/** shell 的單引號跳脫：路徑可能有空白（「Slima Video Studio.app」）。 */
export const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

/** 給人貼進終端機的 Claude Code 指令（走轉接，token 與埠改了都不用重貼）。 */
export function claudeCodeBridgeCommand(bridge: BridgeCommand): string {
  const env = Object.entries(bridge.env).map(([k, v]) => `-e ${k}=${v}`)
  return [
    'claude mcp add --scope user',
    ...env,
    SERVER_NAME,
    '--',
    shellQuote(bridge.command),
    ...bridge.args.map(shellQuote),
  ].join(' ')
}

interface DesktopConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

const sameEntry = (entry: unknown, bridge: BridgeCommand): boolean => {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Partial<BridgeCommand>
  return e.command === bridge.command && JSON.stringify(e.args) === JSON.stringify(bridge.args)
}

function readDesktopConfig(file: string): DesktopConfig {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8')
  if (text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return parsed as DesktopConfig
  } catch {
    // 落到下面的白話錯誤
  }
  throw new AppError({
    code: 'invalid_request',
    userMessage:
      'Claude Desktop 的設定檔現在不是正確的 JSON，我沒有動它。請先修好它，或手動貼上設定片段。',
  })
}

export interface ConnectorDeps {
  platform: NodeJS.Platform
  home: string
  appData: string | undefined
  bridge: BridgeCommand
  /** 在登入 shell 裡執行一行指令（找得到使用者 PATH 裡的 claude）；失敗就丟錯。 */
  runShell: (commandLine: string) => Promise<void>
  now?: () => Date
}

export interface McpConnector {
  info: () => McpConnectInfo
  connectClaudeDesktop: () => { configPath: string; backupPath?: string }
  connectClaudeCode: () => Promise<{ command: string }>
}

export function createConnector(deps: ConnectorDeps): McpConnector {
  const configPath = desktopConfigPath(deps.platform, deps.home, deps.appData)
  const now = deps.now ?? (() => new Date())
  return {
    info: () => {
      const connected =
        configPath !== undefined &&
        (() => {
          try {
            return sameEntry(readDesktopConfig(configPath).mcpServers?.[SERVER_NAME], deps.bridge)
          } catch {
            return false
          }
        })()
      return {
        claudeDesktop: {
          supported: configPath !== undefined,
          ...(configPath === undefined ? {} : { configPath }),
          // 資料夾在，代表裝過 Claude Desktop
          installed: configPath !== undefined && existsSync(dirname(configPath)),
          connected,
        },
        desktopSnippet: desktopSnippet(deps.bridge),
        claudeCodeCommand: claudeCodeBridgeCommand(deps.bridge),
      }
    },
    connectClaudeDesktop: () => {
      if (configPath === undefined) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: '這個系統沒有 Claude Desktop。請改用 Claude Code 的指令。',
        })
      }
      const config = readDesktopConfig(configPath)
      let backupPath: string | undefined
      if (existsSync(configPath)) {
        // 只動我們自己的那一項，其他伺服器原樣保留；改之前先留一份備份
        const stamp = now().toISOString().replace(/[:.]/g, '-')
        backupPath = `${configPath}.svs-backup-${stamp}`
        copyFileSync(configPath, backupPath)
      } else {
        mkdirSync(dirname(configPath), { recursive: true })
      }
      const next: DesktopConfig = {
        ...config,
        mcpServers: { ...config.mcpServers, [SERVER_NAME]: deps.bridge },
      }
      const tmp = `${configPath}.svs-tmp`
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      renameSync(tmp, configPath)
      return { configPath, ...(backupPath === undefined ? {} : { backupPath }) }
    },
    connectClaudeCode: async () => {
      const command = claudeCodeBridgeCommand(deps.bridge)
      try {
        // 先移掉舊的同名設定（重新連接時不會因為「已存在」失敗）；沒有舊的就會失敗，忽略
        await deps.runShell(`claude mcp remove --scope user ${SERVER_NAME}`).catch(() => undefined)
        await deps.runShell(command)
      } catch {
        throw new AppError({
          code: 'invalid_request',
          userMessage:
            '沒辦法自己執行 claude 指令（可能還沒安裝 Claude Code，或找不到它）。請把下面的指令貼到終端機。',
        })
      }
      return { command }
    },
  }
}

/** 真的執行：登入 shell（讓 PATH 跟使用者的終端機一樣），最多等 30 秒。 */
export function runInLoginShell(commandLine: string): Promise<void> {
  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/zsh')
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', commandLine] : ['-lc', commandLine]
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout: 30_000, windowsHide: true }, (error) => {
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}
