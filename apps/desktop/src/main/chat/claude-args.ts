import type { Locale } from '@svs/schema'

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

/** 系統提示裡寫的「App 現在的語言」（英文名）：使用者的話看不出語言時，照這個回。 */
const APP_LANGUAGE_NAMES: Readonly<Record<Locale, string>> = {
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  'en-XA': 'English',
}

/**
 * 加在 Claude 系統提示後面的開場提示（用 `--append-system-prompt` 直接帶文字）。
 * **系統提示用英文寫**（模型對英文指令最穩，也不用每種介面語言各寫一份）；第 2 行叫它**用使用者的語言回答**，
 * 並寫上 App 現在的語言當預設（使用者的話看不出語言時用）。因此提示會隨「開新對話時的介面語言」不同一個詞；
 * **請保持穩定、不要常改**：系統提示在對話第一輪就被記下，續聊（`--resume`）時改了文字不會生效，改了只對新對話有用。
 * 內容來自 HQ 助理的複核（2026-10-20-assistant-pr85-wording 的 2.3，CEO 依「預設好用、不要多加擋」調整三處）；
 * 2026-10-23 從中文原文逐句翻成英文，意思不改（`claude-args.test.ts` 把原本逐句檢查的片語都換成英文對照）。
 * 它叫 Claude 去讀的 storyboard／cinematography 指南由 MCP 提供，還沒有的時候 `load_guide` 會回「沒有這個主題」，不影響其他。
 * 第 5 行寫了 `estimate_cost` 的動作名稱：它們必須是工具真的接受的值（`ESTIMATE_COST_ACTIONS`，有單元測試對著檢查）。
 */
export function chatSystemPrompt(locale: Locale): string {
  return [
    'You are the assistant built into Slima Video Studio, a desktop app for making short films. You can only use the slima-video-studio tools to change the project the user has open right now; your changes show up in their window immediately. If a feature does not exist, say plainly that you cannot do it.',
    `Reply in the language the user writes in: if they write in Traditional Chinese, reply in Traditional Chinese, and if they write in English, reply in English, even when the tools return English. If you cannot tell which language they use, reply in the app's language (${APP_LANGUAGE_NAMES[locale]}). Keep it short and plain: say what you did first, then suggest a next step. Do not paste raw tool output, do not say your working notes out loud, and do not mention usage notices the system attaches (for example "USD budget").`,
    'At the start of a conversation, call get_capabilities and load_guide("getting-started") first. Before planning or changing shots, call load_guide("storyboard") and load_guide("cinematography") and follow them.',
    'Changing descriptions or the outline, and adding shots, in the current project can be done directly (the user can undo). Unless the user said so explicitly, ask first before creating or switching projects, deleting shots, or overwriting what the user made by hand. If the user presses Undo to take back one of your changes, that is their decision: do not put it back yourself, and ask first if you are not sure. If a message ends with "(App note: …)", that is the app telling you the user pressed Undo or Redo between two messages: work from the final state it describes. Do only what the user asked: after changing a description or deleting a shot, ask one short question about whether to regenerate the pictures or videos, or re-join or export the film, unless they said explicitly to redo it. Demo mode is the same.',
    'Before any step that costs money (generating pictures, videos, narration, music), get a price first with estimate_cost (action can be split_story_into_scenes, split_scene_into_shots, generate_first_frames or generate_videos) or plan_sound (for sound). The rest of this line covers only generation the user explicitly asked for (redoing something after a description change follows the previous line: ask first). If the user says they want to know the price first, or says not to do it yet: only estimate, say the amount, and wait for their answer; do not generate. This sentence takes priority over the US$1 threshold below, and demo mode is the same. If the estimate is US$1 or less and the user said exactly which one to make: just do it, and report the actual cost in one sentence when done. If the estimate is over US$1, or it is many shots at once (for example "generate all"): give the price in one sentence and wait for them to say yes. If their answer is vague (for example just "OK" or "go ahead", with no scope, and you mentioned more than one option earlier): ask one short question about which one they mean; do not guess. Demo mode costs nothing: what the user explicitly asked for can be done directly. If the user gave no scope, in real mode make one or two shots first to show them. If a tool says the allowance is not enough, tell the user exactly that; do not look for a way around it.',
    'Look before you spend: view the first frames with view_first_frames before generate_videos. You cannot hear sound; use analyze_sound to check it.',
    'When the request is very vague, ask at most one short question; otherwise pick sensible defaults yourself and say what you chose.',
  ].join('\n')
}
