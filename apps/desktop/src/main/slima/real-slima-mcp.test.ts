import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultSlimaLaunch } from './slima-service'

// 其他測試都用 fake-slima-server（假的 MCP 伺服器），不會載入真的 slima-mcp。
// 這支起真的 slima-mcp 子行程（升版或 zod 跨版本時最容易壞在它的工具登錄），把它的 API 指到本機假的 HTTP 伺服器。
vi.setConfig({ testTimeout: 30_000 })

const UPDATE_TOOLS = [
  'update_beat_board',
  'update_relationship_map',
  'update_script',
  'update_timeline',
  'update_world_map',
]

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

async function startFakeApi() {
  const posts: { url: string; auth: string | undefined; body: unknown }[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.method === 'POST' && req.url?.endsWith('/mcp/files/structured')) {
        const body = JSON.parse(raw) as { operations: { op: string }[] }
        posts.push({ url: req.url, auth: req.headers.authorization, body })
        const applied = body.operations.map((o, i) => ({ op: o.op, id: `id_${i}` }))
        res.end(JSON.stringify({ data: { applied, notes: [], commit: { token: 'cm_fake1' } } }))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise((resolve) => server.close(resolve)))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, posts }
}

async function connectRealSlimaMcp(apiUrl: string) {
  const launch = defaultSlimaLaunch(undefined, apiUrl)('slima_fake_tok_000000')
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { PATH: process.env.PATH ?? '', ...launch.env },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'real-slima-mcp-test', version: '0.0.0' })
  await client.connect(transport)
  closers.push(() => client.close())
  return client
}

describe('真的 slima-mcp 子行程', () => {
  it('tools/list 列得出 39 個工具，5 個 update_* 都在', async () => {
    const { url } = await startFakeApi()
    const client = await connectRealSlimaMcp(url)
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(39)
    const names = tools.map((t) => t.name)
    for (const name of UPDATE_TOOLS) expect(names).toContain(name)
  })

  it.each(UPDATE_TOOLS)('%s：實打成功，operations 與 Token 原樣送到 API', async (name) => {
    const api = await startFakeApi()
    const client = await connectRealSlimaMcp(api.url)
    const operations = [{ op: 'add_entry', title: '甲' }]
    const result = await client.callTool({
      name,
      arguments: { book_token: 'bk_x', path: 'a/b.x', intent: '測試', operations },
    })
    expect(result.isError).toBeFalsy()
    expect(api.posts).toHaveLength(1)
    expect(api.posts[0]).toMatchObject({
      url: '/api/v1/books/bk_x/mcp/files/structured',
      auth: 'Bearer slima_fake_tok_000000',
      body: { path: 'a/b.x', intent: '測試', operations },
    })
  })
})
