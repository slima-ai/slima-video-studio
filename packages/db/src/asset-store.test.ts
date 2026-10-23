import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from './__tests__/helpers'
import { extensionForMime, kindForMime } from './asset-store'

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

describe('AssetStore', () => {
  it('以 sha256 命名存到 assets/ab/<hash>.<ext>，內容完整', async () => {
    const { assets, dir } = newProject()
    const result = await assets.put(PNG, 'image/png')
    expect(result.hash).toBe(sha256(PNG))
    expect(result.created).toBe(true)
    expect(result.bytes).toBe(PNG.length)
    expect(result.path).toBe(join(dir, 'assets', result.hash.slice(0, 2), `${result.hash}.png`))
    expect(readFileSync(result.path).equals(PNG)).toBe(true)
  })

  it('同一內容放兩次只存一份（檔案與資料庫列都只有一個）', async () => {
    const { assets, sqlite } = newProject()
    const a = await assets.put(Buffer.from('同樣的內容'), 'text/plain')
    const b = await assets.put(Buffer.from('同樣的內容'), 'text/plain')
    expect(a.hash).toBe(b.hash)
    expect([a.created, b.created]).toEqual([true, false])
    expect(assets.countFiles()).toBe(1)
    expect(sqlite.prepare('select count(*) from assets').pluck().get()).toBe(1)
  })

  it('不同內容各存一份；同時寫入相同內容也只會有一份', async () => {
    const { assets } = newProject()
    await Promise.all([
      assets.put(Buffer.from('x'), 'text/plain'),
      assets.put(Buffer.from('x'), 'text/plain'),
      assets.put(Buffer.from('y'), 'text/plain'),
    ])
    expect(assets.countFiles()).toBe(2)
  })

  it('支援串流寫入，雜湊與一次寫入相同', async () => {
    const { assets } = newProject()
    const chunks = [Buffer.from('第一段'), Buffer.from('第二段'), Buffer.from('第三段')]
    const streamed = await assets.put(Readable.from(chunks), 'video/mp4')
    const whole = sha256(Buffer.concat(chunks))
    expect(streamed.hash).toBe(whole)
    expect(streamed.bytes).toBe(Buffer.concat(chunks).length)
  })

  it('記錄素材中繼資料（種類、mime、大小、尺寸）', async () => {
    const { assets } = newProject()
    const { hash } = await assets.put(PNG, 'image/png', { width: 1, height: 1 })
    expect(assets.getMeta(hash)).toMatchObject({
      hash,
      kind: 'image',
      mime: 'image/png',
      bytes: PNG.length,
      width: 1,
      height: 1,
    })
  })

  it('updateMeta：補上或更正長度與大小，沒給的欄位不動', async () => {
    const { assets } = newProject()
    const { hash } = await assets.put(Buffer.from('video-bytes'), 'video/mp4', { durationSec: 5 })
    expect(assets.getMeta(hash)).toMatchObject({ durationSec: 5 })
    expect(assets.getMeta(hash)?.width).toBeUndefined()
    assets.updateMeta(hash, { width: 1280, height: 720, durationSec: 5.041667 })
    expect(assets.getMeta(hash)).toMatchObject({ width: 1280, height: 720, durationSec: 5.041667 })
    assets.updateMeta(hash, { durationSec: 4 })
    expect(assets.getMeta(hash)).toMatchObject({ width: 1280, height: 720, durationSec: 4 })
    assets.updateMeta(hash, {})
    expect(assets.getMeta(hash)?.durationSec).toBe(4)
  })

  it('串流中途出錯：丟出型別化錯誤，不留下暫存檔也不留下素材', async () => {
    const { assets } = newProject()
    const broken = new Readable({
      read() {
        this.push(Buffer.from('一半'))
        this.destroy(new Error('連線中斷'))
      },
    })
    await expect(assets.put(broken, 'video/mp4')).rejects.toMatchObject({ code: 'internal_error' })
    expect(assets.countFiles()).toBe(0)
    expect(assets.cleanTmp()).toBe(0)
  })

  it('find / has：不合法的雜湊與路徑穿越一律找不到', async () => {
    const { assets } = newProject()
    const { hash } = await assets.put(PNG, 'image/png')
    expect(assets.has(hash)).toBe(true)
    expect(assets.find(hash)?.mime).toBe('image/png')
    for (const bad of [
      '',
      'abc',
      '../../etc/passwd',
      `${hash}/../${hash}`,
      `${hash}.png`,
      hash.toUpperCase(),
      `${hash.slice(0, 63)}z`,
      'a'.repeat(64),
    ]) {
      expect(assets.has(bad), bad).toBe(false)
      expect(assets.find(bad), bad).toBeUndefined()
      expect(assets.getMeta(bad), bad).toBeUndefined()
    }
  })

  it('資料庫有紀錄但檔案被刪掉時，find 回傳 undefined', async () => {
    const { assets } = newProject()
    const { hash, path } = await assets.put(PNG, 'image/png')
    const { rmSync } = await import('node:fs')
    rmSync(path)
    expect(assets.find(hash)).toBeUndefined()
  })

  it('重開專案後素材仍在；啟動時清掉上次當機留下的暫存檔', async () => {
    const first = newProject()
    const { hash } = await first.assets.put(PNG, 'image/png')
    first.close()
    writeFileSync(join(first.dir, 'assets', '.tmp', 'leftover.part'), 'half')
    const second = reopen(first)
    expect(second.assets.has(hash)).toBe(true)
    expect(existsSync(join(first.dir, 'assets', '.tmp', 'leftover.part'))).toBe(false)
    expect(readdirSync(join(first.dir, 'assets', '.tmp'))).toEqual([])
  })
})

describe('mime 對應', () => {
  it('副檔名與種類', () => {
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg')
    expect(extensionForMime('application/x-unknown')).toBe('bin')
    expect(kindForMime('video/mp4')).toBe('video')
    expect(kindForMime('audio/mpeg')).toBe('audio')
    expect(kindForMime('application/json')).toBe('other')
  })
})
