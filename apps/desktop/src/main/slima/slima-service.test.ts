import { AppError, type SlimaStatus } from '@svs/schema'
import { createSlimaConnection, type SlimaConnection } from '@svs/slima'
import { FAKE_SLIMA_BOOKS, FAKE_SLIMA_TOKEN } from '@svs/test-utils'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import {
  createSlimaService,
  defaultSlimaLaunch,
  slimaApiUrlFor,
  slimaLaunchFor,
  SLIMA_KEY_ID,
} from './slima-service'

const FAKE_SLIMA_SERVER_PATH = createRequire(import.meta.url).resolve(
  '@svs/test-utils/fake-slima-server',
)

// 每個測試都會真的啟動一個子行程
vi.setConfig({ testTimeout: 30_000 })

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const launch = (token: string) => ({
  command: process.execPath,
  args: [FAKE_SLIMA_SERVER_PATH],
  env: { SLIMA_API_TOKEN: token },
})

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

function setup() {
  const keys = new MemoryVault()
  const events: SlimaStatus[] = []
  const service = createSlimaService({
    keys,
    log,
    launch,
    backoffMs: [20],
    broadcast: (event, payload) => {
      if (event === 'slima.status') events.push(payload as SlimaStatus)
    },
  })
  stops.push(() => service.stop())
  return { keys, events, service }
}

const code = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof AppError ? error.code : 'other'),
  )

describe('SlimaService', () => {
  it('沒有 Token：維持「沒有 Token」，不啟動子行程，查書會說明要先連線', async () => {
    const { service, events } = setup()
    service.start()
    expect(service.status()).toEqual({ state: 'no_token' })
    expect(await code(service.books())).toBe('slima_unavailable')
    expect(events).toEqual([{ state: 'no_token' }])
  })

  it('貼上正確的 Token → 連線成功，列出三本書（自動翻頁）；狀態與事件都不含 Token', async () => {
    const { service, keys, events } = setup()
    const status = await service.connect(FAKE_SLIMA_TOKEN)
    expect(status).toMatchObject({ state: 'ready', toolCount: 9, last4: '0000' })
    expect(keys.get(SLIMA_KEY_ID)).toBe(FAKE_SLIMA_TOKEN)
    expect((await service.books()).books).toEqual(FAKE_SLIMA_BOOKS)
    expect(events.map((e) => e.state)).toEqual(['connecting', 'ready'])
    expect(JSON.stringify([status, events])).not.toContain(FAKE_SLIMA_TOKEN)
  })

  it('Token 不對 → 說明 Token 無效，不會一直重試；換成正確的就能連上', async () => {
    const { service } = setup()
    const bad = await service.connect('slima_wrong_token_9999')
    expect(bad.state).toBe('error')
    expect(bad.message).toContain('Token')
    expect(await code(service.books())).toBe('slima_unavailable')

    expect((await service.connect(FAKE_SLIMA_TOKEN)).state).toBe('ready')
  })

  it('Token 格式不對（有空白）→ 擋下，不存、不連線', async () => {
    const { service, keys } = setup()
    await expect(service.connect('has space token')).rejects.toMatchObject({ code: 'key_invalid' })
    expect(keys.get(SLIMA_KEY_ID)).toBeUndefined()
    expect(service.status().state).toBe('no_token')
  })

  it('中斷連線：清掉 Token、回到「沒有 Token」', async () => {
    const { service, keys } = setup()
    await service.connect(FAKE_SLIMA_TOKEN)
    expect(await service.disconnect()).toEqual({ state: 'no_token' })
    expect(keys.get(SLIMA_KEY_ID)).toBeUndefined()
    expect(await code(service.books())).toBe('slima_unavailable')
  })

  it('App 重開時 start() 會用已存的 Token 自動連線', async () => {
    const { service, keys } = setup()
    keys.set(SLIMA_KEY_ID, FAKE_SLIMA_TOKEN)
    service.start()
    await vi.waitFor(() => {
      expect(service.status().state).toBe('ready')
    })
  })
})

describe('SlimaConnection', () => {
  const connection = (): SlimaConnection => {
    const made = createSlimaConnection({
      launch,
      token: () => FAKE_SLIMA_TOKEN,
      log,
      backoffMs: [20],
    })
    stops.push(() => made.stop())
    return made
  }

  it('只能呼叫唯讀工具：寫入類工具即使伺服器有也被擋下', async () => {
    const conn = connection()
    await conn.start()
    expect(conn.status().state).toBe('ready')
    for (const name of ['create_book', 'write_file', 'delete_file']) {
      expect(await code(conn.callTool(name, { title: 'x' }))).toBe('invalid_request')
    }
    expect(await conn.callTool('get_book', { book_token: 'bk_novel1' })).toContain('雨夜的貓')
  })

  it('子行程被殺掉 → 自動重新連線，新的子行程可以繼續查詢', async () => {
    const conn = connection()
    await conn.start()
    const first = conn.pid()
    expect(first).not.toBeNull()
    const states: string[] = []
    const poll = setInterval(() => states.push(conn.status().state), 2)

    process.kill(first ?? 0, 'SIGKILL')
    await vi.waitFor(() => {
      expect(conn.status().state).toBe('ready')
      expect(conn.pid()).not.toBe(first)
    })
    clearInterval(poll)

    expect(states).toContain('error')
    expect(await conn.callTool('get_book', { book_token: 'bk_script1' })).toContain('鐵與花')
  })

  it('stop() 之後不會自己復活', async () => {
    const conn = connection()
    await conn.start()
    await conn.stop()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(conn.pid()).toBeNull()
    expect(conn.status().state).not.toBe('ready')
  })
})

describe('啟動方式', () => {
  it('預設：用目前的執行檔當 Node 跑 slima-mcp，Token 只放環境變數、不碰 ~/.slima', () => {
    const result = defaultSlimaLaunch(() => '/x/slima-mcp/dist/index.js')('slima_tok_abcdef123456')
    expect(result.command).toBe(process.execPath)
    expect(result.args).toEqual(['/x/slima-mcp/dist/index.js'])
    expect(result.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      SLIMA_API_TOKEN: 'slima_tok_abcdef123456',
    })
    expect(result.env.SLIMA_DIR).toContain('svs-slima')
    expect(result.args.join(' ')).not.toContain('slima_tok')
  })

  it('SVS_SLIMA_SERVER 只在未打包時生效', () => {
    const env = { SVS_SLIMA_SERVER: '/fake/server.mjs' }
    expect(slimaLaunchFor(env, false)('tok_12345678').args).toEqual(['/fake/server.mjs'])
    expect(slimaLaunchFor(env, true)('tok_12345678').args).not.toEqual(['/fake/server.mjs'])
  })

  it('沒設 SVS_SLIMA_API_URL：不傳 SLIMA_API_URL，slima-mcp 用它的預設（行為跟以前一樣）', () => {
    expect(slimaLaunchFor({}, false)('tok_12345678').env).not.toHaveProperty('SLIMA_API_URL')
    expect(defaultSlimaLaunch()('tok_12345678').env).not.toHaveProperty('SLIMA_API_URL')
  })

  describe('SVS_SLIMA_API_URL（把 slima-mcp 指到 test 環境）', () => {
    // 測試用的主機名一律是假的；真正的 test 環境主機只由使用者自己用 SVS_SLIMA_TEST_HOSTS 指定
    const TEST_HOST = 'test-api.example.test'
    const env = (value: string | undefined, hosts?: string) => ({
      SVS_SLIMA_API_URL: value,
      ...(hosts === undefined ? {} : { SVS_SLIMA_TEST_HOSTS: hosts }),
    })

    it('非打包版：本機位址預設就生效；自己列在 SVS_SLIMA_TEST_HOSTS 的主機也生效，傳給 slima-mcp 的 SLIMA_API_URL', () => {
      expect(slimaApiUrlFor(env('http://127.0.0.1:4000'), false)).toBe('http://127.0.0.1:4000')
      expect(slimaApiUrlFor(env(`https://${TEST_HOST}`, TEST_HOST), false)).toBe(
        `https://${TEST_HOST}`,
      )
      expect(slimaApiUrlFor(env(`https://${TEST_HOST}/`, TEST_HOST), false)).toBe(
        `https://${TEST_HOST}`,
      )
      expect(
        slimaLaunchFor(env(`https://${TEST_HOST}`, TEST_HOST), false)('tok_12345678').env,
      ).toMatchObject({ SLIMA_API_URL: `https://${TEST_HOST}` })
    })

    it('沒設 SVS_SLIMA_TEST_HOSTS：任何 test 環境主機一律拒絕，只認本機', () => {
      for (const host of [TEST_HOST, 'staging.example.test']) {
        expect(slimaApiUrlFor(env(`https://${host}`), false), host).toBeUndefined()
        expect(slimaApiUrlFor(env(`https://${host}`, ''), false), `${host}（空白）`).toBeUndefined()
      }
      expect(slimaApiUrlFor(env('http://localhost:4000'), false)).toBe('http://localhost:4000')
      expect(slimaApiUrlFor(env('https://[::1]:4000'), false)).toBe('https://[::1]:4000')
    })

    it('SVS_SLIMA_TEST_HOSTS：逗號分隔、去空白、不分大小寫；帶 https://、萬用字元、路徑的寫法無效', () => {
      expect(
        slimaApiUrlFor(
          env(`https://${TEST_HOST}`, ` ${TEST_HOST.toUpperCase()} , other.test`),
          false,
        ),
      ).toBe(`https://${TEST_HOST}`)
      for (const hosts of [
        `https://${TEST_HOST}`,
        `*.example.test`,
        `${TEST_HOST}/path`,
        `${TEST_HOST}:443`,
        ', ,',
      ]) {
        expect(slimaApiUrlFor(env(`https://${TEST_HOST}`, hosts), false), hosts).toBeUndefined()
      }
    })

    it('打包版不吃這兩個變數：就算設了，也不會傳 SLIMA_API_URL', () => {
      expect(slimaApiUrlFor(env(`https://${TEST_HOST}`, TEST_HOST), true)).toBeUndefined()
      expect(slimaApiUrlFor(env('http://127.0.0.1:4000', TEST_HOST), true)).toBeUndefined()
      expect(
        slimaLaunchFor(env(`https://${TEST_HOST}`, TEST_HOST), true)('tok_12345678').env,
      ).not.toHaveProperty('SLIMA_API_URL')
    })

    it('正式站與其他位址一律不接受（就算有設 SVS_SLIMA_TEST_HOSTS）：Token 會被送到這個位址', () => {
      for (const bad of [
        'https://api.slima.ai',
        `https://${TEST_HOST}.evil.example`,
        `https://evil.example/${TEST_HOST}`,
        `http://${TEST_HOST}`,
        'http://192.168.1.10:4000',
        'https://example.com',
        'ftp://127.0.0.1',
        'not a url',
        '',
      ]) {
        expect(slimaApiUrlFor(env(bad, TEST_HOST), false), bad).toBeUndefined()
      }
      expect(slimaApiUrlFor({}, false)).toBeUndefined()
    })
  })

  it('內建的 slima-mcp 找得到入口檔', () => {
    const [entry] = defaultSlimaLaunch()('tok_12345678').args
    expect(entry).toMatch(/slima-mcp[\\/]dist[\\/]index\.js$/)
  })
})
