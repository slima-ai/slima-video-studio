import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const r of running.splice(0)) await r.close()
})

const Status = z.looseObject({
  busy: z.boolean(),
  shotsInProgress: z.array(z.number()).optional(),
  note: z.string().optional(),
})
const Waited = Status.extend({ finished: z.boolean() })

/**
 * 一鏡的生成是一串步驟（寫 prompt → 畫首幀 → 影片），每一步才各自進生成佇列。
 * 步驟之間（尤其是剛按下去、第一個任務還沒進佇列，或機器忙、下一步慢了一點）佇列是空的，
 * 但那一鏡還在做。等待工具只看佇列的話就會提早說「做完了」，AI 接著去接片，就會撞上「第 N 鏡還沒有可用的影片」。
 */

/** 把「那一鏡還在做」固定下來：佇列回空的、鏡頭帶著 activity（跟 launch 剛開始時 App 自己看到的一樣）。回傳的函式可以切換有沒有在做。 */
function freezeWorking(r: Running, step = 'prompt'): (on: boolean) => void {
  const realDispatch = r.registry.dispatch.bind(r.registry)
  let working = true
  r.registry.dispatch = async (raw, ctx) => {
    const channel = (raw as { channel?: string }).channel
    if (channel === 'queue.list') return { ok: true, data: { jobs: [] } }
    const result = await realDispatch(raw, ctx)
    if (channel === 'shots.list' && working && result.ok) {
      const data = result.data as { shots: Record<string, unknown>[] }
      return {
        ok: true,
        data: { ...data, shots: data.shots.map((s) => ({ ...s, activity: { step } })) },
      }
    }
    return result
  }
  return (on) => {
    working = on
  }
}

describe('wait_for_generation：佇列空著、但有鏡頭還在做的時候不算做完', () => {
  it('鏡頭在「進行中」（還沒有任務進佇列）：回 finished=false、列出是第幾鏡；做完才回 true', async () => {
    const r = await startRealMcp()
    running.push(r)
    await r.call('create_project', { name: 'x' })
    await r.call('create_shot', {})

    const setWorking = freezeWorking(r)

    const started = Date.now()
    const waiting = dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 1 }))
    expect(waiting.finished).toBe(false)
    expect(waiting.busy).toBe(true)
    expect(waiting.shotsInProgress).toEqual([1])
    // 真的等了（不是一看到空佇列就回）
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)

    setWorking(false)
    const done = dataOf(Waited, await r.call('wait_for_generation', { maxSeconds: 1 }))
    expect(done.finished).toBe(true)
    expect(done.shotsInProgress).toBeUndefined()
  }, 30_000)

  it('同一鏡停在同一步超過 10 分鐘：回一句 AI 看得懂的話（第幾鏡、哪一步、幾分鐘、查 get_shot、取消再重做）；之前沒有', async () => {
    const r = await startRealMcp()
    running.push(r)
    await r.call('create_project', { name: 'x' })
    await r.call('create_shot', {})
    const setWorking = freezeWorking(r, 'video')
    const t0 = Date.now()

    const early = dataOf(Status, await r.call('get_generation_status'))
    expect(early.busy).toBe(true)
    expect(early.note).toBeUndefined()

    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(t0 + 9 * 60_000)
    expect(dataOf(Status, await r.call('get_generation_status')).note).toBeUndefined()

    clock.mockReturnValue(t0 + 11 * 60_000)
    const late = dataOf(Status, await r.call('get_generation_status'))
    expect(late.busy).toBe(true)
    expect(late.note).toContain('shot 1 (step video, 11 minutes)')
    expect(late.note).toContain('get_shot')
    expect(late.note).toContain('cancel_generation')
    expect(late.note).toContain('regenerate_shot')

    // 做完之後又開始新的一輪：重新算，不會一開始就說等太久
    setWorking(false)
    expect(dataOf(Status, await r.call('get_generation_status')).busy).toBe(false)
    setWorking(true)
    clock.mockReturnValue(t0 + 12 * 60_000)
    expect(dataOf(Status, await r.call('get_generation_status')).note).toBeUndefined()
  }, 30_000)

  it('沒有開專案：get_generation_status 照樣回得出來（沒有鏡頭可看，就只看佇列）', async () => {
    const r = await startRealMcp()
    running.push(r)
    const status = dataOf(Status, await r.call('get_generation_status'))
    expect(status.busy).toBe(false)
  })
})
