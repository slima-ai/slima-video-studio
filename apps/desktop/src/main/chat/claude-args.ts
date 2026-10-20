import { SERVER_NAME, type BridgeCommand } from '../mcp/connect'

export interface ClaudeArgsInput {
  /** 這個對話的 session id（我們自己產生的 UUID）。 */
  sessionId: string
  /** true＝接續（`--resume`），false＝開新的（`--session-id`）。 */
  resume: boolean
  /** 接續時另外分出一個新的 session（`--fork-session`）：這個對話是從別的專案複製來的，不能跟原本的共用同一份。 */
  fork?: boolean
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
    ...(input.resume && input.fork === true ? ['--fork-session'] : []),
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

/**
 * 使用者自己的 Claude 設定與網路環境：換過設定資料夾（CLAUDE_CONFIG_DIR，登入就存在那裡）、
 * 公司網路走 proxy、自簽憑證（NODE_EXTRA_CA_CERTS）的人，不放行就會變成「沒登入」或連不上。
 * 這些是設定位置與網路設定，不是 App 的金鑰；proxy 網址可能帶帳密，所以只傳給 claude、不寫進紀錄。
 */
const PASS_THROUGH = [
  'CLAUDE_CONFIG_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
] as const

/** 啟動 claude 時要帶的環境變數：只給它跑起來需要的，不把 App 自己的環境整包傳過去。 */
const ENV_KEYS: Readonly<Record<'posix' | 'win32', readonly string[]>> = {
  posix: ['PATH', 'HOME', 'LANG', 'USER', 'SHELL', 'TMPDIR', ...PASS_THROUGH],
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
    ...PASS_THROUGH,
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

/**
 * 加在 Claude 系統提示後面的開場提示（用 `--append-system-prompt` 直接帶文字）。
 * **請保持穩定、不要常改**：系統提示在對話第一輪就被記下，續聊（`--resume`）時改了文字不會生效，改了只對新對話有用。
 * 內容來自 HQ 助理的複核（2026-10-20-assistant-pr85-wording 的 2.3，CEO 依「預設好用、不要多加擋」調整三處）。
 * 它叫 Claude 去讀的 storyboard／cinematography 指南由 MCP 提供，還沒有的時候 `load_guide` 會回「沒有這個主題」，不影響其他。
 * 第 5 行寫了 `estimate_cost` 的動作名稱：它們必須是工具真的接受的值（`ESTIMATE_COST_ACTIONS`，有單元測試對著檢查）。
 */
export const CHAT_SYSTEM_PROMPT = [
  '你是 Slima Video Studio（做短片的桌面 App）內建的助手。你只能用 slima-video-studio 的工具改使用者現在開著的專案，你的改動會立刻出現在他的視窗；沒有的功能就老實說做不到。',
  '用使用者的語言回答（預設繁體中文），簡短白話：先說你做了什麼，再建議下一步；不要貼工具的原始輸出，不要把工作筆記說出來，也不要提系統附的用量提示（例如「USD budget」）。',
  '對話一開始先呼叫 get_capabilities 和 load_guide("getting-started")；規劃或修改鏡頭前，先 load_guide("storyboard") 和 load_guide("cinematography") 並照著做。',
  '在目前的專案裡改描述、大綱、新增鏡頭可以直接做（使用者能復原）。使用者沒明講要的話，建立或切換專案、刪除鏡頭、蓋掉使用者手動做的內容，先問。',
  '會花錢的步驟（生成圖片、影片、旁白、配樂）開始前，先用 estimate_cost（action 可填 split_story_into_scenes、split_scene_into_shots、generate_first_frames、generate_videos）或 plan_sound（聲音）問價錢，一句話告訴使用者要做什麼、大約多少錢，等他說好再做（他已經說了直接做，就不用再問；示範模式不花錢，可以直接做）。使用者沒指定範圍時，真實模式先做一兩個鏡頭給他看。工具說額度不夠，就照實告訴使用者，不要想辦法繞過。',
  '先看再花錢：用 view_first_frames 看過第一張畫面，再 generate_videos。你聽不到聲音，用 analyze_sound 檢查。',
  '需求很模糊時最多問一個短問題；否則自己選合理的預設，並說你選了什麼。',
].join('\n')
