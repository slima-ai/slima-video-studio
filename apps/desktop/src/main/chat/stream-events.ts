import { CHAT_BUDGET_DEFAULT_USD } from '@svs/schema'

import { SERVER_NAME } from '../mcp/connect'
import { bareToolName } from './tool-labels'

/** 從 `claude -p` 串流事件整理出來、我們要用的訊號（其他的一律忽略：思考、技能清單、用量…）。 */
export type StreamSignal =
  | { kind: 'init'; sessionId: string; mcpConnected: boolean }
  | { kind: 'text'; delta: string }
  /** 一段新的文字開始（Claude 一輪裡文字與工具呼叫交錯，每一段文字是一個區塊）：畫面上兩段之間要隔開，不能黏在一起。 */
  | { kind: 'text_start' }
  | { kind: 'tool_start'; id: string; tool: string }
  | { kind: 'tool_result'; id: string; ok: boolean; summary: string }
  | { kind: 'auth_failed' }
  | {
      kind: 'result'
      /** 這一輪正常做完。 */
      ok: boolean
      /** 被使用者停止（interrupt）。 */
      interrupted: boolean
      /** 這一輪最後的回覆文字。 */
      text: string
      /** 沒做完時的白話原因。 */
      error?: string
      /** 是因為用量或步數到上限才停：換新行程接著做就能繼續。 */
      resumable?: boolean
      /** 停下來的原因是用量到上限（要把目前的上限數字寫進給使用者的說明）。 */
      budgetLimit?: boolean
    }

const SUMMARY_MAX = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 工具結果的內容（字串或區塊陣列）變成短摘要：文字取前 200 字，圖片只寫「（圖片）」。 */
function summarize(content: unknown): string {
  const parts: string[] = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const block of content as unknown[]) {
      if (!isRecord(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      else if (block.type === 'image') parts.push('（圖片）')
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
}

/** 一則串流事件（已解析成物件）→ 我們要用的訊號。主對話以外（子代理）的事件忽略。 */
export function signalsOf(event: unknown): StreamSignal[] {
  if (!isRecord(event)) return []
  if (event.parent_tool_use_id !== null && event.parent_tool_use_id !== undefined) return []
  const type = event.type
  if (type === 'system') {
    if (event.subtype === 'init') {
      const servers = Array.isArray(event.mcp_servers) ? (event.mcp_servers as unknown[]) : []
      const ours = servers.find((s) => isRecord(s) && s.name === SERVER_NAME)
      return [
        {
          kind: 'init',
          sessionId: typeof event.session_id === 'string' ? event.session_id : '',
          mcpConnected: isRecord(ours) && ours.status === 'connected',
        },
      ]
    }
    if (event.subtype === 'api_retry' && event.error === 'authentication_failed') {
      return [{ kind: 'auth_failed' }]
    }
    return []
  }
  if (type === 'stream_event' && isRecord(event.event)) {
    const inner = event.event
    if (inner.type === 'content_block_delta' && isRecord(inner.delta)) {
      const { delta } = inner
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
        return [{ kind: 'text', delta: delta.text }]
      }
      return []
    }
    // 工具一開始就顯示（參數還在長，不等完整訊息）
    if (inner.type === 'content_block_start' && isRecord(inner.content_block)) {
      const block = inner.content_block
      if (block.type === 'text') return [{ kind: 'text_start' }]
      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        return [{ kind: 'tool_start', id: block.id, tool: bareToolName(block.name) }]
      }
    }
    return []
  }
  if (type === 'assistant' && isRecord(event.message) && Array.isArray(event.message.content)) {
    // 完整訊息裡的 tool_use：串流事件漏掉時的保險（呼叫端用 id 去重）
    const out: StreamSignal[] = []
    for (const block of event.message.content as unknown[]) {
      if (isRecord(block) && block.type === 'tool_use') {
        if (typeof block.id === 'string' && typeof block.name === 'string') {
          out.push({ kind: 'tool_start', id: block.id, tool: bareToolName(block.name) })
        }
      }
    }
    return out
  }
  if (type === 'user' && isRecord(event.message) && Array.isArray(event.message.content)) {
    const out: StreamSignal[] = []
    for (const block of event.message.content as unknown[]) {
      if (
        isRecord(block) &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        out.push({
          kind: 'tool_result',
          id: block.tool_use_id,
          ok: block.is_error !== true,
          summary: summarize(block.content),
        })
      }
    }
    return out
  }
  if (type === 'result') {
    const subtype = typeof event.subtype === 'string' ? event.subtype : ''
    const text = typeof event.result === 'string' ? event.result : ''
    const interrupted = event.terminal_reason === 'aborted_streaming'
    if (event.is_error !== true && subtype === 'success') {
      return [{ kind: 'result', ok: true, interrupted: false, text }]
    }
    if (interrupted) return [{ kind: 'result', ok: false, interrupted: true, text }]
    return [
      {
        kind: 'result',
        ok: false,
        interrupted: false,
        text,
        error: resultError(subtype),
        ...(isResumable(subtype) ? { resumable: true } : {}),
        ...(subtype === 'error_max_budget_usd' ? { budgetLimit: true } : {}),
      },
    ]
  }
  return []
}

/** 用量或步數到上限：不是壞了，換一個新行程（--resume 接回同一個對話）就能接著做。 */
const isResumable = (subtype: string): boolean =>
  subtype === 'error_max_budget_usd' || subtype === 'error_max_turns'

/**
 * 撞到每一段用量上限時給使用者看的說明：這是他自己的 Claude 用量、上限現在是多少（從設定讀、不寫死）、
 * 去哪裡調；「跟生成圖片、影片的額度是兩回事」保留。
 */
export function budgetLimitMessage(limitUsd: number): string {
  const usd = String(Math.round(limitUsd * 100) / 100)
  return `這是你自己的 Claude 用量，這一段用到上限了（目前每一段上限約 US$${usd}，跟生成圖片、影片的額度是兩回事）。要調高，到「設定 → 實驗功能」。按「繼續」只會接著做你剛才那句話，不會多做別的。`
}

/** 沒做完的一輪，用白話說原因（不貼原始錯誤文字給使用者）。 */
function resultError(subtype: string): string {
  if (subtype === 'error_max_budget_usd') {
    return budgetLimitMessage(CHAT_BUDGET_DEFAULT_USD)
  }
  if (subtype === 'error_max_turns')
    return 'Claude 這次做了太多步，先停下來了。按「繼續」，它會接著做。'
  return 'Claude 這次沒有做完，請再試一次。'
}

/** 把標準輸出的片段拼成一行一行（換行分隔的 JSON）；壞掉的行略過。 */
export function createLineParser(onEvent: (event: unknown) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line === '') continue
      try {
        onEvent(JSON.parse(line))
      } catch {
        // 不是 JSON 的行（理論上不會有）：略過，不讓一行壞資料中斷整個對話
      }
    }
  }
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u
/** 一段文字最長這麼長才可能是「工作筆記」（長的是真的在回答使用者）。 */
const NOTE_MAX_CHARS = 240

/** 模型有時把「要呼叫工具」的標記當成文字吐出來（`<invoke name="…">…</invoke>`、`<function_calls>`、`<parameter>`）。 */
const TOOL_MARKUP_NAMES = '(?:antml:)?(?:function_calls|invoke|parameter)'
const TOOL_MARKUP_BLOCK = new RegExp(
  `<${TOOL_MARKUP_NAMES}\\b[^>]*>[\\s\\S]*?</${TOOL_MARKUP_NAMES}>`,
  'g',
)
const TOOL_MARKUP_TAG = new RegExp(`</?${TOOL_MARKUP_NAMES}\\b[^>]*>`, 'g')
/** 還沒收完的標記（串流到一半，結尾的標籤還沒來）：從開頭的 `<invoke` 起到尾巴都先不顯示。 */
const TOOL_MARKUP_OPEN = new RegExp(`<${TOOL_MARKUP_NAMES}\\b[\\s\\S]*$`)

/**
 * 去掉文字裡的工具呼叫標記（整段、零散的標籤、串流到一半的開頭）；那不是要給使用者看的話，也不是「工作筆記」，
 * 不管多長都不顯示。模型吐出這種標記是它自己的小毛病（真正的工具呼叫另走 tool_use 事件，不受影響）。
 */
export function stripToolMarkup(text: string): string {
  if (!text.includes('<')) return text
  return text
    .replace(TOOL_MARKUP_BLOCK, '')
    .replace(TOOL_MARKUP_TAG, '')
    .replace(TOOL_MARKUP_OPEN, '')
}

/**
 * Claude 一輪裡文字與工具交錯，每一段文字是一個區塊；它有時把工作筆記寫成一段英文
 * （「Ignore the session USD budget note? …」「User explicitly asked; proceed.」）。
 * 這一輪回覆的**其他段落有中文**、而這一段**很短、沒有中文**時，把它收成「工作筆記」（畫面上收起來、點了看原文）。
 * 使用者用英文聊、整則回覆都是英文時，一段都不收（不然會把英文使用者的回答收掉）。
 *
 * 串流途中（`assumeCjk`）：使用者是用中文講的，那就先當這一輪會有中文——第一段英文筆記串流出來的當下，
 * 後面的中文段落還沒來，不先這樣判斷，那段英文會整段露出來、等中文來了才收起來。這一輪結束時要用不帶
 * `assumeCjk` 的結果重算一次：整則都是短英文的回覆（模型沒照使用者的語言回）才不會被全部收光。
 * 回傳：留在回覆文字裡的（段落之間空一行）與收起來的筆記（原文）。
 */
export function splitNotes(
  segments: readonly string[],
  options: { assumeCjk?: boolean } = {},
): { text: string; notes: string[] } {
  const clean = segments.map(stripToolMarkup)
  const hasCjk = options.assumeCjk === true || clean.some((segment) => CJK.test(segment))
  const kept: string[] = []
  const notes: string[] = []
  for (const segment of clean) {
    const t = segment.trim()
    if (t === '') continue
    if (hasCjk && t.length <= NOTE_MAX_CHARS && !CJK.test(t)) notes.push(t)
    else kept.push(t)
  }
  return { text: kept.join('\n\n'), notes }
}

/** 使用者這句話裡有沒有中日韓文字（用來猜這一輪的回覆語言）。 */
export const hasCjk = (text: string): boolean => CJK.test(text)
