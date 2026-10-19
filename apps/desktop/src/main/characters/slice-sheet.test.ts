import { createProject } from '@svs/db'
import { probe, resolveTools, runTool } from '@svs/media'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { sliceRanges, sliceSheet } from './slice-sheet'

describe('sliceRanges', () => {
  it('平均切三份', () => {
    expect(sliceRanges(300, { a: 1 / 3, b: 2 / 3 })).toEqual([
      { x: 0, width: 100 },
      { x: 100, width: 100 },
      { x: 200, width: 100 },
    ])
  })

  it('切線不在三分之一：三段加起來剛好是整張的寬度', () => {
    const parts = sliceRanges(1000, { a: 0.25, b: 0.8 })
    expect(parts.map((p) => p.width)).toEqual([250, 550, 200])
    expect(parts.reduce((n, p) => n + p.width, 0)).toBe(1000)
  })

  it('每段至少 1 個像素（切線貼得很近也不會出現 0 寬）', () => {
    for (const part of sliceRanges(5, { a: 0.1, b: 0.9 }))
      expect(part.width).toBeGreaterThanOrEqual(1)
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('sliceSheet（用 FFmpeg 真的切）', () => {
  it('切成三張，寬度符合切線；同樣的切線再切一次是同樣的檔案', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-slice-test-'))
    dirs.push(root)
    const handle = createProject({ dir: join(root, 'p.svsproj'), name: 'p' }, { appVersion: 't' })
    try {
      const tools = resolveTools()
      const sheet = await makeSheet(handle)
      const slices = await sliceSheet(handle, tools, sheet, { a: 0.25, b: 0.75 })
      const widths: number[] = []
      for (const hash of [slices.frontHash, slices.sideHash, slices.backHash]) {
        const found = handle.assets.find(hash)
        if (!found) throw new Error('沒有存起來')
        const info = await probe(tools, found.path)
        widths.push(info.width ?? 0)
        expect(info.height).toBe(360)
      }
      expect(widths).toEqual([160, 320, 160])
      expect(await sliceSheet(handle, tools, sheet, { a: 0.25, b: 0.75 })).toEqual(slices)
    } finally {
      handle.close()
    }
  })

  it('找不到設定稿時回報白話錯誤', async () => {
    const root = mkdtempSync(join(tmpdir(), 'svs-slice-test-'))
    dirs.push(root)
    const handle = createProject({ dir: join(root, 'p.svsproj'), name: 'p' }, { appVersion: 't' })
    try {
      await expect(
        sliceSheet(handle, resolveTools(), 'f'.repeat(64), { a: 0.3, b: 0.6 }),
      ).rejects.toThrow('找不到三視圖的設定稿')
    } finally {
      handle.close()
    }
  })
})

/** 用 FFmpeg 產生一張 640x360 的 PNG 當設定稿。 */
async function makeSheet(handle: ReturnType<typeof createProject>): Promise<string> {
  const out = join(handle.dir, 'sheet-src.png')
  await runTool(
    resolveTools().ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=1',
      '-frames:v',
      '1',
      out,
    ],
    {},
  )
  const stored = await handle.assets.put(new Uint8Array(await readFile(out)), 'image/png', {
    width: 640,
    height: 360,
  })
  return stored.hash
}
