import { NARRATION_SHORTEN_MARK, type LlmRequest } from '@svs/schema'

// 示範模式的假「旁白改短」：不呼叫任何模型，把原句截到字數上限內（停在最後一個標點），
// 讓示範專案的旁白太長時也走得完「改短、重念」。

/** 是「旁白改短」請求就回改短的一句，不是就回 undefined。 */
export function demoShortenedLine(request: LlmRequest): string | undefined {
  const message = request.messages.find((m) => m.content.startsWith(NARRATION_SHORTEN_MARK))
  if (!message) return undefined
  const limit = Number(/字數上限 (\d+) 個字/.exec(message.content)?.[1])
  const line = /原句：([\s\S]*)$/.exec(message.content)?.[1]?.trim()
  if (line === undefined || !Number.isFinite(limit)) return undefined
  if (line.length <= limit) return line
  const cut = line.slice(0, Math.max(1, limit - 1))
  // 盡量停在最後一個逗號或句號，沒有就直接截斷再補一個句號
  const stop = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf(','))
  const head = stop >= Math.floor(cut.length / 2) ? cut.slice(0, stop) : cut
  return `${head}。`
}
