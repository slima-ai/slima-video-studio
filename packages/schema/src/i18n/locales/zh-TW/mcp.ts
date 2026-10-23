export const mcp = {
  'mcp.quoted': '「{text}」',
  'mcp.allowanceCard': 'AI 工具的總額度',
  'mcp.claudeDesktopConfigInvalid':
    'Claude Desktop 的設定檔現在不是正確的 JSON，我沒有動它。請先修好它，或手動貼上設定片段。',
  'mcp.noClaudeDesktopHere': '這個系統沒有 Claude Desktop。請改用 Claude Code 的指令。',
  'mcp.cantRunClaudeCommand':
    '沒辦法自己執行 claude 指令（可能還沒安裝 Claude Code，或找不到它）。請把下面的指令貼到終端機。',
  'mcp.portInUse': '埠 {port} 已經被別的程式用了，請換一個埠。',
  'mcp.cantStartConnection': '無法啟動 AI 工具連線，請看 App 的 log。',
} as const
