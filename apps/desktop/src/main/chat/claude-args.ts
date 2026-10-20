import { SERVER_NAME, type BridgeCommand } from '../mcp/connect'

export interface ClaudeArgsInput {
  /** 這個對話的 session id（我們自己產生的 UUID）。 */
  sessionId: string
  /** true＝接續（`--resume`），false＝開新的（`--session-id`）。 */
  resume: boolean
  /** 我們的 MCP 轉接指令（不含 token：轉接檔每次自己從使用者資料夾讀）。 */
  bridge: BridgeCommand
  systemPrompt: string
  /** Claude 自己的 token 用量上限（美金，一個行程）。 */
  maxBudgetUsd: number
}

/**
 * 啟動 `claude -p` 的參數。每一項的理由：
 * - 長駐模式：stdin 一行一行送使用者訊息、stdout 一行一行收事件（stream-json）。
 * - 只接我們的 MCP（`--strict-mcp-config`＋`--mcp-config`），只准用它的工具（`--allowedTools`），
 *   內建的 Bash／檔案工具全關（`--tools ""`），其他一律拒絕不詢問（`dontAsk`）。
 * - 隔離使用者的客製化：`--setting-sources ""` 不讀使用者／專案／本機設定（擋掉他的外掛、代理、hooks、CLAUDE.md），
 *   `--disable-slash-commands` 關掉所有技能與斜線指令。**不用 `--safe-mode`**：它連 `--mcp-config` 給的 MCP 也一起關掉
 *   （實測 init 的 tools 是 0），Claude 就什麼都改不了。**不用 `--bare`**：它不讀 OAuth／鑰匙圈，只吃 API 金鑰，
 *   訂閱登入的使用者會直接失效。登入仍是使用者自己的，我們什麼金鑰都不傳。
 */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const mcpConfig = JSON.stringify({ mcpServers: { [SERVER_NAME]: input.bridge } })
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    input.resume ? '--resume' : '--session-id',
    input.sessionId,
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--allowedTools',
    `mcp__${SERVER_NAME}__*`,
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--max-budget-usd',
    String(input.maxBudgetUsd),
    '--append-system-prompt',
    input.systemPrompt,
  ]
}

/** 啟動 claude 時要帶的環境變數：只給它跑起來需要的，不把 App 自己的環境整包傳過去。 */
const ENV_KEYS: Readonly<Record<'posix' | 'win32', readonly string[]>> = {
  posix: ['PATH', 'HOME', 'LANG', 'USER', 'SHELL', 'TMPDIR'],
  win32: [
    'PATH',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'SystemRoot',
    'ComSpec',
    'TEMP',
    'TMP',
    'HOMEDRIVE',
    'HOMEPATH',
  ],
}

export function claudeEnv(
  base: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const keys = platform === 'win32' ? ENV_KEYS.win32 : ENV_KEYS.posix
  const env: Record<string, string> = {}
  for (const key of keys) {
    const value = base[key]
    if (value !== undefined && value !== '') env[key] = value
  }
  return env
}

/** 加在 Claude 系統提示後面的話：它在這個 App 裡能做什麼、花錢前要怎麼做。 */
export const CHAT_SYSTEM_PROMPT = [
  '你是 Slima Video Studio（做短片的桌面 App）裡的助手，使用者正在畫布上做一個專案，你透過 MCP 工具直接改他的專案。',
  '用繁體中文回答，簡短、白話；做完事情用一兩句說你改了什麼，不要貼工具的原始輸出。',
  '會呼叫 AI 模型、要花錢的步驟（生成圖片、影片、旁白、配樂等）之前，先用 estimate_cost 或 plan_sound 估價，',
  '把預估金額與要做的事用白話告訴使用者，等他說好才執行。只改文字、鏡頭、大綱這類不花錢的事可以直接做。',
  '你只能用這個 App 的工具；沒有的功能就老實說做不到。',
].join('\n')
