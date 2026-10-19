import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSlimaApi,
  createSlimaConnection,
  type SlimaReader,
  type SlimaConnection,
  type SlimaLaunch,
} from '@svs/slima'
import type { SlimaBooks, SlimaStatus } from '@svs/schema'

import { normalizeKey, type KeyVault } from '../keys/key-vault'
import type { Logger } from '../logger'
import type { Broadcast } from '../runtime/project-runtime'

/** Token 存在金鑰庫裡用的供應商 ID。 */
export const SLIMA_KEY_ID = 'slima'

export interface SlimaService {
  status: () => SlimaStatus
  /** App 啟動時呼叫：有 Token 就在背景連線。 */
  start: () => void
  stop: () => Promise<void>
  /** 存下 Token 並連線；回傳連線結果（Token 無效時 state 為 error）。 */
  connect: (token: string) => Promise<SlimaStatus>
  disconnect: () => Promise<SlimaStatus>
  books: () => Promise<SlimaBooks>
  /** 唯讀查詢（匯入服務用）。沒連線時呼叫會丟出 slima_unavailable。 */
  reader: SlimaReader
}

export interface SlimaServiceDeps {
  keys: KeyVault
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn'>
  launch?: (token: string) => SlimaLaunch
  backoffMs?: readonly number[]
}

/**
 * 預設的啟動方式：用目前這個執行檔（Electron 加上 ELECTRON_RUN_AS_NODE，使用者不用裝 Node）
 * 跑 slima-mcp 的 stdio 伺服器。Token 只用環境變數傳入，SLIMA_DIR 指到暫存資料夾，
 * 不會讀寫使用者家目錄的 ~/.slima。
 */
export function defaultSlimaLaunch(
  resolveEntry: () => string = () => createRequire(__filename).resolve('slima-mcp'),
  apiUrl?: string,
): (token: string) => SlimaLaunch {
  return (token) => ({
    command: process.execPath,
    args: [resolveEntry()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      SLIMA_API_TOKEN: token,
      SLIMA_DIR: join(tmpdir(), 'svs-slima'),
      // slima-mcp 預設連正式站（https://api.slima.ai）；只有測試覆寫才會指到別的位址
      ...(apiUrl === undefined ? {} : { SLIMA_API_URL: apiUrl }),
    },
  })
}

/** 本機位址（假伺服器）：測試覆寫預設只認這幾個。正式站與任何 test 環境主機都不在裡面。 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * 使用者自己指定、允許測試覆寫連過去的主機（`SVS_SLIMA_TEST_HOSTS`，逗號分隔的主機名，不分大小寫）。
 * 沒設就是空的：程式裡不內建任何 test 環境的主機名。帶協定、埠、路徑或萬用字元的寫法無效。
 */
function extraTestHosts(env: Readonly<Record<string, string | undefined>>): Set<string> {
  const hosts = new Set<string>()
  for (const entry of (env.SVS_SLIMA_TEST_HOSTS ?? '').split(',')) {
    const host = entry.trim().toLowerCase()
    if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) hosts.add(host)
  }
  return hosts
}

/**
 * 測試用：把 slima-mcp 的 API 位址換成別的位址（`SVS_SLIMA_API_URL=https://<測試主機>`）。
 * 只有未打包時生效。Token 會被送到這個位址，所以只接受本機位址，以及使用者自己用
 * `SVS_SLIMA_TEST_HOSTS` 列出的主機（且要 https）；其他一律忽略（包括正式站）。
 * 沒設或不合格就回傳 undefined（照舊用 slima-mcp 的預設）。
 */
export function slimaApiUrlFor(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined {
  const raw = env.SVS_SLIMA_API_URL
  if (packaged || raw === undefined || raw === '') return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  const loopback = LOOPBACK.has(url.hostname)
  if (!loopback && !extraTestHosts(env).has(url.hostname)) return undefined
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return undefined
  return raw.replace(/\/+$/, '')
}

/**
 * 測試模式（非打包版）可以用 SVS_SLIMA_SERVER 指向假的 slima-mcp 伺服器，E2E 才不會連 Slima 正式環境。
 * 打包版一律用內建的 slima-mcp。
 */
export function slimaLaunchFor(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): (token: string) => SlimaLaunch {
  const fake = env.SVS_SLIMA_SERVER
  const apiUrl = slimaApiUrlFor(env, packaged)
  if (packaged || !fake) return defaultSlimaLaunch(undefined, apiUrl)
  return defaultSlimaLaunch(() => fake, apiUrl)
}

export function createSlimaService(deps: SlimaServiceDeps): SlimaService {
  const { keys, log } = deps
  const connection: SlimaConnection = createSlimaConnection({
    launch: deps.launch ?? defaultSlimaLaunch(),
    token: () => keys.get(SLIMA_KEY_ID),
    log,
    onStatus: (status) => {
      deps.broadcast('slima.status', status)
    },
    ...(deps.backoffMs ? { backoffMs: deps.backoffMs } : {}),
  })
  const api = createSlimaApi(connection)

  return {
    status: () => connection.status(),

    start() {
      // Slima 的 token 在金鑰圈裡：先非同步讀進來（鑰匙圈提示出現時不會卡住畫面），再連線
      keys
        .load()
        .then(() => connection.start())
        .catch((error: unknown) => {
          log.warn(`啟動 Slima 連線失敗：${error instanceof Error ? error.message : ''}`)
        })
    },

    stop: () => connection.stop(),

    async connect(token) {
      await keys.save(SLIMA_KEY_ID, normalizeKey(token))
      await connection.restart()
      return connection.status()
    },

    async disconnect() {
      keys.delete(SLIMA_KEY_ID)
      await connection.stop()
      return connection.status()
    },

    async books() {
      return { books: await api.listBooks() }
    },

    reader: api,
  }
}
