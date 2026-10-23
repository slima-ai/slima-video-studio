import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { SettingsStore } from '../settings/settings-store'
import type { Allowance } from './allowance'
import type { McpCaller } from './bridge'
import { serverInstructions } from './instructions'
import type { Redactor } from './redact'
import type { AssetViewer } from './viewer'
import { registerAllTools } from './tools'

export interface McpServerDeps {
  caller: McpCaller
  settings: SettingsStore
  allowance: Allowance
  redactor: Redactor
  viewer: AssetViewer
  info: { name: string; version: string }
}

/** 建一個 MCP 伺服器並登錄所有工具（每個 HTTP 請求建一個，工具之間不共用連線狀態）。 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'slima-video-studio', version: deps.info.version },
    { instructions: serverInstructions() },
  )
  registerAllTools({ ...deps, server, toolNames: [] })
  return server
}
