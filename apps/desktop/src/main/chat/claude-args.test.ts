import { describe, expect, it } from 'vitest'

import { bridgeCommand } from '../mcp/connect'
import { buildClaudeArgs, CHAT_SYSTEM_PROMPT, claudeEnv } from './claude-args'

const bridge = bridgeCommand('/Applications/App/Electron', '/app/mcp-stdio-bridge.js', '/user/data')
const base = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  bridge,
  systemPrompt: CHAT_SYSTEM_PROMPT,
  maxBudgetUsd: 0.5,
}

describe('buildClaudeArgs', () => {
  it('新對話用 --session-id，接續用 --resume（兩個不能一起用）', () => {
    const fresh = buildClaudeArgs({ ...base, resume: false })
    expect(fresh).toContain('--session-id')
    expect(fresh).not.toContain('--resume')
    const again = buildClaudeArgs({ ...base, resume: true })
    expect(again).toContain('--resume')
    expect(again).not.toContain('--session-id')
    expect(again[again.indexOf('--resume') + 1]).toBe(base.sessionId)
  })

  it('只接我們的 MCP、只准用它的工具、內建工具全關、其他一律拒絕不詢問', () => {
    const args = buildClaudeArgs({ ...base, resume: false })
    const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1]
    expect(args).toContain('--strict-mcp-config')
    expect(after('--allowedTools')).toBe('mcp__slima-video-studio__*')
    expect(after('--permission-mode')).toBe('dontAsk')
    expect(after('--tools')).toBe('')
    const mcp = JSON.parse(after('--mcp-config') ?? '{}') as { mcpServers: Record<string, unknown> }
    expect(Object.keys(mcp.mcpServers)).toEqual(['slima-video-studio'])
    expect(mcp.mcpServers['slima-video-studio']).toEqual(bridge)
  })

  it('隔離使用者的外掛與技能：--setting-sources "" ＋ --disable-slash-commands；不用 --safe-mode（會連我們的 MCP 一起關掉）、不用 --bare（不讀登入）', () => {
    const args = buildClaudeArgs({ ...base, resume: false })
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args).toContain('--disable-slash-commands')
    expect(args).not.toContain('--safe-mode')
    expect(args).not.toContain('--bare')
  })

  it('用量上限與系統提示照傳；整串參數裡沒有任何金鑰或 token 的樣子', () => {
    const args = buildClaudeArgs({ ...base, resume: false })
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('0.5')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(CHAT_SYSTEM_PROMPT)
    expect(args.join(' ')).not.toMatch(/token|api[-_]?key|sk-/i)
  })
})

describe('claudeEnv', () => {
  it('只留跑起來需要的幾個變數，App 自己的環境（SVS_*、金鑰）不會傳過去', () => {
    const env = claudeEnv(
      {
        PATH: '/usr/bin',
        HOME: '/Users/x',
        LANG: 'zh_TW.UTF-8',
        SVS_TEST_VAULT: 'memory',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
        OPENROUTER_API_KEY: 'sk-or-secret',
        ELECTRON_RUN_AS_NODE: '1',
      },
      'darwin',
    )
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/x', LANG: 'zh_TW.UTF-8' })
  })

  it('Windows 用 USERPROFILE／APPDATA 那一組', () => {
    const env = claudeEnv(
      { PATH: 'C:\\x', USERPROFILE: 'C:\\u', HOME: 'nope', SECRET: 's' },
      'win32',
    )
    expect(env).toEqual({ PATH: 'C:\\x', USERPROFILE: 'C:\\u' })
  })
})
