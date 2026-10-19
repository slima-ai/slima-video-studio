import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createServer } from 'node:net'
import { vi } from 'vitest'
import { type z } from 'zod'

import { registerAllHandlers } from '../ipc/handlers'
import { createIpcRegistry } from '../ipc/registry'
import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'
import { testSettingsDeps } from '../settings/test-deps'
import { createMcpController } from './controller'

export const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      const port = typeof address === 'object' && address ? address.port : 0
      s.close(() => {
        resolve(port)
      })
    })
  })

export const textOf = (result: unknown): string => {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

/** 工具回傳的 JSON 文字，用 schema 驗證後解出來。 */
export const dataOf = <S extends z.ZodType>(schema: S, result: unknown): z.infer<S> =>
  schema.parse(JSON.parse(textOf(result)))

/**
 * 整套真的主行程服務（示範模式、模擬的文字模型）＋ 真的 IPC registry ＋ 真的 MCP 伺服器，
 * 再用真的 MCP SDK 客戶端連上去。呼叫 close() 收掉全部。
 */
export async function startRealMcp(options: HarnessOptions = {}) {
  const h = createStudioHarness(options)
  const fakes = testSettingsDeps(h.keys)
  const registry = createIpcRegistry(log)
  const broadcast = vi.fn()
  const controller = createMcpController({
    registry,
    settings: h.settings,
    keys: h.keys,
    broadcast,
    userDataDir: h.root,
    info: { name: 'Slima Video Studio', version: '9.9.9' },
    log,
  })
  registerAllHandlers(registry, {
    info: { name: 'Slima Video Studio', version: '9.9.9', platform: 'linux', packaged: false },
    projects: h.projects,
    keys: h.keys,
    ...fakes,
    settings: h.settings,
    settingsService: h.settingsService,
    runtime: h.runtime,
    quickstart: h.quickstart,
    upgrade: h.upgrade,
    graph: h.graph,
    canvas: h.canvas,
    records: h.records,
    files: h.files,
    shots: h.shots,
    characters: h.characters,
    concepts: h.concepts,
    turnarounds: h.turnarounds,
    locations: h.locations,
    outline: h.outline,
    storyboard: h.storyboard,
    history: h.history,
    library: h.library,
    mcp: controller,
  })
  const port = await freePort()
  await registry.dispatch(
    { channel: 'settings.update', payload: { mcp: { enabled: true, port } } },
    { emit: () => undefined },
  )
  const status = controller.status()
  if (!status.url || !status.token) throw new Error('MCP 沒有啟動')
  const client = new Client({ name: 'test', version: '1' })
  // @ts-expect-error SDK 的 Transport 型別與 exactOptionalPropertyTypes 不相容（sessionId 等欄位）
  const transport: Transport = new StreamableHTTPClientTransport(new URL(status.url), {
    requestInit: { headers: { Authorization: `Bearer ${status.token}` } },
  })
  await client.connect(transport)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args })
  return {
    h,
    client,
    call,
    controller,
    registry,
    broadcast,
    port,
    token: status.token,
    close: async () => {
      await client.close()
      await controller.stop()
      h.cleanup()
    },
  }
}
