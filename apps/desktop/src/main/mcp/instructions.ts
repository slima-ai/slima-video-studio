/**
 * MCP `instructions`：每個工作階段都會付這段長度，所以只寫「這是什麼、先呼叫哪個工具」，
 * 細節放進 `load_guide`（比照 slima-mcp 的做法）。
 */
export const SERVER_INSTRUCTIONS = `Slima Video Studio turns a story into a finished video on the user's own computer. You are connected to the user's running copy of the app; what you change shows up in its window.

**Start by calling \`get_capabilities\`.** It tells you the mode (demo or real), the current project, how much you may spend, and which tools and guides exist. Then \`load_guide\` what you need: \`getting-started\` for the order of work, \`storyboard\` before planning shots, \`cinematography\` before choosing shot size, angle or camera move, \`spending\` before anything that calls an AI model.

Three things worth knowing:
- **Spending is limited by the user, not by you.** Tools that call an AI model are checked against an allowance only the user can change (it starts at US$0). In demo mode nothing costs money.
- **Some tools switch what the user sees** (open_project, create_project). Say so before you use them.
- You never see or handle API keys; no tool returns them.`
