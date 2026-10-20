import { describe, expect, it } from 'vitest'

import { bridgeCommand } from '../mcp/connect'
import { ESTIMATE_COST_ACTIONS } from '../mcp/tools/story'
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

describe('claudeEnv：使用者自己的 Claude 設定與網路環境要放行', () => {
  it('換過設定資料夾、走 proxy、自簽憑證的人：這幾個變數傳得過去，金鑰還是不傳', () => {
    const env = claudeEnv(
      {
        PATH: '/usr/bin',
        HOME: '/Users/x',
        CLAUDE_CONFIG_DIR: '/Users/x/.claude-work',
        HTTPS_PROXY: 'http://proxy.corp:8080',
        https_proxy: 'http://proxy.corp:8080',
        HTTP_PROXY: 'http://proxy.corp:8080',
        NO_PROXY: 'localhost,127.0.0.1',
        NODE_EXTRA_CA_CERTS: '/etc/corp-ca.pem',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
        OPENROUTER_API_KEY: 'sk-or-secret',
      },
      'darwin',
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-work',
      HTTPS_PROXY: 'http://proxy.corp:8080',
      https_proxy: 'http://proxy.corp:8080',
      HTTP_PROXY: 'http://proxy.corp:8080',
      NO_PROXY: 'localhost,127.0.0.1',
      NODE_EXTRA_CA_CERTS: '/etc/corp-ca.pem',
    })
  })

  it('Windows 一樣放行', () => {
    const env = claudeEnv(
      {
        PATH: 'C:\\x',
        USERPROFILE: 'C:\\u',
        HTTPS_PROXY: 'http://p:1',
        CLAUDE_CONFIG_DIR: 'D:\\c',
      },
      'win32',
    )
    expect(env).toEqual({
      PATH: 'C:\\x',
      USERPROFILE: 'C:\\u',
      HTTPS_PROXY: 'http://p:1',
      CLAUDE_CONFIG_DIR: 'D:\\c',
    })
  })
})

describe('CHAT_SYSTEM_PROMPT', () => {
  it('7 行；叫 Claude 先讀指南、花錢先說再做、先看再花錢；估價用 estimate_cost（拆分、首幀、影片）與 plan_sound（聲音）', () => {
    expect(CHAT_SYSTEM_PROMPT.split('\n')).toHaveLength(7)
    expect(CHAT_SYSTEM_PROMPT).toContain('load_guide("cinematography")')
    expect(CHAT_SYSTEM_PROMPT).toContain('view_first_frames')
    expect(CHAT_SYSTEM_PROMPT).toContain('estimate_cost')
    expect(CHAT_SYSTEM_PROMPT).toContain('plan_sound')
    // 預設好用、不多加擋：小事（US$1 以下、講明了）直接做；細節在下一項測試
    expect(CHAT_SYSTEM_PROMPT).toContain('直接做，做完一句話報實際花費')
    expect(CHAT_SYSTEM_PROMPT).toContain('使用者沒明講要的話')
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/token|api[-_]?key|sk-/i)
  })

  it('叫它不要把工作筆記和系統附的用量提示（USD budget）說出來', () => {
    const line = CHAT_SYSTEM_PROMPT.split('\n')[1] ?? ''
    expect(line).toContain('不要把工作筆記說出來')
    // 使用者用中文講，就用繁體中文回，即使工具回傳的是英文（實測曾整段回英文）
    expect(line).toContain('使用者用中文講，就用繁體中文回，即使工具回傳的是英文也一樣')
    expect(line).toContain('USD budget')
  })

  it('寫到 estimate_cost 的那句：提到的動作名稱都是工具真的接受的值（工具改名了，提示不會再對不上）', () => {
    const line = CHAT_SYSTEM_PROMPT.split('\n').find((l) => l.includes('estimate_cost'))
    expect(line).toBeDefined()
    // estimate_cost（…）括號裡的 snake_case 名字
    const inside = /estimate_cost（([^）]*)）/.exec(line ?? '')?.[1] ?? ''
    const names = inside.match(/[a-z]+(?:_[a-z]+)+/g) ?? []
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(ESTIMATE_COST_ACTIONS as readonly string[], name).toContain(name)
    }
    // 首幀與影片現在也問得到價錢；不再說「沒有事前估價的工具」
    expect(names).toContain('generate_first_frames')
    expect(names).toContain('generate_videos')
    expect(CHAT_SYSTEM_PROMPT).not.toContain('沒有事前估價')
    // 門檻 US$1：小事不囉嗦（講明了、US$1 以下直接做並報實際花費），大筆的才先問；含糊就問、不猜
    expect(line).toContain(
      '估價在 US$1 以下、而且使用者講明了要做哪一個：直接做，做完一句話報實際花費',
    )
    expect(line).toContain(
      '估價超過 US$1，或一次做很多鏡（例如「全部生成」）：先用一句話報價、等他說好再做',
    )
    expect(line).toContain('問一個短問題，不要猜')
    expect(line).toContain('示範模式不花錢，可以直接做')
    // 舊的「說了直接做就不用再問」不留：現在超過門檻一定先報價
    expect(line).not.toContain('他已經說了直接做，就不用再問')
  })
})
