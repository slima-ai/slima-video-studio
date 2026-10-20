import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { coverRect, detectContentBox, letterboxContent, trimLetterbox } from './letterbox'
import { probe } from './probe'
import { resolveTools, runTool } from './run'

const tools = resolveTools()
let dir = ''
const path = (name: string): string => join(dir, name)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-letterbox-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 用 FFmpeg 的 lavfi 畫出 1376×768 的藍灰底圖（加一塊白色方塊，四邊都不是黑的），再用 drawbox 畫上黑邊。 */
async function makeImage(name: string, boxes: readonly string[]): Promise<string> {
  const out = path(name)
  const filters = [
    'color=c=0x5a7aa0:s=1376x768:r=1:d=1',
    'drawbox=x=300:y=200:w=400:h=300:color=white:t=fill',
    ...boxes,
  ].join(',')
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    filters,
    '-frames:v',
    '1',
    out,
  ])
  return out
}

const bar = (x: number, y: number, w: number, h: number): string =>
  `drawbox=x=${String(x)}:y=${String(y)}:w=${String(w)}:h=${String(h)}:color=black:t=fill`

describe('letterboxContent（算不算電影黑邊）', () => {
  const size = { width: 1376, height: 768 }
  it('上下兩條差不多寬、左右沒有：算；內容範圍原樣回傳', () => {
    const content = { x: 0, y: 97, width: 1376, height: 574 }
    expect(letterboxContent(size, content)).toEqual(content)
  })

  it('左右兩條（直立黑邊）也算', () => {
    const content = { x: 200, y: 0, width: 976, height: 768 }
    expect(letterboxContent(size, content)).toEqual(content)
  })

  it('只有一邊黑（夜景的黑天空）、兩邊差太多、黑邊太細、四邊都有：都不算', () => {
    expect(letterboxContent(size, { x: 0, y: 200, width: 1376, height: 568 })).toBeUndefined()
    expect(letterboxContent(size, { x: 0, y: 40, width: 1376, height: 600 })).toBeUndefined()
    expect(letterboxContent(size, { x: 0, y: 4, width: 1376, height: 760 })).toBeUndefined()
    expect(letterboxContent(size, { x: 80, y: 97, width: 1216, height: 574 })).toBeUndefined()
    expect(letterboxContent(size, { x: 0, y: 0, width: 1376, height: 768 })).toBeUndefined()
  })
})

describe('coverRect（從內容裡置中取指定比例）', () => {
  it('內容比要求的寬（2.4:1 → 16:9）：裁左右，高度不變，置中', () => {
    const rect = coverRect({ x: 0, y: 97, width: 1376, height: 574 }, 16 / 9)
    expect(rect).toEqual({ x: 178, y: 97, width: 1020, height: 574 })
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 1)
  })

  it('內容比要求的高（直立黑邊 → 16:9）：裁上下，寬度不變，置中', () => {
    const rect = coverRect({ x: 200, y: 0, width: 976, height: 768 }, 16 / 9)
    expect(rect.x).toBe(200)
    expect(rect.width).toBe(976)
    expect(rect.height).toBe(548)
    expect(rect.y).toBe(110)
  })
})

describe('detectContentBox／trimLetterbox（真的 FFmpeg）', () => {
  it('上下各 97 像素黑邊（2.4:1）：找得到內容範圍；裁掉、補回 16:9、放大回 1376×768，不再有黑邊', async () => {
    const input = await makeImage('bars.png', [bar(0, 0, 1376, 97), bar(0, 671, 1376, 97)])
    const found = await detectContentBox(tools, input)
    expect(found).toMatchObject({ width: 1376, height: 768 })
    expect(found.content.y).toBeGreaterThanOrEqual(96)
    expect(found.content.y).toBeLessThanOrEqual(98)
    expect(found.content.height).toBeGreaterThanOrEqual(572)
    expect(found.content.height).toBeLessThanOrEqual(576)

    const output = path('bars-trimmed.png')
    expect(await trimLetterbox(tools, input, output, 16 / 9)).toBe(true)
    const info = await probe(tools, output)
    expect([info.width, info.height]).toEqual([1376, 768])
    // 處理後的圖不再有黑邊
    const again = await detectContentBox(tools, output)
    expect(again.content.y).toBeLessThanOrEqual(1)
    expect(again.content.height).toBeGreaterThanOrEqual(766)
  })

  it('左右各 200 像素黑邊：也裁掉、補回 16:9', async () => {
    const input = await makeImage('pillar.png', [bar(0, 0, 200, 768), bar(1176, 0, 200, 768)])
    const output = path('pillar-trimmed.png')
    expect(await trimLetterbox(tools, input, output, 16 / 9)).toBe(true)
    const again = await detectContentBox(tools, output)
    expect(again.content.x).toBeLessThanOrEqual(1)
    expect(again.content.width).toBeGreaterThanOrEqual(1374)
  })

  it('沒有黑邊、只有上面黑一大塊（黑天空）、黑邊太細：都不動，不產生輸出檔', async () => {
    const cases: [string, string[]][] = [
      ['plain.png', []],
      ['sky.png', [bar(0, 0, 1376, 200)]],
      ['thin.png', [bar(0, 0, 1376, 4), bar(0, 764, 1376, 4)]],
    ]
    for (const [name, boxes] of cases) {
      const input = await makeImage(name, boxes)
      const output = path(`${name}.out.png`)
      expect(await trimLetterbox(tools, input, output, 16 / 9), name).toBe(false)
      expect(existsSync(output), name).toBe(false)
    }
  })
})
