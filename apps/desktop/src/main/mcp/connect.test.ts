import { AppError } from '@svs/schema'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bridgeCommand,
  claudeAddArgs,
  claudeCodeBridgeCommand,
  createConnector,
  desktopConfigPath,
  desktopSnippet,
  shellQuote,
  windowsQuote,
} from './connect'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-connect-'))
  dirs.push(d)
  return d
}

const BRIDGE = bridgeCommand(
  '/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio',
  '/Applications/Slima Video Studio.app/Contents/Resources/app.asar/out/main/mcp-stdio-bridge.js',
  "/Users/x/Library/Application Support/it's",
)

describe('設定檔位置與轉接指令', () => {
  it('macOS／Windows 有位置；Linux 沒有 Claude Desktop', () => {
    expect(desktopConfigPath('darwin', '/Users/x', undefined)).toBe(
      '/Users/x/Library/Application Support/Claude/claude_desktop_config.json',
    )
    expect(desktopConfigPath('win32', 'C:\\Users\\x', 'C:\\Users\\x\\AppData\\Roaming')).toContain(
      'claude_desktop_config.json',
    )
    expect(desktopConfigPath('win32', 'C:\\Users\\x', undefined)).toBeUndefined()
    expect(desktopConfigPath('linux', '/home/x', undefined)).toBeUndefined()
  })

  it('用 App 自己的 Electron 當 Node 跑；設定片段不含 token', () => {
    expect(BRIDGE.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    const snippet = JSON.parse(desktopSnippet(BRIDGE)) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }
    expect(snippet.mcpServers['slima-video-studio']?.args[1]).toBe('--user-data')
    expect(desktopSnippet(BRIDGE)).not.toMatch(/svs_|Bearer/)
  })

  it('給人貼的 Claude Code 指令：macOS 用單引號、Windows 用雙引號，路徑有空白都包好', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(windowsQuote('C:\\Program Files\\Slima "x" 100%')).toBe(
      '"C:\\Program Files\\Slima \\"x\\" 100%%"',
    )
    const mac = claudeCodeBridgeCommand(BRIDGE, 'darwin')
    expect(
      mac.startsWith(
        'claude mcp add --scope user slima-video-studio -e ELECTRON_RUN_AS_NODE=1 -- ',
      ),
    ).toBe(true)
    expect(mac).toContain(
      `'/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio'`,
    )
    expect(mac).toContain(`'/Users/x/Library/Application Support/it'\\''s'`)
    const win = bridgeCommand(
      'C:\\Program Files\\Slima Video Studio\\Slima Video Studio.exe',
      'C:\\Program Files\\Slima Video Studio\\resources\\app.asar\\out\\main\\mcp-stdio-bridge.js',
      'C:\\Users\\x\\AppData\\Roaming\\Slima Video Studio',
    )
    const winCommand = claudeCodeBridgeCommand(win, 'win32')
    expect(winCommand).toContain('"C:\\Program Files\\Slima Video Studio\\Slima Video Studio.exe"')
    expect(winCommand).not.toContain("'")
  })

  it('claude mcp add 的參數是陣列：有空白、有單引號的路徑各是一個元素，不會被拆開', () => {
    const args = claudeAddArgs(BRIDGE)
    // 名字要在 -e 前面（-e 會吃掉後面的參數；用真的 claude 指令驗證過）
    expect(args.slice(0, 7)).toEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'slima-video-studio',
      '-e',
      'ELECTRON_RUN_AS_NODE=1',
    ])
    expect(args.slice(args.indexOf('--') + 1)).toEqual([BRIDGE.command, ...BRIDGE.args])
    expect(args).toContain("/Users/x/Library/Application Support/it's")
  })
})

describe('一鍵連接 Claude Desktop', () => {
  const connector = (home: string) =>
    createConnector({
      platform: 'darwin',
      home,
      appData: undefined,
      bridge: BRIDGE,
      findClaude: () => Promise.resolve(undefined),
      runFile: vi.fn(),
      now: () => new Date('2026-10-19T08:00:00.000Z'),
    })
  const configFile = (home: string) =>
    join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')

  it('沒裝 Claude Desktop：info 說沒裝；一鍵連接會建立設定檔', () => {
    const home = tmp()
    const c = connector(home)
    expect(c.info().claudeDesktop).toMatchObject({
      supported: true,
      installed: false,
      connected: false,
    })
    const result = c.connectClaudeDesktop()
    expect(result.backupPath).toBeUndefined()
    const written = JSON.parse(readFileSync(configFile(home), 'utf8')) as { mcpServers: object }
    expect(written.mcpServers).toEqual({ 'slima-video-studio': BRIDGE })
    expect(c.info().claudeDesktop.connected).toBe(true)
  })

  it('已經有別的設定與別的伺服器：全部原樣保留，只加我們這一項，並先備份', () => {
    const home = tmp()
    mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true })
    const original = {
      coworkUserFilesPath: '/x',
      preferences: { a: 1 },
      mcpServers: { other: { command: 'npx', args: ['foo'] } },
    }
    writeFileSync(configFile(home), JSON.stringify(original))
    const c = connector(home)
    expect(c.info().claudeDesktop).toMatchObject({ installed: true, connected: false })
    const result = c.connectClaudeDesktop()
    const written = JSON.parse(readFileSync(configFile(home), 'utf8')) as typeof original & {
      mcpServers: Record<string, unknown>
    }
    expect(written.coworkUserFilesPath).toBe('/x')
    expect(written.preferences).toEqual({ a: 1 })
    expect(written.mcpServers.other).toEqual(original.mcpServers.other)
    expect(written.mcpServers['slima-video-studio']).toEqual(BRIDGE)
    // 備份就是改之前的原樣
    expect(JSON.parse(readFileSync(result.backupPath ?? '', 'utf8'))).toEqual(original)
    expect(result.backupPath).toContain('svs-backup-2026-10-19T08-00-00-000Z')
    // 沒有留下暫存檔
    expect(
      readdirSync(join(home, 'Library', 'Application Support', 'Claude')).filter((f) =>
        f.endsWith('.svs-tmp'),
      ),
    ).toEqual([])
  })

  it('再按一次是更新（路徑變了也會被改回來），不會重複加', () => {
    const home = tmp()
    const c = connector(home)
    c.connectClaudeDesktop()
    const stale = JSON.parse(readFileSync(configFile(home), 'utf8')) as {
      mcpServers: Record<string, { command: string }>
    }
    const entry = stale.mcpServers['slima-video-studio']
    if (!entry) throw new Error('沒有項目')
    entry.command = '/old/place/app'
    writeFileSync(configFile(home), JSON.stringify(stale))
    expect(c.info().claudeDesktop.connected).toBe(false) // 路徑對不上：視為沒連好
    c.connectClaudeDesktop()
    const again = JSON.parse(readFileSync(configFile(home), 'utf8')) as { mcpServers: object }
    expect(Object.keys(again.mcpServers)).toEqual(['slima-video-studio'])
    expect(c.info().claudeDesktop.connected).toBe(true)
  })

  it('設定檔壞掉：不動它、不備份，白話說明', () => {
    const home = tmp()
    mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true })
    writeFileSync(configFile(home), '{ 壞掉了')
    const c = connector(home)
    expect(() => c.connectClaudeDesktop()).toThrow(AppError)
    expect(readFileSync(configFile(home), 'utf8')).toBe('{ 壞掉了')
    expect(readdirSync(join(home, 'Library', 'Application Support', 'Claude'))).toEqual([
      'claude_desktop_config.json',
    ])
    expect(c.info().claudeDesktop.connected).toBe(false)
  })

  it('Linux：沒有 Claude Desktop，一鍵連接丟白話錯誤', () => {
    const c = createConnector({
      platform: 'linux',
      home: tmp(),
      appData: undefined,
      bridge: BRIDGE,
      findClaude: () => Promise.resolve(undefined),
      runFile: vi.fn(),
    })
    expect(c.info().claudeDesktop.supported).toBe(false)
    expect(() => c.connectClaudeDesktop()).toThrow(AppError)
  })
})

describe('Claude Code 有沒有連上（讀它的使用者層級設定）', () => {
  const connector = (home: string) =>
    createConnector({
      platform: 'darwin',
      home,
      appData: undefined,
      bridge: BRIDGE,
      findClaude: () => Promise.resolve(undefined),
      runFile: vi.fn(),
    })

  it('什麼都沒有：沒裝、沒連', () => {
    expect(connector(tmp()).info().claudeCode).toEqual({ installed: false, connected: false })
  })

  it('有 .claude 資料夾：裝了，但設定裡沒有我們這一項就是沒連', () => {
    const home = tmp()
    mkdirSync(join(home, '.claude'))
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }),
    )
    expect(connector(home).info().claudeCode).toEqual({ installed: true, connected: false })
  })

  it('設定裡有我們這一項、路徑一致：連上了；路徑變了或設定檔壞掉：沒連', () => {
    const home = tmp()
    const file = join(home, '.claude.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { 'slima-video-studio': BRIDGE } }))
    expect(connector(home).info().claudeCode).toEqual({ installed: true, connected: true })
    writeFileSync(
      file,
      JSON.stringify({ mcpServers: { 'slima-video-studio': { ...BRIDGE, command: '/old/app' } } }),
    )
    expect(connector(home).info().claudeCode.connected).toBe(false)
    writeFileSync(file, '{ 壞掉')
    expect(connector(home).info().claudeCode).toEqual({ installed: true, connected: false })
  })
})

describe('一鍵連接 Claude Code', () => {
  const CLAUDE = '/Users/x/Library/Application Support/Claude Tools/bin/claude'
  const make = (
    runFile: (file: string, args: string[]) => Promise<void>,
    findClaude: () => Promise<string | undefined> = () => Promise.resolve(CLAUDE),
  ) =>
    createConnector({
      platform: 'darwin',
      home: tmp(),
      appData: undefined,
      bridge: BRIDGE,
      findClaude,
      runFile,
    })

  it('用找到的完整路徑（含空白）直接執行：先移掉舊的同名設定（沒有舊的也沒關係），再 add，參數是陣列', async () => {
    const calls: { file: string; args: string[] }[] = []
    const c = make((file, args) => {
      calls.push({ file, args })
      return args[1] === 'remove' ? Promise.reject(new Error('沒有這一項')) : Promise.resolve()
    })
    const result = await c.connectClaudeCode()
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.file === CLAUDE)).toBe(true)
    expect(calls[0]?.args).toEqual(['mcp', 'remove', '--scope', 'user', 'slima-video-studio'])
    expect(calls[1]?.args).toEqual(claudeAddArgs(BRIDGE))
    expect(result.command).toBe(claudeCodeBridgeCommand(BRIDGE, 'darwin'))
  })

  it('找不到 claude：不執行任何東西，白話說明並給可貼的指令', async () => {
    const runFile = vi.fn()
    const c = make(runFile, () => Promise.resolve(undefined))
    const error = await c.connectClaudeCode().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).userMessage).toContain('貼到終端機')
    expect(runFile).not.toHaveBeenCalled()
    // 找 claude 的過程自己出錯，也一樣
    const broken = make(runFile, () => Promise.reject(new Error('spawn /bin/zsh ENOENT')))
    const error2 = await broken.connectClaudeCode().catch((e: unknown) => e)
    expect((error2 as AppError).userMessage).not.toMatch(/ENOENT|spawn/)
  })

  it('add 失敗：白話錯誤，不含系統訊息', async () => {
    const c = make((_file, args) =>
      args[1] === 'add' ? Promise.reject(new Error('exit 1: secret path')) : Promise.resolve(),
    )
    const error = await c.connectClaudeCode().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).userMessage).toContain('貼到終端機')
    expect((error as AppError).userMessage).not.toContain('secret path')
  })
})
