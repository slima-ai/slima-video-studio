import { AppError, type ChatMessage, type LlmRequest } from '@svs/schema'
import { z } from 'zod'

import type { GenerateContext, StudioServices } from './services'

export interface StructuredResult<T> {
  data: T
  /** 所有嘗試加總的實際花費（沒有任何一次回報就是 undefined）。 */
  costUsd: number | undefined
  provider: string
  /** 最後一次呼叫的任務 ID。 */
  jobId: string
}

/** 模型常把 JSON 包在 ```json 裡，先拿掉再解析。 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  return JSON.parse((fenced?.[1] ?? text).trim())
}

/**
 * 請 LLM 依 schema 輸出 JSON，並用 Zod 驗證。格式不對時把錯誤告訴模型、自動重試一次，
 * 還是不對就回報給使用者（不會把不合格式的資料往下傳）。
 */
export async function generateStructured<S extends z.ZodType>(
  studio: StudioServices,
  request: Omit<LlmRequest, 'capability' | 'jsonSchema'>,
  schema: S,
  ctx: GenerateContext,
): Promise<StructuredResult<z.output<S>>> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  let messages: ChatMessage[] = request.messages
  let cost: number | undefined
  let lastProblem = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await studio.generate(
      { ...request, messages, capability: 'llm', jsonSchema },
      ctx,
    )
    if (result.costUsd !== undefined) cost = (cost ?? 0) + result.costUsd
    if (result.output.kind !== 'text') {
      throw new AppError({ code: 'invalid_response', userMessage: '模型沒有回傳文字。' })
    }
    const text = result.output.text
    try {
      const parsed = schema.safeParse(extractJson(text))
      if (parsed.success)
        return { data: parsed.data, costUsd: cost, provider: result.provider, jobId: result.jobId }
      lastProblem = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(根)'}：${i.message}`)
        .join('；')
    } catch {
      lastProblem = '不是合法的 JSON'
    }
    messages = [
      ...request.messages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `上一個回答的格式不對（${lastProblem}）。請只輸出符合格式的 JSON，不要加任何說明。`,
      },
    ]
  }
  throw new AppError({
    code: 'invalid_response',
    retryable: true,
    userMessage: '模型回傳的內容格式不對，已自動重試一次仍然失敗，請再試一次。',
    cause: new Error(lastProblem),
  })
}
