import { main } from './mcp/stdio-bridge'

// 給 AI 工具（Claude Desktop 等）啟動的入口：用 App 自己的 Electron 當 Node 跑（ELECTRON_RUN_AS_NODE=1）
main(process.argv.slice(2))
