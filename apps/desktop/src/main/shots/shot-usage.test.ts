import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from './test-harness'

vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [{ description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: [] }],
      }
    : undefined

describe('鏡頭版本的耗時與花費', () => {
  it('生成完：首幀圖與影片的版本都帶著耗時與花費（卡片上直接顯示）', async () => {
    const h = createStudioHarness({ mockLlm: breakdown, mockCostUsd: () => 0.25 })
    open.push(h)
    await h.runQuickStart({ shotCount: 1 })

    const shot = h.shots.list().shots[0]
    const frame = shot?.firstFrames[0]
    const video = shot?.videos[0]
    for (const take of [frame, video]) {
      expect(take?.costUsd).toBe(0.25)
      expect(take?.costEstimated).toBe(false)
      expect(take?.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('匯入的版本沒有生成紀錄：不帶耗時與花費', async () => {
    const h = createStudioHarness({ mockLlm: breakdown })
    open.push(h)
    await h.runQuickStart({ shotCount: 1 })
    const handle = h.projects.current()
    const shot = handle?.repos.shots.list()[0]
    if (!handle || !shot) throw new Error('應該有鏡頭')
    // 把所有任務改成失敗，模擬沒有成功生成紀錄的舊專案
    for (const job of handle.repos.jobs.list()) {
      handle.repos.jobs.put({ ...job, status: 'failed' })
    }
    const take = h.shots.list().shots[0]?.firstFrames[0]
    expect(take?.costUsd).toBeUndefined()
    expect(take?.durationMs).toBeUndefined()
  })
})
