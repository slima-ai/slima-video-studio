import { AppError, t, type McpConnectInfo } from '@svs/schema'
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

/** POSIX shell 的單引號跳脫：路徑可能有空白（「Slima Video Studio.app」）。 */
export const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

/** Windows（cmd.exe）只認雙引號；內含的雙引號用 \" 跳脫，% 加倍避免被當成環境變數。 */
export const windowsQuote = (text: string): string =>
  `"${text.replace(/"/g, '\\"').replace(/%/g, '%%')}"`

/** `claude mcp add` 的參數（陣列，不經 shell，所以路徑有空白、引號都不會被拆開）。 */
export function claudeAddArgs(bridge: BridgeCommand): string[] {
  return [
    'mcp',
    'add',
    '--scope',
    'user',
    // 名字一定要放在 -e 前面：-e 會吃掉後面所有參數（實測：放後面會報 Invalid environment variable format）
    SERVER_NAME,
    ...Object.entries(bridge.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '--',
    bridge.command,
    ...bridge.args,
  ]
}

export const claudeRemoveArgs = (): string[] => ['mcp', 'remove', '--scope', 'user', SERVER_NAME]

/** 給人貼進終端機的 Claude Code 指令（走轉接，token 與埠改了都不用重貼）；依平台用對的引號。 */
export function claudeCodeBridgeCommand(bridge: BridgeCommand, platform: NodeJS.Platform): string {
  const quote = platform === 'win32' ? windowsQuote : shellQuote
  const args = claudeAddArgs(bridge)
  // 只有「--」後面的路徑與參數可能有空白；前面都是固定字
  const dashes = args.indexOf('--')
  return ['claude', ...args.slice(0, dashes + 1), ...args.slice(dashes + 1).map(quote)].join(' ')
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
    userMessage: t('mcp.claudeDesktopConfigInvalid'),
  })
}

/** Claude Code 的使用者層級設定（`claude mcp add --scope user` 寫在這裡）；讀不到或格式不對都當作沒連。 */
function claudeCodeHasEntry(file: string, bridge: BridgeCommand): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return false
    const servers = (parsed as { mcpServers?: unknown }).mcpServers
    if (typeof servers !== 'object' || servers === null) return false
    return sameEntry((servers as Record<string, unknown>)[SERVER_NAME], bridge)
  } catch {
    return false
  }
}

export interface ConnectorDeps {
  platform: NodeJS.Platform
  home: string
  appData: string | undefined
  bridge: BridgeCommand
  /** 找出 claude 執行檔的完整路徑（用使用者的登入環境，PATH 才跟終端機一樣）；找不到回 undefined。 */
  findClaude: () => Promise<string | undefined>
  /** 直接執行一個檔案、參數用陣列傳（不經 shell）；失敗就丟錯。 */
  runFile: (file: string, args: string[]) => Promise<void>
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
  const claudeJson = join(deps.home, '.claude.json')
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
        claudeCode: {
          installed: existsSync(claudeJson) || existsSync(join(deps.home, '.claude')),
          connected: claudeCodeHasEntry(claudeJson, deps.bridge),
        },
        desktopSnippet: desktopSnippet(deps.bridge),
        claudeCodeCommand: claudeCodeBridgeCommand(deps.bridge, deps.platform),
      }
    },
    connectClaudeDesktop: () => {
      if (configPath === undefined) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('mcp.noClaudeDesktopHere'),
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
      const command = claudeCodeBridgeCommand(deps.bridge, deps.platform)
      const fail = (): never => {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('mcp.cantRunClaudeCommand'),
        })
      }
      const claude = await deps.findClaude().catch(() => undefined)
      if (claude === undefined) return fail()
      // 先移掉舊的同名設定（重新連接時不會因為「已存在」失敗）；沒有舊的就會失敗，忽略
      await deps.runFile(claude, claudeRemoveArgs()).catch(() => undefined)
      try {
        await deps.runFile(claude, claudeAddArgs(deps.bridge))
      } catch {
        return fail()
      }
      return { command }
    },
  }
}

const firstLine = (text: string): string | undefined =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '')

/** 用登入 shell 找 claude（Windows 用 where；.exe 優先）；只跑一個固定指令，沒有任何外來字串。 */
export function findClaudeInLoginShell(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const done = (error: Error | null, stdout: string): void => {
      if (error) {
        resolve(undefined)
        return
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '')
      resolve(lines.find((l) => /\.exe$/i.test(l)) ?? firstLine(stdout))
    }
    if (process.platform === 'win32') {
      execFile('where', ['claude'], { timeout: 10_000, windowsHide: true }, (e, out) => {
        done(e, out)
      })
    } else {
      const shell = process.env.SHELL ?? '/bin/zsh'
      execFile(shell, ['-lc', 'command -v claude'], { timeout: 10_000 }, (e, out) => {
        done(e, out)
      })
    }
  })
}

/** 直接執行（參數用陣列，不經 shell）。Windows 的 .cmd／.bat 一定要經 cmd.exe，這時參數自己加雙引號。 */
export function runFileDirect(file: string, args: string[]): Promise<void> {
  const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
  const [exe, exeArgs, options] = viaCmd
    ? ([
        'cmd.exe',
        ['/d', '/s', '/c', `"${[file, ...args].map(windowsQuote).join(' ')}"`],
        { windowsVerbatimArguments: true },
      ] as const)
    : ([file, args, {}] as const)
  return new Promise((resolve, reject) => {
    execFile(exe, [...exeArgs], { timeout: 30_000, windowsHide: true, ...options }, (error) => {
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}
