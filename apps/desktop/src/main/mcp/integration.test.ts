import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { registerAllHandlers } from '../ipc/handlers'
import { createIpcRegistry } from '../ipc/registry'
import { MemoryVault } from '../keys/key-vault'
import { createProjectLibrary } from '../project-library'
import { ProjectManager } from '../project-manager'
import { testSettingsDeps } from '../settings/test-deps'
import { createMcpCaller, MCP_CHANNELS } from './bridge'
import { createMcpController, type McpController } from './controller'

const SECRET = 'sk-or-v1-SENTINEL-DO-NOT-LEAK-0123456789'
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const broadcast = vi.fn()

const freePort = (): Promise<number> =>
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

interface Env {
  root: string
  controller: McpController
  keys: MemoryVault
  projects: ProjectManager
  registry: ReturnType<typeof createIpcRegistry>
  settings: ReturnType<typeof testSettingsDeps>['settings']
  url: string
  token: string
  port: number
}

let env: Env
const closers: (() => Promise<void> | void)[] = []

async function setup(options: { demoMode?: boolean } = {}): Promise<Env> {
  const root = mkdtempSync(join(tmpdir(), 'svs-mcp-it-'))
  const keys = new MemoryVault()
  keys.set('openrouter', SECRET)
  const projects = new ProjectManager('test')
  const deps = testSettingsDeps(keys)
  const library = createProjectLibrary({
    projects,
    projectsDir: join(root, 'projects'),
    reveal: () => undefined,
  })
  const registry = createIpcRegistry(log)
  const controller = createMcpController({
    registry,
    settings: deps.settings,
    keys,
    broadcast,
    projects,
    tools: () => undefined,
    userDataDir: root,
    info: { name: 'Slima Video Studio', version: '9.9.9' },
    log,
  })
  registerAllHandlers(registry, {
    info: { name: 'Slima Video Studio', version: '9.9.9', platform: 'linux', packaged: false },
    projects,
    keys,
    ...deps,
    library,
    mcp: controller,
  })
  const port = await freePort()
  deps.settings.update({ demoMode: options.demoMode ?? true })
  await registry.dispatch(
    { channel: 'settings.update', payload: { mcp: { enabled: true, port } } },
    { emit: () => undefined },
  )
  closers.push(
    () => controller.stop(),
    () => {
      projects.close()
      rmSync(root, { recursive: true, force: true })
    },
  )
  const status = controller.status()
  if (!status.token || !status.url) throw new Error('MCP 沒有啟動')
  return {
    root,
    controller,
    keys,
    projects,
    registry,
    settings: deps.settings,
    url: status.url,
    token: status.token,
    port,
  }
}

async function connect(e: Env): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  // @ts-expect-error SDK 的 Transport 型別與 exactOptionalPropertyTypes 不相容（sessionId 等欄位）
  const transport: Transport = new StreamableHTTPClientTransport(new URL(e.url), {
    requestInit: { headers: { Authorization: `Bearer ${e.token}` } },
  })
  await client.connect(transport)
  closers.push(() => client.close())
  return client
}

/** 工具回傳的 JSON 文字，用 schema 驗證後解出來。 */
const dataOf = <S extends z.ZodType>(schema: S, result: unknown): z.infer<S> =>
  schema.parse(JSON.parse(textOf(result)))

const ProjectViewSchema = z.object({ id: z.string(), name: z.string(), aspectRatio: z.string() })
const ProjectOnly = z.object({ project: ProjectViewSchema })
const CapabilitiesSchema = z.looseObject({
  tools: z.array(z.string()),
  guides: z.array(z.string()),
})
const GuideSchema = z.object({ text: z.string() })
const ListedSchema = z.object({
  projects: z.array(z.object({ ref: z.string(), name: z.string(), current: z.boolean() })),
})

const textOf = (result: unknown): string => {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

beforeEach(async () => {
  broadcast.mockClear()
  env = await setup()
})
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

/** 低階 HTTP：可以自己指定 Host／Origin／標頭（fetch 不讓改 Host）。 */
function raw(
  e: Env,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: e.port,
        method: options.method ?? 'POST',
        path: options.path ?? '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.end(options.body ?? '')
  })
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
})

describe('本機 MCP 伺服器的安全檢查（沒過就不會進到 MCP）', () => {
  const auth = () => ({ Authorization: `Bearer ${env.token}` })

  it('沒帶 token、token 錯、格式不對 → 401', async () => {
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: env.token }]) {
      const r = await raw(env, { headers, body: initialize })
      expect(r.status).toBe(401)
    }
  })

  it('Host 不是本機位址＋我們的埠（DNS rebinding）→ 403，就算 token 對', async () => {
    for (const host of [
      'evil.example.com',
      'evil.example.com:' + String(env.port),
      '127.0.0.1:1',
    ]) {
      const r = await raw(env, { headers: { ...auth(), Host: host }, body: initialize })
      expect(r.status, host).toBe(403)
    }
  })

  it('Origin 不是本機（瀏覽器的跨站請求）→ 403；沒有 Origin（命令列工具）可以', async () => {
    const bad = await raw(env, {
      headers: { ...auth(), Origin: 'https://evil.example.com' },
      body: initialize,
    })
    expect(bad.status).toBe(403)
    const garbage = await raw(env, {
      headers: { ...auth(), Origin: 'not a url' },
      body: initialize,
    })
    expect(garbage.status).toBe(403)
    const ok = await raw(env, { headers: auth(), body: initialize })
    expect(ok.status).toBe(200)
  })

  it('錯的路徑 404、非 POST 405、壞掉的 JSON 400、太大 413', async () => {
    expect((await raw(env, { headers: auth(), path: '/other', body: initialize })).status).toBe(404)
    expect((await raw(env, { headers: auth(), method: 'GET' })).status).toBe(405)
    expect((await raw(env, { headers: auth(), body: '{nope' })).status).toBe(400)
    const big = await raw(env, { headers: auth(), body: 'x'.repeat(5 * 1024 * 1024) }).catch(
      (e: unknown) => ({ status: -1, body: String(e) }),
    )
    // 超過上限時伺服器會中斷連線，客戶端可能只看到 413 或連線被重設
    expect([413, -1]).toContain(big.status)
  })

  it('只綁 127.0.0.1（不是 0.0.0.0）', async () => {
    const { networkInterfaces } = await import('node:os')
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i.internal)
    if (!lan) return // 沒有對外網卡的環境（例如 CI 容器）沒東西可驗
    const refused = await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        { host: lan.address, port: env.port, method: 'POST', path: '/mcp' },
        () => {
          resolve(false)
        },
      )
      req.on('error', () => {
        resolve(true)
      })
      req.end('{}')
    })
    expect(refused).toBe(true)
  })

  it('換一組新的 token：舊的立刻失效、新的可以用', async () => {
    const old = env.token
    const next = env.controller.regenerateToken().token
    expect(next).toBeDefined()
    expect(next).not.toBe(old)
    expect(
      (await raw(env, { headers: { Authorization: `Bearer ${old}` }, body: initialize })).status,
    ).toBe(401)
    expect(
      (await raw(env, { headers: { Authorization: `Bearer ${next ?? ''}` }, body: initialize }))
        .status,
    ).toBe(200)
  })
})

describe('開關與預設', () => {
  it('預設是關的：沒有伺服器在聽，狀態沒有 token 與網址', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-mcp-off-'))
    closers.push(() => {
      rmSync(root, { recursive: true, force: true })
    })
    const keys = new MemoryVault()
    const deps = testSettingsDeps(keys)
    const controller = createMcpController({
      registry: createIpcRegistry(log),
      settings: deps.settings,
      keys,
      broadcast,
      projects: new ProjectManager('test'),
      tools: () => undefined,
      userDataDir: root,
      info: { name: 'x', version: '1' },
      log,
    })
    await controller.sync()
    expect(controller.status()).toMatchObject({ enabled: false, running: false, allowanceUsd: 0 })
    expect(controller.status().token).toBeUndefined()
    expect(controller.status().url).toBeUndefined()
  })

  it('關掉後伺服器真的停了；埠被佔用時狀態說明原因而不是當掉', async () => {
    await registerOff()
    await expect(raw(env, { body: initialize })).rejects.toThrow()

    const busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
    const address = busy.address()
    const busyPort = typeof address === 'object' && address ? address.port : 0
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          busy.close(() => {
            resolve()
          })
        }),
    )
    await env.registry.dispatch(
      { channel: 'settings.update', payload: { mcp: { enabled: true, port: busyPort } } },
      { emit: () => undefined },
    )
    const status = env.controller.status()
    expect(status.running).toBe(false)
    expect(status.error).toContain('已經被別的程式用了')
  })
})

async function registerOff(): Promise<void> {
  await env.registry.dispatch(
    { channel: 'settings.update', payload: { mcp: { enabled: false } } },
    { emit: () => undefined },
  )
}

describe('工具', () => {
  it('列出的工具就是預期的這幾個（新增工具要有意識地改這份清單）', async () => {
    const client = await connect(env)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'adjust_sound_clip',
      'adopt_sound_clip',
      'adopt_version',
      'assemble_film',
      'cancel_generation',
      'configure_project',
      'create_character',
      'create_project',
      'create_shot',
      'delete_shots',
      'edit_outline',
      'estimate_cost',
      'export_film',
      'generate_character_images',
      'generate_first_frames',
      'generate_music',
      'generate_narration',
      'generate_videos',
      'get_capabilities',
      'get_current_project',
      'get_generation_status',
      'get_outline',
      'get_shot',
      'get_sound',
      'list_characters',
      'list_models',
      'list_projects',
      'list_shots',
      'load_guide',
      'lock_character',
      'mix_sound',
      'open_project',
      'pick_character_image',
      'plan_sound',
      'redo',
      'regenerate_shot',
      'remove_sound_clip',
      'reorder_shots',
      'set_character_anchor',
      'set_models',
      'set_sound_settings',
      'split_scene_into_shots',
      'split_story_into_scenes',
      'suggest_character_anchor',
      'undo',
      'update_character',
      'update_shot',
      'view_character_images',
      'view_first_frames',
      'view_video_stills',
      'wait_for_generation',
    ])
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean')
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(20)
    }
  })

  it('伺服器 instructions 很短，且指向 get_capabilities', async () => {
    const client = await connect(env)
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain('get_capabilities')
    expect(instructions.length).toBeLessThan(1500)
  })

  it('get_capabilities：模式、目前專案、額度、工具與指南', async () => {
    const client = await connect(env)
    const data = dataOf(
      CapabilitiesSchema,
      await client.callTool({ name: 'get_capabilities', arguments: {} }),
    )
    expect(data).toMatchObject({
      app: { name: 'Slima Video Studio', version: '9.9.9' },
      mode: 'demo',
      project: null,
      spending: { allowanceUsd: 0, committedUsd: 0, remainingUsd: 0 },
    })
    expect(data.tools).toContain('create_project')
    expect(data.guides).toEqual(['getting-started', 'storyboard', 'spending', 'sound'])
  })

  it('load_guide：storyboard 用的是使用者設定的準則（改過就是改過的）', async () => {
    const client = await connect(env)
    const read = async () =>
      dataOf(
        GuideSchema,
        await client.callTool({ name: 'load_guide', arguments: { topic: 'storyboard' } }),
      ).text
    expect(await read()).toContain('一個鏡頭只做一件事')
    env.settings.update({ storyboardGuide: '每個場一定要有一個遠景。' })
    expect(await read()).toContain('每個場一定要有一個遠景。')
    const bad = await client.callTool({ name: 'load_guide', arguments: { topic: 'nope' } })
    expect(bad.isError).toBe(true)
  })

  it('create_project → get_current_project → list_projects → open_project；AI 看不到電腦上的路徑', async () => {
    const client = await connect(env)
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args })
    const created = dataOf(ProjectOnly, await call('create_project', { name: '黑藤裂谷' }))
    expect(created.project).toMatchObject({ name: '黑藤裂谷', aspectRatio: '16:9' })
    const current = dataOf(ProjectOnly, await call('get_current_project'))
    expect(current.project.id).toBe(created.project.id)
    const listed = dataOf(ListedSchema, await call('list_projects'))
    expect(listed.projects).toHaveLength(1)
    expect(listed.projects[0]).toMatchObject({ name: '黑藤裂谷', current: true })
    expect(listed.projects[0]?.ref).toMatch(/\.svsproj$/)
    const everything = JSON.stringify([created, current, listed])
    expect(everything).not.toContain(env.root)
    expect(everything).not.toContain('/tmp')

    const second = dataOf(ProjectOnly, await call('create_project', { name: '第二支' }))
    expect(second.project.name).toBe('第二支')
    const first = listed.projects[0]
    expect(first).toBeDefined()
    const reopened = dataOf(ProjectOnly, await call('open_project', { ref: first?.ref ?? '' }))
    expect(reopened.project.id).toBe(created.project.id)
    // AI 工具換了專案，App 的視窗要收到變更事件才會跟著更新（同 renderer 自己換專案時發的那幾個）
    const events = broadcast.mock.calls.map((c) => c[0] as string)
    for (const event of ['characters.changed', 'locations.changed', 'outline.changed']) {
      expect(events).toContain(event)
    }
    const missing = await call('open_project', { ref: '不存在.svsproj' })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('找不到代號')
  })
})

describe('金鑰與不開放的功能', () => {
  it('任何工具的回傳都不含金鑰或連線 token（金鑰在保管庫裡、token 設了也是）', async () => {
    const client = await connect(env)
    const { tools } = await client.listTools()
    const outputs: string[] = []
    for (const tool of tools) {
      const args: Record<string, unknown> =
        tool.name === 'load_guide'
          ? { topic: 'spending' }
          : tool.name === 'create_project'
            ? { name: SECRET } // 就算有人把金鑰當成專案名稱塞進來，輸出也會被遮蔽
            : tool.name === 'open_project'
              ? { ref: SECRET }
              : {}
      outputs.push(textOf(await client.callTool({ name: tool.name, arguments: args })))
    }
    const all = outputs.join('\n')
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(env.token)
    expect(all.length).toBeGreaterThan(100)
  })

  it('MCP 完全不碰金鑰保管庫的讀取：鑰匙圈卡住（讀取永遠不回來）時，連線與工具照常回應，回傳仍會遮蔽已知的金鑰', async () => {
    // 模擬鑰匙圈停在「要不要允許」的提示：保管庫的讀取一律掛住、同步的 get 會丟錯
    const hang = new Promise<never>(() => undefined)
    const touched: string[] = []
    env.keys.get = () => {
      touched.push('get')
      throw new Error('MCP 不應該去讀金鑰')
    }
    env.keys.load = () => {
      touched.push('load')
      return hang
    }
    env.keys.save = () => {
      touched.push('save')
      return hang
    }
    const client = await connect(env)
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(10)
    const caps = await client.callTool({ name: 'get_capabilities', arguments: {} })
    expect(caps.isError).not.toBe(true)
    const created = await client.callTool({ name: 'create_project', arguments: { name: SECRET } })
    expect(textOf(created)).not.toContain(SECRET) // 已經在記憶體裡的金鑰照樣被遮蔽
    expect((await client.callTool({ name: 'list_projects', arguments: {} })).isError).not.toBe(true)
    expect(
      (await client.callTool({ name: 'load_guide', arguments: { topic: 'spending' } })).isError,
    ).not.toBe(true)
    expect(touched).toEqual([])
  })

  it('輸入格式不對時 SDK 自己產生的錯誤訊息，也不會把金鑰原樣帶回去', async () => {
    const client = await connect(env)
    const topic = await client
      .callTool({ name: 'load_guide', arguments: { topic: SECRET } })
      .catch((e: unknown) => ({ content: [{ type: 'text', text: String(e) }] }))
    const long = await client
      .callTool({ name: 'create_project', arguments: { name: SECRET.repeat(3) } })
      .catch((e: unknown) => ({ content: [{ type: 'text', text: String(e) }] }))
    const unknownTool = await client
      .callTool({ name: SECRET, arguments: {} })
      .catch((e: unknown) => ({ content: [{ type: 'text', text: String(e) }] }))
    for (const result of [topic, long, unknownTool]) expect(textOf(result)).not.toContain(SECRET)
  })

  it('白名單：MCP 的呼叫器拒絕 keys.*、settings.update、mcp.*、dev.*、任意檔案路徑類通道', async () => {
    const caller = createMcpCaller(env.registry)
    for (const channel of [
      'keys.list',
      'keys.set',
      'keys.delete',
      'keys.test',
      'settings.update',
      'settings.get',
      'mcp.status',
      'mcp.regenerateToken',
      'dev.seedDemo',
      'project.reveal',
      'files.reveal',
      'canvas.importFiles',
      'canvas.importBytes',
      'slima.connect',
    ] as const) {
      await expect(
        (caller.call as (c: string, p: unknown) => Promise<unknown>)(channel, {}),
      ).rejects.toMatchObject({ code: 'not_allowed' })
    }
    for (const channel of MCP_CHANNELS) {
      expect(channel).not.toMatch(/^(keys|mcp|dev)\./)
      expect(channel).not.toBe('settings.update')
    }
  })
})
