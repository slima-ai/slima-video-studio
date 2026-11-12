import { NARRATION_SHORTEN_MARK } from '@svs/schema'

// 旁白念完比格子長：請文字模型把那一句改短（只改字，不改意思），再重念一次。
// 這兩段字會進節點輸入與生成紀錄，所以用雜湊釘住（prompts-golden.test.ts）。

export const NARRATION_SHORTEN_SYSTEM =
  '你是旁白編輯。使用者給你一句要念出來的旁白，請改短：意思與語氣不變，不加新的資訊，不加引號、編號或任何說明，只輸出改短後的那一句。用原句的語言寫。'

/** 改短請求的使用者訊息；示範模式的假模型也從這裡讀字數上限與原句。 */
export function narrationShortenMessage(input: {
  line: string
  /** 鏡頭放得下旁白的秒數。 */
  roomSec: number
  /** 改短後最多幾個字（含標點）。 */
  maxChars: number
}): string {
  const room = String(Math.round(input.roomSec * 10) / 10)
  return `${NARRATION_SHORTEN_MARK}。這句旁白要在 ${room} 秒內念完，字數上限 ${String(input.maxChars)} 個字（含標點）。\n原句：${input.line}`
}

/**
 * 把模型的回答整理成一句旁白：拿掉程式碼框與引號、只取第一個非空的行。
 * 空的、或沒有比原句短，就回 undefined（不重念）。
 */
export function cleanShortenedLine(reply: string, original: string): string | undefined {
  const unfenced = reply.replace(/```[a-z]*\n?/gi, '')
  const first = unfenced
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  if (first === undefined) return undefined
  const line = first.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, '').trim()
  if (line === '' || line.length >= original.trim().length) return undefined
  return line
}
