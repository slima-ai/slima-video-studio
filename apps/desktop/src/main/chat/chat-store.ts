import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { ChatPanelMessageSchema, type ChatPanelMessage, t } from '@svs/schema'

/**
 * Claude 對話的紀錄：放在專案資料夾的 `chat/`，一個對話一個檔（`<對話 id>.jsonl`），一行一筆，只往後面加。
 * 第一行是版本（`{"v":1}`）；之後是兩種紀錄：`conv`（標題、時間、Claude 那邊的 session id、這個對話是在哪個專案資料夾建的）
 * 與 `msg`（一則訊息）。同一個 id 後面的蓋掉前面的。壞掉的行略過；版本不認得的檔整個略過、不動它。
 *
 * **存什麼**：使用者的話、Claude 的回覆文字、工具步驟（工具名、白話標籤、做完／失敗、不超過 200 字的結果摘要）、時間。
 * **不存**：Claude 的思考、init 裡的外掛／技能／路徑清單、帳號或用量數字、任何 token 或金鑰。
 * 做法上不靠「過濾」：寫出去的每一筆都是下面這兩個函式從已知欄位重新組出來的，不是把 Claude 的原始事件存下來。
 */
export const CHAT_DIR = 'chat'
export const CHAT_FILE_VERSION = 1

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StoredConversationInfo {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Claude 那邊的 session id（`--resume` 用的）。 */
  claudeSession?: string | undefined
  /** 這個對話是在哪個專案資料夾建的；跟現在的專案資料夾不同＝這個專案是另存出來的複本。 */
  origin?: string | undefined
}

export interface StoredConversation {
  info: StoredConversationInfo
  messages: ChatPanelMessage[]
}

export type ChatRecord =
  { t: 'conv'; info: StoredConversationInfo } | { t: 'msg'; message: ChatPanelMessage }

const SUMMARY_MAX = 200

/** 只留已知欄位、串流中的不存（做完才存）；步驟的結果摘要截到 200 字。 */
export function sanitizeMessage(message: ChatPanelMessage): ChatPanelMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    steps: message.steps.map((step) => ({
      id: step.id,
      tool: step.tool,
      label: step.label,
      status: step.status,
      ...(step.summary === undefined ? {} : { summary: step.summary.slice(0, SUMMARY_MAX) }),
    })),
    at: message.at,
    ...(message.state === undefined ? {} : { state: message.state }),
    ...(message.error === undefined ? {} : { error: message.error }),
    ...(message.resumable === true ? { resumable: true } : {}),
    ...(message.notes !== undefined && message.notes.length > 0 ? { notes: message.notes } : {}),
    ...(message.appNote === undefined || message.appNote === ''
      ? {}
      : { appNote: message.appNote }),
  }
}

const sanitizeInfo = (info: StoredConversationInfo): StoredConversationInfo => ({
  id: info.id,
  title: info.title,
  createdAt: info.createdAt,
  updatedAt: info.updatedAt,
  ...(info.claudeSession === undefined ? {} : { claudeSession: info.claudeSession }),
  ...(info.origin === undefined ? {} : { origin: info.origin }),
})

const fileOf = (projectDir: string, conversationId: string): string => {
  if (!ID.test(conversationId)) throw new Error('對話 id 格式不對')
  return join(projectDir, CHAT_DIR, `${conversationId}.jsonl`)
}

/** 在這個對話的檔案後面加幾筆紀錄（檔案不存在就先寫版本那一行）。 */
export function appendRecords(
  projectDir: string,
  conversationId: string,
  records: readonly ChatRecord[],
): void {
  const file = fileOf(projectDir, conversationId)
  mkdirSync(join(projectDir, CHAT_DIR), { recursive: true })
  const lines: string[] = []
  if (!existsSync(file)) lines.push(JSON.stringify({ v: CHAT_FILE_VERSION }))
  for (const record of records) {
    lines.push(
      JSON.stringify(
        record.t === 'conv'
          ? { t: 'conv', ...sanitizeInfo(record.info) }
          : { t: 'msg', message: sanitizeMessage(record.message) },
      ),
    )
  }
  appendFileSync(file, `${lines.join('\n')}\n`)
}

/** 把整個對話重寫成新的檔案（搬到另一個專案時用）。 */
export function writeConversation(projectDir: string, conversation: StoredConversation): void {
  const file = fileOf(projectDir, conversation.info.id)
  mkdirSync(join(projectDir, CHAT_DIR), { recursive: true })
  const lines = [
    JSON.stringify({ v: CHAT_FILE_VERSION }),
    JSON.stringify({ t: 'conv', ...sanitizeInfo(conversation.info) }),
    ...conversation.messages
      .filter((m) => m.state !== 'streaming')
      .map((message) => JSON.stringify({ t: 'msg', message: sanitizeMessage(message) })),
  ]
  writeFileSync(file, `${lines.join('\n')}\n`)
}

export function deleteConversationFile(projectDir: string, conversationId: string): void {
  rmSync(fileOf(projectDir, conversationId), { force: true })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseFile(text: string, expectedId: string): StoredConversation | undefined {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  let head: unknown
  try {
    head = JSON.parse(lines[0] ?? '')
  } catch {
    return undefined
  }
  if (!isRecord(head) || head.v !== CHAT_FILE_VERSION) return undefined
  let info: StoredConversationInfo | undefined
  const order: string[] = []
  const byId = new Map<string, ChatPanelMessage>()
  for (const line of lines.slice(1)) {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(raw)) continue
    if (raw.t === 'conv' && typeof raw.id === 'string' && raw.id === expectedId) {
      const next: StoredConversationInfo = {
        id: expectedId,
        title: typeof raw.title === 'string' ? raw.title : t('chat.newChat'),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        ...(typeof raw.claudeSession === 'string' ? { claudeSession: raw.claudeSession } : {}),
        ...(typeof raw.origin === 'string' ? { origin: raw.origin } : {}),
      }
      info = next
    } else if (raw.t === 'msg') {
      const parsed = ChatPanelMessageSchema.safeParse(raw.message)
      if (!parsed.success) continue
      const message = parsed.data
      // 還在串流的（App 當時被關掉）：當成沒做完
      const fixed: ChatPanelMessage =
        message.state === 'streaming'
          ? { ...message, state: 'error', error: t('chat.thisOneWasnTFinished') }
          : message
      if (!byId.has(fixed.id)) order.push(fixed.id)
      byId.set(fixed.id, fixed)
    }
  }
  if (!info || info.createdAt === '') return undefined
  const messages = order.flatMap((id) => {
    const m = byId.get(id)
    return m ? [m] : []
  })
  return { info, messages }
}

/** 讀這個專案 `chat/` 底下的全部對話（沒有資料夾就是沒有）。 */
export function readConversations(
  projectDir: string,
  warn?: (message: string) => void,
): StoredConversation[] {
  const dir = join(projectDir, CHAT_DIR)
  if (!existsSync(dir)) return []
  const out: StoredConversation[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const id = name.slice(0, -'.jsonl'.length)
    if (!ID.test(id)) continue
    try {
      const parsed = parseFile(readFileSync(join(dir, name), 'utf8'), id)
      if (parsed) out.push(parsed)
      else warn?.(`Skipped a chat record that could not be read: ${name}`)
    } catch (error) {
      warn?.(`Could not read the chat record ${name}: ${String(error)}`)
    }
  }
  return out
}
