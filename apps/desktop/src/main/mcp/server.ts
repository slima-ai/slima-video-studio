import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { Logger } from '../logger'
import type { Redactor } from './redact'
import { RedactingTransport } from './redacting-transport'

export interface McpHttpOptions {
  port: number
  /** 目前有效的 token（每次請求都重新讀，換了 token 立刻生效）。 */
  token: () => string
  /** 每個請求建一個新的 MCP 伺服器（無狀態：工具都不需要跨請求的連線狀態）。 */
  createMcpServer: () => McpServer
  /** 所有送出的訊息都先過這個遮蔽（金鑰、token）。 */
  redactor: Redactor
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 每個過了檢查（本機、token 對、內容是 JSON）的請求；`client` 只有 initialize 才有（對方自己報的名字）。 */
  onRequest?: (info: { client?: string }) => void
}

export interface McpHttp {
  start: () => Promise<{ port: number }>
  stop: () => Promise<void>
}

const MCP_PATH = '/mcp'
const MAX_BODY_BYTES = 4 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Host 標頭必須是本機位址加上我們的埠（擋 DNS rebinding：別人的網域被解析成 127.0.0.1 時，Host 會是他的網域）。 */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  const match = /^(\[::1\]|[^:]+)(?::(\d+))?$/.exec(host.toLowerCase())
  if (!match?.[1]) return false
  return LOOPBACK_HOSTS.has(match[1]) && Number(match[2] ?? '80') === port
}

/** 有 Origin 標頭（瀏覽器發的跨站請求）時，來源也必須是本機；命令列工具不會帶 Origin。 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** 常數時間比對（先各自雜湊成等長，避免從回應時間猜出 token）。 */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match?.[1]) return false
  const a = createHash('sha256').update(match[1]).digest()
  const b = createHash('sha256').update(token).digest()
  return timingSafeEqual(a, b)
}

/** initialize 請求裡對方報的名字（其他請求沒有）。 */
export function clientOf(body: unknown): { client?: string } {
  if (typeof body !== 'object' || body === null) return {}
  const { method, params } = body as { method?: unknown; params?: unknown }
  if (method !== 'initialize' || typeof params !== 'object' || params === null) return {}
  const info = (params as { clientInfo?: unknown }).clientInfo
  if (typeof info !== 'object' || info === null) return {}
  const name = (info as { name?: unknown }).name
  return typeof name === 'string' && name !== '' ? { client: name.slice(0, 64) } : {}
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(body)
}

const jsonRpcError = (message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 本機 MCP 伺服器（Streamable HTTP，無狀態）：只聽 127.0.0.1。每個請求依序檢查：
 * Host 與 Origin 必須是本機 → 要帶正確的 Bearer token → 路徑與方法 → 內容大小與格式。
 * 任何一項不符都不會進到 MCP 伺服器。
 */
export function createMcpHttp(options: McpHttpOptions): McpHttp {
  const { log } = options
  let http: Server | undefined
  let boundPort = options.port

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isAllowedHost(req.headers.host, boundPort) || !isAllowedOrigin(req.headers.origin)) {
      send(res, 403, jsonRpcError('Forbidden'))
      return
    }
    if (!tokenMatches(req.headers.authorization, options.token())) {
      send(res, 401, jsonRpcError('Unauthorized'), { 'WWW-Authenticate': 'Bearer' })
      return
    }
    if ((req.url ?? '').split('?')[0] !== MCP_PATH) {
      send(res, 404, jsonRpcError('Not found'))
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, jsonRpcError('Method not allowed'), { Allow: 'POST' })
      return
    }
    let body: unknown
    try {
      body = await readBody(req)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body too large'
      send(res, tooLarge ? 413 : 400, jsonRpcError(tooLarge ? 'Payload too large' : 'Invalid JSON'))
      return
    }
    options.onRequest?.(clientOf(body))
    const server = options.createMcpServer()
    // 無狀態模式要明確傳 sessionIdGenerator: undefined（SDK 官方寫法）
    // @ts-expect-error SDK 的選項型別與 exactOptionalPropertyTypes 不相容，不接受明確的 undefined
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    // @ts-expect-error SDK 的 Transport 型別與 exactOptionalPropertyTypes 不相容（onclose 等欄位）
    await server.connect(new RedactingTransport(transport, options.redactor))
    await transport.handleRequest(req, res, body)
  }

  return {
    start: () =>
      new Promise((resolve, reject) => {
        if (http) {
          resolve({ port: boundPort })
          return
        }
        const instance = createServer((req, res) => {
          handle(req, res).catch((error: unknown) => {
            log.error(`MCP 請求處理失敗：${error instanceof Error ? error.message : String(error)}`)
            if (!res.headersSent) send(res, 500, jsonRpcError('Internal error'))
            else res.end()
          })
        })
        instance.once('error', reject)
        // 只綁 127.0.0.1：同一個網段的其他電腦連不到
        instance.listen(options.port, '127.0.0.1', () => {
          instance.removeListener('error', reject)
          const address = instance.address()
          boundPort = typeof address === 'object' && address ? address.port : options.port
          http = instance
          log.info(`MCP 伺服器開始在 127.0.0.1:${String(boundPort)} 聽`)
          resolve({ port: boundPort })
        })
      }),
    stop: () =>
      new Promise((resolve) => {
        const instance = http
        http = undefined
        if (!instance) {
          resolve()
          return
        }
        instance.close(() => {
          log.info('MCP 伺服器已停止')
          resolve()
        })
        instance.closeAllConnections()
      }),
  }
}
