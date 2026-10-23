import { describe, expect, it } from 'vitest'

import { bridgeCommand } from '../mcp/connect'
import { ESTIMATE_COST_ACTIONS } from '../mcp/tools/story'
import { describeHistoryNote } from './history-note'
import { buildClaudeArgs, chatSystemPrompt, claudeEnv } from './claude-args'

const bridge = bridgeCommand('/Applications/App/Electron', '/app/mcp-stdio-bridge.js', '/user/data')
const base = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  bridge,
  systemPrompt: chatSystemPrompt('zh-TW'),
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
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(chatSystemPrompt('zh-TW'))
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

describe('chatSystemPrompt（英文；第 2 行叫 Claude 用使用者的語言回答）', () => {
  const PROMPT = chatSystemPrompt('en')
  const lines = PROMPT.split('\n')

  it('7 行；叫 Claude 先讀指南、花錢先說再做、先看再花錢；估價用 estimate_cost（拆分、首幀、影片）與 plan_sound（聲音）', () => {
    expect(lines).toHaveLength(7)
    expect(PROMPT).toContain('load_guide("cinematography")')
    expect(PROMPT).toContain('view_first_frames')
    expect(PROMPT).toContain('estimate_cost')
    expect(PROMPT).toContain('plan_sound')
    // 預設好用、不多加擋：小事（US$1 以下、講明了）直接做；細節在下一項測試
    expect(PROMPT).toContain('just do it, and report the actual cost in one sentence when done')
    expect(PROMPT).toContain('Unless the user said so explicitly')
    expect(PROMPT).not.toMatch(/token|api[-_]?key|sk-/i)
  })

  it('整段都是英文（沒有中文字；系統提示固定用英文寫）', () => {
    expect(PROMPT).not.toMatch(/[\u3000-\u9fff\uff00-\uffef]/u)
  })

  it('用使用者的語言回答：中文講就用繁體中文回、英文講就用英文回，即使工具回傳英文；看不出來才照 App 的語言', () => {
    const line = lines[1] ?? ''
    expect(line).toContain('Reply in the language the user writes in')
    // 實測曾經：使用者用中文講，工具回傳英文，Claude 整段回英文
    expect(line).toContain(
      'if they write in Traditional Chinese, reply in Traditional Chinese, and if they write in English, reply in English, even when the tools return English',
    )
    expect(line).toContain("reply in the app's language (English)")
    expect(chatSystemPrompt('zh-TW').split('\n')[1]).toContain(
      "reply in the app's language (Traditional Chinese)",
    )
    // 其他行不隨語言變：只有「App 的語言」那個詞不同
    expect(
      chatSystemPrompt('zh-TW')
        .split('\n')
        .filter((_, i) => i !== 1),
    ).toEqual(lines.filter((_, i) => i !== 1))
  })

  it('叫它不要把工作筆記和系統附的用量提示（USD budget）說出來', () => {
    const line = lines[1] ?? ''
    expect(line).toContain('do not say your working notes out loud')
    expect(line).toContain('USD budget')
  })

  it('只做使用者講的事：改描述或刪鏡頭之後，要不要重生成、重新接片或匯出，先問一句（除非明講要重做）；跟 US$1 門檻不打架', () => {
    const scope = lines[3] ?? ''
    expect(scope).toContain('Do only what the user asked')
    expect(scope).toContain('after changing a description or deleting a shot')
    expect(scope).toContain(
      'ask one short question about whether to regenerate the pictures or videos, or re-join or export the film, unless they said explicitly to redo it',
    )
    // 示範模式不花錢也一樣：被改動的東西不能在使用者沒說的情況下被重做、重新匯出
    expect(scope).toContain('Demo mode is the same.')
    // 門檻那句只管「使用者講明要做的生成」，並指回上一行
    const price = lines[4] ?? ''
    expect(price).toContain(
      'The rest of this line covers only generation the user explicitly asked for (redoing something after a description change follows the previous line: ask first)',
    )
    expect(price.indexOf('The rest of this line covers only')).toBeLessThan(
      price.indexOf('US$1 or less'),
    )
  })

  it('使用者說要先知道價錢（或先不要做）：只估價、說出金額、等回答，優先於 US$1 門檻；「好」「做吧」沒講範圍而前面提過多個選項：問是哪一個', () => {
    const line = lines[4] ?? ''
    const first =
      'If the user says they want to know the price first, or says not to do it yet: only estimate, say the amount, and wait for their answer; do not generate.'
    expect(line).toContain(first)
    expect(line).toContain(
      'This sentence takes priority over the US$1 threshold below, and demo mode is the same.',
    )
    // 優先句要在門檻句之前，Claude 才會先讀到
    expect(line.indexOf(first)).toBeLessThan(line.indexOf('US$1 or less'))
    expect(line).toContain(
      'If their answer is vague (for example just "OK" or "go ahead", with no scope, and you mentioned more than one option earlier): ask one short question about which one they mean; do not guess.',
    )
  })

  it('使用者按復原撤回你的改動是他的決定，不要自己改回去；看到「App note」照最後狀態做事（寫在第 4 行，仍是 7 行）', () => {
    const line = lines[3] ?? ''
    expect(line).toContain(
      'that is their decision: do not put it back yourself, and ask first if you are not sure',
    )
    expect(line).toContain('"(App note: …)"')
    expect(line).toContain('work from the final state it describes')
    // 這句話提到的格式，要跟 history-note.ts 真的附的一樣
    expect(describeHistoryNote([{ direction: 'undo', label: 'X', details: [] }])).toMatch(
      /^\(App note: /,
    )
  })

  it('寫到 estimate_cost 的那句：提到的動作名稱都是工具真的接受的值（工具改名了，提示不會再對不上）', () => {
    const line = lines.find((l) => l.includes('estimate_cost'))
    expect(line).toBeDefined()
    // estimate_cost (…) 括號裡的 snake_case 名字
    const inside = /estimate_cost \(([^)]*)\)/.exec(line ?? '')?.[1] ?? ''
    const names = inside.match(/[a-z]+(?:_[a-z]+)+/g) ?? []
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(ESTIMATE_COST_ACTIONS as readonly string[], name).toContain(name)
    }
    // 首幀與影片現在也問得到價錢
    expect(names).toContain('generate_first_frames')
    expect(names).toContain('generate_videos')
    // 門檻 US$1：小事不囉嗦（講明了、US$1 以下直接做並報實際花費），大筆的才先問；含糊就問、不猜
    expect(line).toContain(
      'If the estimate is US$1 or less and the user said exactly which one to make: just do it, and report the actual cost in one sentence when done.',
    )
    expect(line).toContain(
      'If the estimate is over US$1, or it is many shots at once (for example "generate all"): give the price in one sentence and wait for them to say yes.',
    )
    expect(line).toContain('do not guess')
    expect(line).toContain(
      'Demo mode costs nothing: what the user explicitly asked for can be done directly.',
    )
  })
})
