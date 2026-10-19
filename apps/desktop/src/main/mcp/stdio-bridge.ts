/**
 * stdio ↔ 本機 HTTP 的轉接：給只會「啟動一個指令、用 stdin/stdout 講 MCP」的 AI 工具用（例如 Claude Desktop）。
 * 用 App 自己的 Electron 當 Node 跑這支檔（ELECTRON_RUN_AS_NODE=1），不需要另外安裝任何東西。
 *
 * 它每次都從使用者資料夾重新讀連線埠與 token，所以「換一組新的 token」或改埠之後，
 * 設定檔不用跟著改。這支檔不能 import electron，也不碰服務金鑰。
 */
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
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

/** 連得上、但等不到回應（App 還在做，或卡住、中途關掉）：不是設定問題，不要叫人去勾設定。 */
const NO_REPLY =
  'Slima Video Studio 還在處理這個動作，或沒有回應。請看 App 的畫面；稍後可以用 get_generation_status 之類的工具確認結果，不需要改任何設定。'

/** 「連不上」的錯誤代碼：App 沒開、埠不對、沒有允許連線。其他的（等太久、中途斷線）都算「沒有回應」。 */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
])

/** 沿著 cause 找 Node 的錯誤代碼（fetch 把真正原因包在 error.cause 裡）。 */
function errorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/** 這個 fetch 例外是「連不上」嗎？ */
export const isUnreachable = (error: unknown): boolean =>
  UNREACHABLE_CODES.has(errorCode(error) ?? '')

/**
 * 等 App 回應的上限。有些工具（念旁白、做配樂、接片、匯出）要等供應商或 FFmpeg，可能超過幾分鐘；
 * 這個上限要比任何一個工具的合理時間都長，但不能是無限（App 當掉不回時，使用者要看得到說明）。
 */
export const REPLY_TIMEOUT_MS = 30 * 60_000

/**
 * 給轉接用的 fetch：用 node:http 直接送，沒有 Node 內建 fetch 的 5 分鐘「等回應標頭」上限
 * （那個上限會把還在做的長工具砍掉）；改成只有自己的 `timeoutMs` 上限，逾時丟 code 為 SVS_REPLY_TIMEOUT 的錯誤。
 */
export function makeNodeFetch(timeoutMs: number = REPLY_TIMEOUT_MS): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      )
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value
      })
      const req = httpRequest(url, { method: init?.method ?? 'GET', headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const body =
            status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks)
          resolve(new Response(body, { status }))
        })
      })
      req.setTimeout(timeoutMs, () => {
        req.destroy(Object.assign(new Error('等 App 回應太久'), { code: 'SVS_REPLY_TIMEOUT' }))
      })
      req.on('error', reject)
      req.end(typeof init?.body === 'string' ? init.body : undefined)
    })
}

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
  if (!connection) {
    fail(NOT_RUNNING)
    return
  }
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
  } catch (error) {
    fail(isUnreachable(error) ? NOT_RUNNING : NO_REPLY)
    return
  }
  if (response.status === 401) {
    fail('連線 token 不對。請在 App 的「設定 → AI 工具連線」確認連線是開著的。')
    return
  }
  if (response.status === 202 || response.status === 204) return
  const text = await response.text()
  if (!response.ok) {
    fail(`App 回了錯誤（HTTP ${String(response.status)}）。`)
    return
  }
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
    fetch: makeNodeFetch(),
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
