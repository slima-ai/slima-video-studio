import { AppError } from '@svs/schema'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bridgeCommand,
  claudeCodeBridgeCommand,
  createConnector,
  desktopConfigPath,
  desktopSnippet,
  shellQuote,
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

  it('Claude Code 指令：路徑有空白或單引號都跳脫好', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    const command = claudeCodeBridgeCommand(BRIDGE)
    expect(
      command.startsWith(
        'claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 slima-video-studio -- ',
      ),
    ).toBe(true)
    expect(command).toContain(
      `'/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio'`,
    )
    expect(command).toContain(`'/Users/x/Library/Application Support/it'\\''s'`)
  })
})

describe('一鍵連接 Claude Desktop', () => {
  const connector = (home: string, runShell = vi.fn()) =>
    createConnector({
      platform: 'darwin',
      home,
      appData: undefined,
      bridge: BRIDGE,
      runShell,
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
      runShell: vi.fn(),
    })
    expect(c.info().claudeDesktop.supported).toBe(false)
    expect(() => c.connectClaudeDesktop()).toThrow(AppError)
  })
})

describe('一鍵連接 Claude Code', () => {
  const make = (runShell: (line: string) => Promise<void>) =>
    createConnector({
      platform: 'darwin',
      home: tmp(),
      appData: undefined,
      bridge: BRIDGE,
      runShell,
    })

  it('先移掉舊的同名設定（沒有舊的也沒關係），再 add', async () => {
    const lines: string[] = []
    const c = make((line) => {
      lines.push(line)
      return line.includes(' remove ') ? Promise.reject(new Error('沒有這一項')) : Promise.resolve()
    })
    const result = await c.connectClaudeCode()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('claude mcp remove --scope user slima-video-studio')
    expect(lines[1]).toBe(result.command)
  })

  it('claude 跑不起來：白話錯誤，不含系統訊息', async () => {
    const c = make(() => Promise.reject(new Error('spawn /bin/zsh ENOENT')))
    const error = await c.connectClaudeCode().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).userMessage).toContain('貼到終端機')
    expect((error as AppError).userMessage).not.toMatch(/ENOENT|spawn/)
  })
})
