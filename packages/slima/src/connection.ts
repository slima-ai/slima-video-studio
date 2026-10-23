import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AppError, type SlimaStatus, t } from '@svs/schema'

import { isSlimaReadTool, SLIMA_READ_TOOLS } from './tools'

export interface SlimaLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface SlimaConnectionDeps {
  /** 怎麼啟動 slima-mcp 的 stdio 伺服器（由 App 決定用哪個 Node／Electron 執行檔）。 */
  launch: (token: string) => SlimaLaunch
  /** 目前的 Token；沒有就不連線。 */
  token: () => string | undefined
  log: {
    info: (message: string) => void
    warn: (message: string) => void
  }
  onStatus?: (status: SlimaStatus) => void
  /** 子行程掛掉或連不上時，每次重試前等多久（用完後一直用最後一個）。 */
  backoffMs?: readonly number[]
  connectTimeoutMs?: number
  callTimeoutMs?: number
}

export interface SlimaConnection {
  status: () => SlimaStatus
  /** 有 Token 就連線；沒有就維持「沒有 Token」。重複呼叫不會多開子行程。 */
  start: () => Promise<void>
  /** Token 換了或清掉之後，重新連線。 */
  restart: () => Promise<void>
  stop: () => Promise<void>
  /** 呼叫白名單內的唯讀工具，回傳文字內容。 */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<string>
  /** 目前子行程的 pid（診斷與測試用）。 */
  pid: () => number | null
}

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000] as const
const AUTH_ERROR = /Invalid API token|API token has expired|API token has been revoked/i
const RATE_LIMITED = /^Rate limited/i

const unavailable = (userMessage: string): AppError =>
  new AppError({ code: 'slima_unavailable', userMessage, retryable: true })

const authFailed = (): AppError =>
  new AppError({
    code: 'slima_auth_failed',
    userMessage: t('errors.slimaDidnTAcceptThis'),
  })

function textOf(result: object): string {
  const content: unknown = 'content' in result ? result.content : undefined
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) =>
      typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .join('\n')
}

/** 管理 slima-mcp 子行程與 MCP 連線：只讀、有 Token 才連、掛掉會自己重連。 */
export function createSlimaConnection(deps: SlimaConnectionDeps): SlimaConnection {
  const backoff = deps.backoffMs ?? DEFAULT_BACKOFF
  const connectTimeout = deps.connectTimeoutMs ?? 20_000
  const callTimeout = deps.callTimeoutMs ?? 60_000
  const note = (level: 'info' | 'warn', message: string, data?: Record<string, unknown>): void => {
    deps.log[level](data ? `${message} ${JSON.stringify(data)}` : message)
  }

  let status: SlimaStatus = { state: 'no_token' }
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  let generation = 0
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let starting: Promise<void> | undefined

  const setStatus = (next: SlimaStatus): void => {
    status = next
    deps.onStatus?.(next)
  }

  const last4Of = (token: string): { last4?: string } =>
    token.length >= 12 ? { last4: token.slice(-4) } : {}

  const closeClient = async (): Promise<void> => {
    const old = client
    client = undefined
    transport = undefined
    if (old) await old.close().catch(() => undefined)
  }

  const scheduleRetry = (message: string, token: string): void => {
    if (timer) return
    const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 1_000
    attempt += 1
    setStatus({ state: 'error', message, ...last4Of(token) })
    const mine = generation
    timer = setTimeout(() => {
      timer = undefined
      if (mine === generation) void start()
    }, delay)
    timer.unref()
  }

  async function connect(token: string): Promise<void> {
    const mine = generation
    setStatus({ state: 'connecting', message: t('errors.connectingToSlima'), ...last4Of(token) })
    const launch = deps.launch(token)
    const nextTransport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: launch.env,
      stderr: 'pipe',
    })
    const nextClient = new Client({ name: 'slima-video-studio', version: '0.0.0' })
    nextClient.onclose = () => {
      if (mine !== generation || client !== nextClient) return
      client = undefined
      transport = undefined
      note('warn', 'slima-mcp subprocess stopped; about to reconnect')
      scheduleRetry(t('errors.theConnectionToSlimaWas'), token)
    }
    nextClient.onerror = (error) => {
      note('warn', 'slima-mcp connection error', { message: error.message })
    }
    nextTransport.stderr?.on('data', (chunk: Buffer) => {
      note('info', 'slima-mcp stderr', { text: chunk.toString().replaceAll(token, '***').trim() })
    })
    client = nextClient
    transport = nextTransport

    try {
      await nextClient.connect(nextTransport, { timeout: connectTimeout })
      if (mine !== generation) return
      // 子行程起得來不代表 Token 有效：呼叫一次 list_books 確認
      const probe = await nextClient.callTool({ name: 'list_books', arguments: {} }, undefined, {
        timeout: connectTimeout,
      })
      if (mine !== generation) return
      const text = textOf(probe)
      if (probe.isError === true && AUTH_ERROR.test(text)) {
        await closeClient()
        setStatus({
          state: 'error',
          message: authFailed().userMessage,
          ...last4Of(token),
        })
        return
      }
      if (probe.isError === true) throw new Error(text)
      attempt = 0
      setStatus({ state: 'ready', toolCount: SLIMA_READ_TOOLS.length, ...last4Of(token) })
    } catch (error) {
      if (mine !== generation) return
      note('warn', 'Failed to connect to slima-mcp', {
        message: error instanceof Error ? error.message.replaceAll(token, '***') : 'unknown',
      })
      await closeClient()
      scheduleRetry(t('errors.couldnTReachSlimaCheck'), token)
    }
  }

  async function start(): Promise<void> {
    if (starting) return starting
    const token = deps.token()
    if (!token) {
      setStatus({ state: 'no_token' })
      return
    }
    if (client && status.state === 'ready') return
    starting = connect(token).finally(() => {
      starting = undefined
    })
    return starting
  }

  async function stop(): Promise<void> {
    generation += 1
    attempt = 0
    if (timer) clearTimeout(timer)
    timer = undefined
    await starting?.catch(() => undefined)
    await closeClient()
    setStatus(
      deps.token() ? { state: 'error', message: t('errors.disconnected') } : { state: 'no_token' },
    )
  }

  return {
    status: () => status,
    start,
    stop,

    async restart() {
      generation += 1
      attempt = 0
      if (timer) clearTimeout(timer)
      timer = undefined
      await starting?.catch(() => undefined)
      await closeClient()
      await start()
    },

    async callTool(name, args = {}) {
      if (!isSlimaReadTool(name)) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('errors.theSlimaToolIsnT', { name }),
        })
      }
      if (status.state === 'no_token') {
        throw unavailable(t('errors.theSlimaTokenIsnT'))
      }
      const current = client
      if (!current || status.state !== 'ready') {
        throw unavailable(status.message ?? t('errors.notConnectedToSlimaYet'))
      }
      let result
      try {
        result = await current.callTool({ name, arguments: args }, undefined, {
          timeout: callTimeout,
        })
      } catch (error) {
        note('warn', 'Calling the Slima tool failed', {
          tool: name,
          message: error instanceof Error ? error.message : 'unknown',
        })
        throw unavailable(t('errors.slimaDidnTRespondPlease'))
      }
      const text = textOf(result)
      if (result.isError === true) {
        if (AUTH_ERROR.test(text)) {
          setStatus({ state: 'error', message: authFailed().userMessage })
          throw authFailed()
        }
        note('warn', 'The Slima tool returned an error', { tool: name, text: text.slice(0, 300) })
        throw unavailable(
          RATE_LIMITED.test(text)
            ? t('errors.slimaIsGettingTooMany')
            : t('errors.slimaReportedAnErrorPlease'),
        )
      }
      return text
    },

    pid: () => transport?.pid ?? null,
  }
}
