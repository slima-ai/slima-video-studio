import type { ProjectHandle } from '@svs/db'
import { cropImage, probe, type MediaTools } from '@svs/media'
import { AppError, type TurnaroundCuts } from '@svs/schema'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Slices {
  frontHash: string
  sideHash: string
  backHash: string
}

/** 兩條切線換成三段（左到右）的像素範圍；每段至少 1 個像素寬。 */
export function sliceRanges(width: number, cuts: TurnaroundCuts): { x: number; width: number }[] {
  const a = Math.min(Math.max(Math.round(width * cuts.a), 1), width - 2)
  const b = Math.min(Math.max(Math.round(width * cuts.b), a + 1), width - 1)
  return [
    { x: 0, width: a },
    { x: a, width: b - a },
    { x: b, width: width - b },
  ]
}

/**
 * 把三視圖設定稿依兩條切線切成正面／側面／背面三張，存進素材庫。
 * 內容相同的圖不會重複儲存，所以用同樣的切線再切一次不會多出檔案。
 */
export async function sliceSheet(
  handle: ProjectHandle,
  tools: MediaTools,
  sheetHash: string,
  cuts: TurnaroundCuts,
  signal?: AbortSignal,
): Promise<Slices> {
  const sheet = handle.assets.find(sheetHash)
  if (!sheet) {
    throw new AppError({
      code: 'invalid_request',
      userMessage: '找不到三視圖的設定稿，可能已被刪除。',
    })
  }
  const options = signal ? { signal } : {}
  const info = await probe(tools, sheet.path, options)
  const { width, height } = info
  if (!width || !height || width < 3) {
    throw new AppError({ code: 'invalid_response', userMessage: '設定稿的圖片大小讀不出來。' })
  }
  const dir = await mkdtemp(join(tmpdir(), 'svs-slice-'))
  try {
    const hashes: string[] = []
    for (const [index, range] of sliceRanges(width, cuts).entries()) {
      const out = join(dir, `part-${String(index)}.png`)
      await cropImage(
        tools,
        sheet.path,
        out,
        { x: range.x, y: 0, width: range.width, height },
        options,
      )
      const stored = await handle.assets.put(new Uint8Array(await readFile(out)), 'image/png', {
        width: range.width,
        height,
      })
      hashes.push(stored.hash)
    }
    const [frontHash, sideHash, backHash] = hashes
    if (!frontHash || !sideHash || !backHash) {
      throw new AppError({ code: 'internal_error', userMessage: '切圖失敗，請再試一次。' })
    }
    return { frontHash, sideHash, backHash }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
