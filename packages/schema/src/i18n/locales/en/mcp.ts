export const mcp = {
  'mcp.quoted': '“{text}”',
  'mcp.allowanceCard': 'Total allowance for AI tools',
  'mcp.claudeDesktopConfigInvalid':
    'The Claude Desktop settings file isn’t valid JSON right now, so I didn’t change it. Fix it first, or paste the settings snippet by hand.',
  'mcp.noClaudeDesktopHere':
    'Claude Desktop isn’t available on this system. Use the Claude Code command instead.',
  'mcp.cantRunClaudeCommand':
    'Couldn’t run the claude command myself (Claude Code may not be installed, or I couldn’t find it). Paste the command below into a terminal.',
  'mcp.portInUse': 'Port {port} is already used by another program. Pick a different port.',
  'mcp.cantStartConnection': 'Couldn’t start the AI tools connection. Check the app’s log.',
} as const
