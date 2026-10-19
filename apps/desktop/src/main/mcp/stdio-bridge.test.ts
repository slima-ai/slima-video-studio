import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { forward, readConnection, type BridgeEnv } from './stdio-bridge'
import { startRealMcp } from './test-support'

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
    const dir = userData({ 'mcp-token': 'svs_x', 'settings.json': '{"mcp":{"port":1}}' })
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
