import type { JobSummary } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp, textOf } from './test-support'
import { unresolvedFailures } from './tools/generation'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})
async function start(): Promise<Running> {
  const r = await startRealMcp()
  running.push(r)
  return r
}

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'
const Waited = z.looseObject({ finished: z.boolean() })
async function waitDone(r: Running): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 30 })).finished) return
  }
  throw new Error('生成一直沒結束')
}

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 'j',
  provider: 'p',
  modelId: 'm',
  kind: 'video',
  status: 'succeeded',
  attempt: 1,
  maxAttempts: 3,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
  ...over,
})

describe('M3：failed 只算現在還沒補好的', () => {
  it('同一鏡同一步失敗後又成功了：不再算；沒補好的、別鏡的失敗照算；成功在失敗之前不抵銷', () => {
    const jobs = [
      job({ id: '1', status: 'failed', stepLabel: '第 2 鏡' }),
      job({ id: '2', status: 'failed', stepLabel: '第 3 鏡' }),
      job({ id: '3', status: 'succeeded', stepLabel: '第 2 鏡' }),
      job({ id: '4', status: 'succeeded', stepLabel: '第 5 鏡' }),
      job({ id: '5', status: 'failed', stepLabel: '第 5 鏡' }),
      job({ id: '6', status: 'failed', stepLabel: '第 2 鏡', kind: 'image' }),
    ]
    // 第 2 鏡影片補好了（不算）；第 3 鏡沒補（算）；第 5 鏡成功在失敗之前（算）；第 2 鏡的圖失敗（算，種類不同）
    expect(unresolvedFailures(jobs)).toBe(3)
    expect(unresolvedFailures([])).toBe(0)
  })
})

describe('預告片的 MCP 小修（M1、M2、M4、M5、M7）', () => {
  it('M2：plan_trailer 只回摘要（沒有每一格、不叫人讀兩次）；M1：get_trailer 每一格有段落、成品裡幾秒開始，空欄位不回', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    const planned = JSON.parse(textOf(await r.call('plan_trailer', { text: STORY }))) as Record<
      string,
      unknown
    >
    expect(planned.beats).toBeUndefined()
    expect(planned.beatCount).toBeGreaterThan(5)
    expect(String(planned.next)).toContain('get_trailer')
    expect(textOf(await r.call('plan_trailer', { text: STORY })).length).toBeLessThan(2500)

    const looked = JSON.parse(textOf(await r.call('get_trailer'))) as {
      beats: Record<string, unknown>[]
    }
    let at = 0
    for (const beat of looked.beats) {
      expect(typeof beat.segment, `第 ${String(beat.number)} 格有 segment`).toBe('string')
      expect(beat.startSec).toBeCloseTo(at, 2)
      at += beat.durationSec as number
      // 空的欄位（空字串、null、空陣列）不回
      for (const [key, value] of Object.entries(beat)) {
        expect(value === '' || value === null, `${key} 不該是空的`).toBe(false)
        expect(Array.isArray(value) && value.length === 0, `${key} 不該是空陣列`).toBe(false)
      }
    }
    expect(looked.beats[0]?.startSec).toBe(0)
    expect(looked.beats.at(-1)?.segment).toBe('title')
  }, 60_000)

  it('M1：有地點的格子帶地點名字', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    await r.call('plan_trailer', { text: STORY })
    const beats = (
      JSON.parse(textOf(await r.call('get_trailer'))) as { beats: { location?: string }[] }
    ).beats
    // 示範腳本的地點在大綱裡；有帶地點的格子名字不是空的
    for (const beat of beats) if ('location' in beat) expect(beat.location).not.toBe('')
  }, 60_000)

  it('M4：字卡與片名卡不算「已經做好而略過」，另外給 noPictureNeeded', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    await r.call('plan_trailer', { text: STORY })
    const looked = JSON.parse(textOf(await r.call('get_trailer'))) as {
      beats: { beatKind: string }[]
    }
    const cards = looked.beats.filter((b) => b.beatKind === 'card' || b.beatKind === 'title').length
    expect(cards).toBeGreaterThan(0)
    const estimate = JSON.parse(
      textOf(await r.call('estimate_cost', { action: 'generate_first_frames' })),
    ) as { skippedAlreadyDone: number; noPictureNeeded?: number }
    expect(estimate.noPictureNeeded).toBe(cards)
    expect(estimate.skippedAlreadyDone).toBe(0)
    const started = JSON.parse(textOf(await r.call('generate_first_frames'))) as {
      skippedAlreadyDone: number
      noPictureNeeded?: number
    }
    expect(started.noPictureNeeded).toBe(cards)
    expect(started.skippedAlreadyDone).toBe(0)
    await waitDone(r)
  }, 60_000)

  it('M5：generate_narration 不給 shotId＝所有有台詞、還沒旁白的格子；都念過了就說沒有要做的；給 text 但沒給 shotId 被擋下', async () => {
    const r = await start()
    await r.call('create_project', { name: 'x' })
    await r.call('plan_trailer', { text: STORY })
    const before = JSON.parse(textOf(await r.call('get_sound'))) as {
      shots: { shotId: string; dialogue: string }[]
    }
    const withLines = before.shots.filter((s) => s.dialogue.trim() !== '')
    expect(withLines.length).toBeGreaterThan(1)

    const refused = await r.call('generate_narration', { text: '一句話' })
    expect((refused as { isError?: boolean }).isError).toBe(true)

    const made = JSON.parse(textOf(await r.call('generate_narration'))) as {
      made: number
      narrations: { shotId: string; clip: unknown }[]
    }
    expect(made.made).toBe(withLines.length)
    expect(made.narrations.map((n) => n.shotId).sort()).toEqual(
      withLines.map((s) => s.shotId).sort(),
    )
    const after = JSON.parse(textOf(await r.call('get_sound'))) as {
      shots: { dialogue: string; narration?: unknown }[]
    }
    expect(
      after.shots.filter((s) => s.dialogue.trim() !== '').every((s) => s.narration !== undefined),
    ).toBe(true)

    const again = JSON.parse(textOf(await r.call('generate_narration'))) as {
      made: number
      note: string
    }
    expect(again.made).toBe(0)
    expect(again.note).toContain('already')
    // 給 shotId 還是做那一格（新版本）
    const one = JSON.parse(
      textOf(await r.call('generate_narration', { shotId: withLines[0]?.shotId })),
    ) as { clip: { version: number } }
    expect(one.clip.version).toBe(2)
  }, 90_000)

  it('M7：create_project 可以直接給 aspectRatio（9:16），專案就是直式；不給就維持預設', async () => {
    const r = await start()
    const made = JSON.parse(
      textOf(await r.call('create_project', { name: '直式', aspectRatio: '9:16' })),
    ) as { aspectRatio?: string }
    expect(made.aspectRatio).toBe('9:16')
    const config = JSON.parse(textOf(await r.call('configure_project', {}))) as {
      aspectRatio: string
    }
    expect(config.aspectRatio).toBe('9:16')
    await r.call('create_project', { name: '預設' })
    const plain = JSON.parse(textOf(await r.call('configure_project', {}))) as {
      aspectRatio: string
    }
    expect(plain.aspectRatio).not.toBe('9:16')
  }, 60_000)
})
