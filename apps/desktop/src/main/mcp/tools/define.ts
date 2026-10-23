import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { isAppError } from '@svs/schema'
import type { z } from 'zod'

import type { SettingsStore } from '../../settings/settings-store'
import type { Allowance } from '../allowance'
import { McpToolError, type McpCaller } from '../bridge'
import type { Redactor } from '../redact'
import type { AssetViewer, ViewImage } from '../viewer'
import { settleAllowance } from './settle'

/** 工具共用的東西：只有白名單呼叫器，沒有任何拿得到服務金鑰的路。 */
export interface ToolContext {
  server: McpServer
  caller: McpCaller
  settings: SettingsStore
  allowance: Allowance
  redactor: Redactor
  viewer: AssetViewer
  info: { name: string; version: string }
  /** 已登錄的工具名稱（給 get_capabilities 列出來）。 */
  toolNames: string[]
}

/** 工具除了文字，還想附上幾張圖（縮圖給 AI 看）時，回傳這個。 */
export class WithImages {
  constructor(
    readonly data: unknown,
    readonly images: readonly ViewImage[],
  ) {}
}

export interface ToolSpec<Shape extends z.ZodRawShape> {
  /** snake_case 動詞開頭，跟 slima-mcp 一致（list_books、read_file…）。 */
  name: string
  title: string
  description: string
  input: Shape
  /** 唯讀、會刪東西、重複呼叫是否同樣結果。 */
  hints: { readOnly: boolean; destructive?: boolean; idempotent?: boolean }
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>
}

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

/** 登錄一個工具：回傳值轉成 JSON 文字並過遮蔽；失敗一律變成白話錯誤（不丟出去、不帶供應商原始訊息）。 */
export function defineTool<Shape extends z.ZodRawShape>(
  ctx: ToolContext,
  spec: ToolSpec<Shape>,
): void {
  ctx.toolNames.push(spec.name)
  ctx.server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: {
        readOnlyHint: spec.hints.readOnly,
        destructiveHint: spec.hints.destructive ?? false,
        idempotentHint: spec.hints.idempotent ?? spec.hints.readOnly,
        openWorldHint: false,
      },
    },
    // SDK 的泛型對不上 Shape（zod 3／4 相容層）；輸入已經由 SDK 依 inputSchema 驗證過才會進來
    (async (args: unknown): Promise<CallToolResult> => {
      try {
        // 先把上一批做完的預留改成實際花費，這次的額度檢查才看得到退回的錢。
        // 只在呼叫前結算，不在呼叫後：剛啟動的背景生成可能還沒進佇列，那時結算會把還沒花的錢當成沒花而退掉
        await settleAllowance(ctx)
        const out = await spec.run(args as z.infer<z.ZodObject<Shape>>)
        const data = out instanceof WithImages ? out.data : out
        const result = textResult(ctx.redactor.redact(JSON.stringify(data ?? null, null, 2)))
        if (out instanceof WithImages) {
          result.content.push(
            ...out.images.map((image) => ({
              type: 'image' as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          )
        }
        return result
      } catch (error) {
        // 錯誤訊息也要過遮蔽：訊息可能把輸入（例如有人把金鑰當成專案代號塞進來）原樣帶回去
        const fail = (message: string): CallToolResult =>
          textResult(ctx.redactor.redact(`Error: ${message}`), true)
        if (error instanceof McpToolError) return fail(error.message)
        if (isAppError(error)) return fail(error.userMessage)
        return textResult('Error: An unexpected error happened. Please try again later.', true)
      }
    }) as never,
  )
}
