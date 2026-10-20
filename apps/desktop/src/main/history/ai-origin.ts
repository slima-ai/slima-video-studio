import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * 這個呼叫是不是 AI 工具（MCP）發起的。復原紀錄靠它分辨「Claude 做的」和「使用者自己做的」：
 * Claude 一輪裡的改動併成一步，使用者的操作照舊各是一步。只有 MCP 呼叫器會進這個範圍（見 mcp/bridge.ts），
 * 畫面來的 IPC 呼叫不會。
 */
const store = new AsyncLocalStorage<true>()

export const runAsAi = <T>(run: () => T): T => store.run(true, run)
export const isAiCall = (): boolean => store.getStore() === true
