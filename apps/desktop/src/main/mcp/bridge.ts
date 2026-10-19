import type { IpcChannel, IpcParsedRequest, IpcResponse } from '@svs/schema'

import type { HandlerContext, IpcRegistry } from '../ipc/registry'

/** 工具呼叫失敗：訊息是給使用者／AI 看的白話文字（來自 AppError 的 userMessage），不含供應商原始錯誤。 */
export class McpToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'McpToolError'
  }
}

/**
 * MCP 可以呼叫的 IPC 通道（白名單）。App 自己的畫面用同一份 IPC 合約與同一個 registry，
 * 所以 AI 工具改了東西，畫面會一起更新；但**只有這裡列的通道**可以被 MCP 呼叫。
 * 永遠不會列進來的：`keys.*`（服務金鑰）、`settings.update`（含花費上限與 AI 工具額度）、`mcp.*`、
 * `slima.connect`（Token）、`dev.*`、`project.reveal`／`files.reveal`（會打開檔案總管）、
 * `canvas.importFiles`／`canvas.importBytes`（任意檔案路徑與位元組）。
 */
export const MCP_CHANNELS = [
  'project.list',
  'project.current',
  'project.createNew',
  'project.open',
  'models.list',
] as const satisfies readonly IpcChannel[]

export type McpChannel = (typeof MCP_CHANNELS)[number]

export interface McpCaller {
  call: <C extends McpChannel>(channel: C, payload: IpcParsedRequest<C>) => Promise<IpcResponse<C>>
}

/**
 * 把 registry 包成「只能呼叫白名單通道」的呼叫器；失敗一律丟 McpToolError。
 * `emit` 是 handler 發事件的出口：AI 工具改了東西，App 的視窗要跟著更新（例如換專案、大綱變了），
 * 所以接到會廣播給所有視窗的函式。
 */
export function createMcpCaller(
  registry: IpcRegistry,
  emit: HandlerContext['emit'] = () => undefined,
  allowed: readonly IpcChannel[] = MCP_CHANNELS,
): McpCaller {
  const allowSet = new Set<string>(allowed)
  const ctx: HandlerContext = { emit }
  return {
    call: async (channel, payload) => {
      if (!allowSet.has(channel)) {
        throw new McpToolError(`這個功能不開放給 AI 工具（${channel}）。`, 'not_allowed')
      }
      const result = await registry.dispatch({ channel, payload }, ctx)
      if (!result.ok) throw new McpToolError(result.error.userMessage, result.error.code)
      return result.data as IpcResponse<typeof channel>
    },
  }
}
