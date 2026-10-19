import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { forward, makeNodeFetch, readConnection, type BridgeEnv } from './stdio-bridge'
import { freePort, startRealMcp } from './test-support'

const dirs: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  for (const c of closers.splice(0)) await c()
})

function userData(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'svs-bridge-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

const envOf = (dir: string): { env: BridgeEnv; out: Record<string, unknown>[] } => {
  const out: Record<string, unknown>[] = []
  return {
    env: {
      userDataDir: dir,
      fetch,
      write: (line) => {
        out.push(JSON.parse(line) as Record<string, unknown>)
      },
    },
    out,
  }
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bridge-test', version: '1' },
  },
})

describe('stdio 轉接：連線設定', () => {
  it('從使用者資料夾讀 token 與埠；沒有設定檔用預設埠；沒有 token 就是沒連線', () => {
    const dir = userData({ 'mcp-token': 'svs_abc\n', 'settings.json': '{"mcp":{"port":50123}}' })
    expect(readConnection(dir)).toEqual({ url: 'http://127.0.0.1:50123/mcp', token: 'svs_abc' })
    const noSettings = userData({ 'mcp-token': 'svs_abc' })
    expect(readConnection(noSettings)?.url).toBe('http://127.0.0.1:47821/mcp')
    const broken = userData({ 'mcp-token': 'svs_abc', 'settings.json': '{壞掉' })
    expect(readConnection(broken)?.url).toBe('http://127.0.0.1:47821/mcp')
    expect(readConnection(userData({}))).toBeUndefined()
    expect(readConnection(userData({ 'mcp-token': '  \n' }))).toBeUndefined()
  })
})

describe('stdio 轉接：對真的伺服器', () => {
  it('initialize → 通知（沒有回應）→ tools/list → 呼叫工具；回應一行一則 JSON', async () => {
    const r = await startRealMcp()
    closers.push(() => r.close())
    const dir = userData({
      'mcp-token': r.token,
      'settings.json': JSON.stringify({ mcp: { port: r.port } }),
    })
    const { env, out } = envOf(dir)
    await forward(initialize, env)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'slima-video-studio' } },
    })
    await forward(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), env)
    expect(out).toHaveLength(1) // 通知沒有回應
    await forward(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), env)
    const tools = (out[1]?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(tools).toContain('get_capabilities')
    await forward(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_capabilities', arguments: {} },
      }),
      env,
    )
    expect(JSON.stringify(out[2])).toContain('demo')
    // 整個過程沒有 token 外流到回應裡
    expect(JSON.stringify(out)).not.toContain(r.token)
  })

  it('換了新的 token：轉接下一次就用新的，設定檔不用改', async () => {
    const r = await startRealMcp()
    closers.push(() => r.close())
    const dir = userData({
      'mcp-token': r.token,
      'settings.json': JSON.stringify({ mcp: { port: r.port } }),
    })
    const { env, out } = envOf(dir)
    await forward(initialize, env)
    const fresh = r.controller.regenerateToken().token
    if (!fresh) throw new Error('沒有新 token')
    writeFileSync(join(dir, 'mcp-token'), fresh)
    await forward(initialize, env)
    expect(out[1]).toMatchObject({ id: 1, result: expect.anything() as unknown })
    // 舊 token 失效
    writeFileSync(join(dir, 'mcp-token'), r.token)
    await forward(initialize, env)
    expect(out[2]).toMatchObject({
      id: 1,
      error: { message: expect.stringContaining('token') as string },
    })
  })
})

describe('stdio 轉接：連不上時給白話錯誤', () => {
  it('App 沒開：有 id 的請求回 JSON-RPC 錯誤，說要去設定開；通知不回', async () => {
    // 沒有人在聽的埠（不用埠 1：內建 fetch 把它當成禁用埠，錯誤不是「連線被拒」）
    const port = await freePort()
    const dir = userData({
      'mcp-token': 'svs_x',
      'settings.json': `{"mcp":{"port":${String(port)}}}`,
    })
    const { env, out } = envOf(dir)
    await forward(initialize, env)
    expect(out[0]).toMatchObject({
      id: 1,
      error: { message: expect.stringContaining('允許 AI 工具連線') as string },
    })
    await forward(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), env)
    expect(out).toHaveLength(1)
  })

  it('沒有 token 檔、收到不是 JSON：白話錯誤、不丟例外', async () => {
    const { env, out } = envOf(userData({}))
    await forward(initialize, env)
    await forward('不是 JSON', env)
    expect(out).toHaveLength(2)
    expect(JSON.stringify(out)).not.toMatch(/ECONNREFUSED|ENOENT|\.ts:/)
  })
})

describe('stdio 轉接：「連不上」和「等太久」說不同的話', () => {
  const SETTING = '允許 AI 工具連線'
  const STILL_WORKING = 'get_generation_status'

  /** 假的 App：收到請求後交給 handler 決定怎麼回（或不回）。 */
  async function fakeApp(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<number> {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => {
            resolve()
          })
        }),
    )
    const address = server.address()
    return typeof address === 'object' && address ? address.port : 0
  }

  const bridgeTo = (port: number, fetchImpl: typeof fetch) => {
    const dir = userData({
      'mcp-token': 'svs_x',
      'settings.json': JSON.stringify({ mcp: { port } }),
    })
    const { env, out } = envOf(dir)
    return { env: { ...env, fetch: fetchImpl }, out }
  }

  const messageOf = (out: Record<string, unknown>[]): string =>
    (out[0]?.error as { message?: string } | undefined)?.message ?? ''

  it('連不上（沒有人在聽那個埠）：說 App 沒開，要去設定勾「允許 AI 工具連線」', async () => {
    const port = await freePort()
    const { env, out } = bridgeTo(port, makeNodeFetch(5_000))
    await forward(initialize, env)
    expect(messageOf(out)).toContain(SETTING)
    expect(messageOf(out)).not.toContain(STILL_WORKING)
  })

  it('連得上、但等太久沒回應：說 App 還在做或沒回應、去看畫面，不叫人去改設定', async () => {
    const port = await fakeApp(() => {
      // 收到就不回
    })
    const { env, out } = bridgeTo(port, makeNodeFetch(300))
    await forward(initialize, env)
    expect(messageOf(out)).toContain(STILL_WORKING)
    expect(messageOf(out)).not.toContain(SETTING)
  })

  it('Node 內建 fetch 的「等回應標頭」逾時（UND_ERR_HEADERS_TIMEOUT）也算沒回應，不是 App 沒開', async () => {
    const timeout = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    })
    const { env, out } = bridgeTo(1, () => Promise.reject(timeout))
    await forward(initialize, env)
    expect(messageOf(out)).toContain(STILL_WORKING)
    expect(messageOf(out)).not.toContain(SETTING)
  })

  it('中途斷線（App 做到一半被關掉）：算沒有回應；內建 fetch 的「連線被拒」包在 cause 裡也認得出是連不上', async () => {
    const port = await fakeApp((req) => {
      req.socket.destroy()
    })
    const dropped = bridgeTo(port, makeNodeFetch(5_000))
    await forward(initialize, dropped.env)
    expect(messageOf(dropped.out)).toContain(STILL_WORKING)

    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
    const down = bridgeTo(1, () => Promise.reject(refused))
    await forward(initialize, down.env)
    expect(messageOf(down.out)).toContain(SETTING)
  })

  it('慢的工具正常等到：App 過一陣子才回，轉接照樣把結果寫出去', async () => {
    const port = await fakeApp((req, res) => {
      req.resume()
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { done: true } }))
      }, 600)
    })
    const { env, out } = bridgeTo(port, makeNodeFetch(5_000))
    await forward(initialize, env)
    expect(out).toEqual([{ jsonrpc: '2.0', id: 1, result: { done: true } }])
  })
})
