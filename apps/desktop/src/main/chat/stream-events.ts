import { SERVER_NAME } from '../mcp/connect'
import { bareToolName } from './tool-labels'

/** 從 `claude -p` 串流事件整理出來、我們要用的訊號（其他的一律忽略：思考、技能清單、用量…）。 */
export type StreamSignal =
  | { kind: 'init'; sessionId: string; mcpConnected: boolean }
  | { kind: 'text'; delta: string }
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
    return [{ kind: 'result', ok: false, interrupted: false, text, error: resultError(subtype) }]
  }
  return []
}

/** 沒做完的一輪，用白話說原因（不貼原始錯誤文字給使用者）。 */
function resultError(subtype: string): string {
  if (subtype === 'error_max_budget_usd') {
    return '這個對話的 Claude 用量到上限了。開一個新對話，或之後再試。'
  }
  if (subtype === 'error_max_turns') return 'Claude 這次做了太多步，先停下來了。可以請它接著做。'
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
