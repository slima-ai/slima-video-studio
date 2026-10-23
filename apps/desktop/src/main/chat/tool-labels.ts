import { chatToolDoingLabel, chatToolLabel, hasChatToolLabel } from '@svs/schema'

import { SERVER_NAME } from '../mcp/connect'

/** Claude 看到的工具名前綴：`mcp__<伺服器名>__<工具名>`。 */
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/** 去掉前綴；不是我們的工具（理論上不會，白名單只開我們的）就原樣回傳。 */
export const bareToolName = (name: string): string =>
  name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name

/** 工具名換成白話的對照表在 @svs/schema（畫面也要用，顯示的當下才翻）；主行程這邊照舊用這幾個名字。 */
export const hasToolLabel = hasChatToolLabel
export const toolLabel = chatToolLabel
export const toolDoingLabel = chatToolDoingLabel
