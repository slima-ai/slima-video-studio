import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appendEndCard, overlayCard } from './credits'
import { probe } from './probe'
import { resolveTools, runTool } from './run'

const tools = resolveTools()
let dir = ''
const path = (name: string): string => join(dir, name)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'svs-credits-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('appendEndCard', () => {
  it('在最後接一張字卡：長度多出字卡的秒數、解析度不變、有聲音軌；原本的檔案不動', async () => {
    const B = ['-hide_banner', '-loglevel', 'error', '-y']
    await runTool(tools.ffmpegPath, [
      ...B,
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=24:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      path('film.mp4'),
    ])
    // 字卡圖大小跟影片不一樣也要能接（會等比縮放補黑邊）
    await runTool(tools.ffmpegPath, [
      ...B,
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1280x720',
      '-frames:v',
      '1',
      path('card.png'),
    ])
    const before = await probe(tools, path('film.mp4'))
    await appendEndCard(tools, path('film.mp4'), path('card.png'), path('out.mp4'), {
      cardSeconds: 2,
    })
    const out = await probe(tools, path('out.mp4'))
    expect(out.durationSec).toBeCloseTo(before.durationSec + 2, 0)
    expect(out.width).toBe(640)
    expect(out.height).toBe(360)
    expect(out.hasAudio).toBe(true)
    expect((await probe(tools, path('film.mp4'))).durationSec).toBeCloseTo(before.durationSec, 2)
  })
})

describe('overlayCard', () => {
  it('蓋在指定的一段上：長度、解析度、聲音軌都不變；那一段換成字卡、其他段落原樣', async () => {
    const B = ['-hide_banner', '-loglevel', 'error', '-y']
    await runTool(tools.ffmpegPath, [
      ...B,
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=24:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      path('film2.mp4'),
    ])
    await runTool(tools.ffmpegPath, [
      ...B,
      '-f',
      'lavfi',
      '-i',
      'color=c=red:size=640x360',
      '-frames:v',
      '1',
      path('red.png'),
    ])
    await overlayCard(tools, path('film2.mp4'), path('red.png'), path('over.mp4'), {
      fromSec: 3,
      toSec: 4,
    })
    const before = await probe(tools, path('film2.mp4'))
    const out = await probe(tools, path('over.mp4'))
    expect(out.durationSec).toBeCloseTo(before.durationSec, 1)
    expect(out.width).toBe(640)
    expect(out.hasAudio).toBe(true)
    // 取一格正中間的像素（1×1 的 ppm，最後 3 個位元組是 RGB）
    const pixel = async (sec: number): Promise<[number, number, number]> => {
      const file = path(`px-${String(sec)}.ppm`)
      await runTool(tools.ffmpegPath, [
        ...B,
        '-ss',
        String(sec),
        '-i',
        path('over.mp4'),
        '-frames:v',
        '1',
        '-vf',
        'format=rgb24,crop=1:1:320:180',
        file,
      ])
      const bytes = readFileSync(file)
      return [
        bytes[bytes.length - 3] ?? 0,
        bytes[bytes.length - 2] ?? 0,
        bytes[bytes.length - 1] ?? 0,
      ]
    }
    const inside = await pixel(3.5)
    expect(inside[0]).toBeGreaterThan(200) // 紅
    expect(inside[1]).toBeLessThan(60)
    const outside = await pixel(1)
    expect(outside[0] > 200 && outside[1] < 60).toBe(false) // 蓋之前的段落沒被蓋
  })
})
