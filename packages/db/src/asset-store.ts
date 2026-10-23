import { AppError, ContentHashSchema, type Asset, type AssetKind, t } from '@svs/schema'
import { createHash, randomUUID } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { desc, eq } from 'drizzle-orm'

import type { AppDb } from './database'
import { dropNulls } from './rows'
import { assets } from './tables/execution'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'application/json': 'json',
  'text/plain': 'txt',
}

export function extensionForMime(mime: string): string {
  return EXTENSIONS[mime.toLowerCase()] ?? 'bin'
}

export function kindForMime(mime: string): AssetKind {
  const top = mime.toLowerCase().split('/')[0]
  return top === 'image' || top === 'video' || top === 'audio' ? top : 'other'
}

export interface PutResult {
  hash: string
  /** 檔案的絕對路徑（assets/ab/<hash>.<ext>）。 */
  path: string
  mime: string
  bytes: number
  /** false 代表相同內容已經存在，沒有重複寫入。 */
  created: boolean
}

export interface AssetStoreOptions {
  now?: () => Date
}

/**
 * 內容雜湊素材庫：檔案以 sha256 命名，存在 `assets/<前兩碼>/<hash>.<ext>`，
 * 相同內容只會存一份。所有存取都只接受合法的雜湊，不接受路徑。
 */
export class AssetStore {
  private readonly now: () => Date

  constructor(
    private readonly rootDir: string,
    private readonly db: AppDb,
    options: AssetStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    mkdirSync(join(rootDir, '.tmp'), { recursive: true })
  }

  /** 寫入素材；一邊串流一邊算雜湊，寫完才改名到最終位置，所以不會留下寫到一半的檔案。 */
  async put(
    content: Buffer | Uint8Array | Readable,
    mime: string,
    meta: { width?: number; height?: number; durationSec?: number } = {},
  ): Promise<PutResult> {
    const tmpPath = join(this.rootDir, '.tmp', `${randomUUID()}.part`)
    const hash = createHash('sha256')
    let bytes = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        bytes += chunk.length
        callback(null, chunk)
      },
    })
    const source = content instanceof Readable ? content : Readable.from([Buffer.from(content)])

    try {
      await pipeline(source, counter, createWriteStream(tmpPath))
    } catch (cause) {
      rmSync(tmpPath, { force: true })
      throw new AppError({
        code: 'internal_error',
        userMessage: t('errors.couldnTSaveTheFile'),
        cause,
      })
    }

    const digest = hash.digest('hex')
    const existing = this.find(digest)
    if (existing) {
      rmSync(tmpPath, { force: true })
      return { hash: digest, path: existing.path, mime: existing.mime, bytes, created: false }
    }

    const finalPath = this.pathFor(digest, mime)
    mkdirSync(join(this.rootDir, digest.slice(0, 2)), { recursive: true })
    renameSync(tmpPath, finalPath)
    this.db
      .insert(assets)
      .values({
        hash: digest,
        kind: kindForMime(mime),
        mime,
        bytes,
        width: meta.width ?? null,
        height: meta.height ?? null,
        durationSec: meta.durationSec ?? null,
        createdAt: this.now().toISOString(),
      })
      .onConflictDoNothing()
      .run()
    return { hash: digest, path: finalPath, mime, bytes, created: true }
  }

  /** 找素材；雜湊不合法、或沒有這個素材時回傳 undefined。 */
  find(hash: string): { path: string; mime: string } | undefined {
    if (!ContentHashSchema.safeParse(hash).success) return undefined
    const row = this.db.select().from(assets).where(eq(assets.hash, hash)).get()
    if (!row) return undefined
    const path = this.pathFor(hash, row.mime)
    return existsSync(path) ? { path, mime: row.mime } : undefined
  }

  has(hash: string): boolean {
    return this.find(hash) !== undefined
  }

  getMeta(hash: string): Asset | undefined {
    if (!ContentHashSchema.safeParse(hash).success) return undefined
    const row = this.db.select().from(assets).where(eq(assets.hash, hash)).get()
    return row ? (dropNulls(row) as Asset) : undefined
  }

  /** 專案裡所有素材的資料（新的在前）。 */
  list(): Asset[] {
    return this.db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt))
      .all()
      .map((row) => dropNulls(row) as Asset)
  }

  /** 素材檔在磁碟上的位置（給「在資料夾中顯示」用；沒有這個素材就是 undefined）。 */
  locate(hash: string): string | undefined {
    return this.find(hash)?.path
  }

  /** 清掉上次當機留下的暫存檔。 */
  cleanTmp(): number {
    const dir = join(this.rootDir, '.tmp')
    const files = existsSync(dir) ? readdirSync(dir) : []
    for (const f of files) rmSync(join(dir, f), { force: true })
    return files.length
  }

  /** 素材庫佔用的檔案數量（不含暫存）。 */
  countFiles(): number {
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^[0-9a-f]{2}$/.test(d.name))
      .reduce((n, d) => n + readdirSync(join(this.rootDir, d.name)).length, 0)
  }

  private pathFor(hash: string, mime: string): string {
    return join(this.rootDir, hash.slice(0, 2), `${hash}.${extensionForMime(mime)}`)
  }
}

export function fileSize(path: string): number {
  return statSync(path).size
}
