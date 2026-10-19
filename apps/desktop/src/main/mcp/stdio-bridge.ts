/**
 * stdio ↔ 本機 HTTP 的轉接：給只會「啟動一個指令、用 stdin/stdout 講 MCP」的 AI 工具用（例如 Claude Desktop）。
 * 用 App 自己的 Electron 當 Node 跑這支檔（ELECTRON_RUN_AS_NODE=1），不需要另外安裝任何東西。
 *
 * 它每次都從使用者資料夾重新讀連線埠與 token，所以「換一組新的 token」或改埠之後，
 * 設定檔不用跟著改。這支檔不能 import electron，也不碰服務金鑰。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export const DEFAULT_PORT = 47821

export interface BridgeEnv {
  userDataDir: string
  fetch: typeof fetch
  write: (line: string) => void
}

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
}

const NOT_RUNNING =
  'Slima Video Studio 沒有開著，或沒有允許 AI 工具連線。請打開 App，到「設定 → AI 工具連線」勾選「允許 AI 工具連線」。'

/** 讀目前的連線設定；讀不到（App 還沒跑過、設定壞了）就回 undefined。 */
export function readConnection(userDataDir: string): { url: string; token: string } | undefined {
  try {
    const token = readFileSync(join(userDataDir, 'mcp-token'), 'utf8').trim()
    if (token === '') return undefined
    let port = DEFAULT_PORT
    try {
      const settings = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8')) as {
        mcp?: { port?: unknown }
      }
      if (typeof settings.mcp?.port === 'number') port = settings.mcp.port
    } catch {
      // 沒有設定檔就用預設埠
    }
    return { url: `http://127.0.0.1:${String(port)}/mcp`, token }
  } catch {
    return undefined
  }
}

const rpcError = (id: RpcRequest['id'], message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message } })

/** 轉送一則訊息（stdin 的一行）；回應寫到 write。通知（沒有 id）沒有回應，也不報錯。 */
export async function forward(line: string, env: BridgeEnv): Promise<void> {
  let message: RpcRequest | RpcRequest[]
  try {
    message = JSON.parse(line) as RpcRequest | RpcRequest[]
  } catch {
    env.write(rpcError(null, '收到的不是 JSON。'))
    return
  }
  const first = Array.isArray(message) ? message[0] : message
  const wantsReply = Array.isArray(message)
    ? message.some((m) => m.id !== undefined)
    : message.id !== undefined
  const fail = (text: string): void => {
    if (wantsReply) env.write(rpcError(first?.id, text))
  }
  const connection = readConnection(env.userDataDir)
  if (!connection) return fail(NOT_RUNNING)
  let response: Response
  try {
    response = await env.fetch(connection.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${connection.token}`,
      },
      body: line,
    })
  } catch {
    return fail(NOT_RUNNING)
  }
  if (response.status === 401) {
    return fail('連線 token 不對。請在 App 的「設定 → AI 工具連線」確認連線是開著的。')
  }
  if (response.status === 202 || response.status === 204) return
  const text = await response.text()
  if (!response.ok) return fail(`App 回了錯誤（HTTP ${String(response.status)}）。`)
  if (text.trim() === '') return
  // 伺服器是無狀態＋直接回 JSON；一行一則地寫出去（批次回應是陣列就拆開）
  try {
    const parsed = JSON.parse(text) as unknown
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) env.write(JSON.stringify(item))
  } catch {
    fail('App 回的內容讀不懂。')
  }
}

function userDataFrom(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--user-data')
  return index >= 0 ? argv[index + 1] : undefined
}

/** 直接執行時：stdin 一行一則 JSON-RPC。 */
export function main(argv: readonly string[]): void {
  const userDataDir = userDataFrom(argv)
  if (!userDataDir) {
    process.stderr.write('用法：mcp-stdio-bridge --user-data <App 的使用者資料夾>\n')
    process.exit(2)
  }
  const env: BridgeEnv = {
    userDataDir,
    fetch,
    write: (line) => process.stdout.write(`${line}\n`),
  }
  const pending = new Set<Promise<void>>()
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (line.trim() === '') return
    const task = forward(line, env).finally(() => pending.delete(task))
    pending.add(task)
  })
  // stdin 關了（AI 工具結束）：等還在跑的請求寫完再結束
  rl.on('close', () => {
    void Promise.allSettled([...pending]).then(() => process.exit(0))
  })
}
