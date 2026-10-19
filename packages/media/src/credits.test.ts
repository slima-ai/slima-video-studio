import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appendEndCard } from './credits'
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
