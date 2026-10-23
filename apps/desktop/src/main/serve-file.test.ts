import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseRange, serveFile } from './serve-file'

describe('parseRange', () => {
  it('a-b、a-（到檔尾）、-n（最後 n 個位元組）；超過檔尾的 b 截到檔尾', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 })
  })

  it('沒有標頭、格式不對、多個範圍 → 整個檔案照給（undefined）', () => {
    for (const header of [null, '', 'bytes=', 'bytes=-', 'items=0-1', 'bytes=a-b', 'bytes=0-1,5-9'])
      expect(parseRange(header, 1000), String(header)).toBeUndefined()
  })

  it('範圍在檔案外面 → unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=2000-3000', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=50-10', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})

describe('serveFile', () => {
  let dir: string
  let file: string
  const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'svs-serve-file-'))
    file = join(dir, 'film.mp4')
    writeFileSync(file, content)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const get = (range: string | null) =>
    serveFile(file, { mime: 'video/mp4', cacheControl: 'no-cache', range })
  const bytes = async (response: Response): Promise<Buffer> =>
    Buffer.from(await response.arrayBuffer())

  it('沒有 Range：整個檔案 200，宣告可以用 Range', async () => {
    const response = await get(null)
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await bytes(response)).toEqual(content)
  })

  it('Range：206、Content-Range 與內容都對（影片拖進度會從中間跳到檔尾）', async () => {
    const middle = await get('bytes=100-199')
    expect(middle.status).toBe(206)
    expect(middle.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(middle.headers.get('content-length')).toBe('100')
    expect(await bytes(middle)).toEqual(content.subarray(100, 200))

    const toEnd = await get('bytes=700-')
    expect(toEnd.status).toBe(206)
    expect(toEnd.headers.get('content-range')).toBe('bytes 700-999/1000')
    expect(await bytes(toEnd)).toEqual(content.subarray(700))

    const tail = await get('bytes=-50')
    expect(tail.headers.get('content-range')).toBe('bytes 950-999/1000')
    expect(await bytes(tail)).toEqual(content.subarray(950))
  })

  it('範圍在檔案外面 → 416 並說明檔案大小；檔案不見了 → 404', async () => {
    const response = await get('bytes=5000-')
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
    rmSync(file)
    expect((await get(null)).status).toBe(404)
  })
})
