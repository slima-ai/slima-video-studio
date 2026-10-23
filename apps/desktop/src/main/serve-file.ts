import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

export interface ByteRange {
  start: number
  end: number
}

/**
 * 解析 `Range: bytes=…`（只認單一範圍）：`a-b`、`a-`（到檔尾）、`-n`（最後 n 個位元組）。
 * 沒有這個標頭、格式看不懂、多個範圍 → undefined（整個檔案照給）；範圍在檔案外面 → 'unsatisfiable'。
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | undefined {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return undefined
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return undefined
  if (first === '') {
    const n = Number(last)
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(first)
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  if (start >= size || (last !== '' && Number(last) < start)) return 'unsatisfiable'
  return { start, end }
}

/**
 * 把一個本機檔案當成 HTTP 回應送出，支援 Range：影片要能拖進度（瀏覽器每次跳轉都會要「從這裡到檔尾」），
 * 回 206＋Content-Range；沒帶 Range 就整個檔案 200。（不要用 net.fetch 轉給 file://：它不認 Range，
 * 會用 200 回一段截掉的內容，影片一跳轉就回到 0 秒。）
 */
export async function serveFile(
  path: string,
  options: { mime: string; cacheControl: string; range: string | null },
): Promise<Response> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const base: Record<string, string> = {
    'content-type': options.mime,
    'x-content-type-options': 'nosniff',
    'cache-control': options.cacheControl,
    'accept-ranges': 'bytes',
  }
  const range = parseRange(options.range, size)
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...base, 'content-range': `bytes */${String(size)}` },
    })
  }
  const body = (start: number, end: number): ReadableStream =>
    Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  if (range === undefined) {
    if (size === 0)
      return new Response(null, { status: 200, headers: { ...base, 'content-length': '0' } })
    return new Response(body(0, size - 1), {
      status: 200,
      headers: { ...base, 'content-length': String(size) },
    })
  }
  return new Response(body(range.start, range.end), {
    status: 206,
    headers: {
      ...base,
      'content-range': `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      'content-length': String(range.end - range.start + 1),
    },
  })
}
