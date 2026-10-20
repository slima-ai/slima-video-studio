import { z } from 'zod'

import { IsoDateTimeSchema } from './common'

/** 右下角 Claude 對話需要的最低 Claude Code 版本（文件標的 `--permission-prompts` 最低版；我們實測過的是 2.1.304）。 */
export const CHAT_MIN_CLAUDE_VERSION = '2.1.259'

/**
 * 能不能開始對話：哪一項還沒準備好就說哪一項，畫面各給一張說明卡。
 * `disabled`＝設定裡的實驗功能開關沒開；`mcp_off`＝設定的「AI 工具連線」沒開（Claude 靠它改專案）。
 */
export const ChatPrereqSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('disabled') }),
  z.object({ state: z.literal('mcp_off') }),
  z.object({ state: z.literal('not_installed') }),
  z.object({ state: z.literal('too_old'), version: z.string(), minVersion: z.string() }),
  z.object({ state: z.literal('not_logged_in'), version: z.string() }),
  z.object({ state: z.literal('ready'), version: z.string() }),
])
export type ChatPrereq = z.infer<typeof ChatPrereqSchema>

/** 一個對話（一個 Claude session）。 */
export const ChatConversationSchema = z.object({
  /** 同時是 Claude 的 session id（`--session-id`／`--resume`）。 */
  id: z.uuid(),
  title: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** 這個對話現在有一輪正在進行。 */
  running: z.boolean(),
})
export type ChatConversation = z.infer<typeof ChatConversationSchema>

/** Claude 這一輪用過的一個工具（用白話標籤顯示，工具名留給程式用）。 */
export const ChatStepSchema = z.object({
  id: z.string(),
  /** 去掉 `mcp__slima-video-studio__` 前綴的工具名，例如 `create_shot`。 */
  tool: z.string(),
  /** 白話，例如「正在建立鏡頭…」；做完是「建立鏡頭」。 */
  label: z.string(),
  status: z.enum(['running', 'done', 'error']),
  /** 工具結果的短摘要（最多 200 字，不含完整內容）。 */
  summary: z.string().optional(),
})
export type ChatStep = z.infer<typeof ChatStepSchema>

export const ChatPanelMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  steps: z.array(ChatStepSchema),
  at: IsoDateTimeSchema,
  /** 只有 Claude 的訊息有：進行中、完成、被使用者停止、出錯。 */
  state: z.enum(['streaming', 'done', 'stopped', 'error']).optional(),
  /** state 是 error 時的白話說明。 */
  error: z.string().optional(),
  /** 因為用量或步數到上限而停下來：可以按「繼續」，用新的行程接著做（畫面才顯示那顆按鈕）。 */
  resumable: z.boolean().optional(),
})
export type ChatPanelMessage = z.infer<typeof ChatPanelMessageSchema>

/** 主程序推給畫面的對話事件：整則訊息或整個對話的最新樣子（畫面照 id 取代，不必自己拼字）。 */
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    conversationId: z.uuid(),
    message: ChatPanelMessageSchema,
  }),
  z.object({ type: z.literal('conversation'), conversation: ChatConversationSchema }),
])
export type ChatEvent = z.infer<typeof ChatEventSchema>

export const CHAT_TEXT_MAX = 8000
export const ChatTitleSchema = z.string().trim().min(1).max(60)
