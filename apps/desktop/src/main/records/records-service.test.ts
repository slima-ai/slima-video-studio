import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { cleanPrompt } from './records-service'

// 每個測試都要跑完整的快速開始，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: [] },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

const setup = (): Harness => {
  const harness = createStudioHarness({ mockLlm: breakdown, mockCostUsd: () => 0.25 })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

describe('cleanPrompt', () => {
  it('拿掉系統為參考圖補的提醒；沒有就原樣', async () => {
    const { REFERENCE_PROMPT_SUFFIX } = await import('@svs/workflows')
    expect(cleanPrompt(`阿鐵走進雨裡${REFERENCE_PROMPT_SUFFIX}`)).toBe('阿鐵走進雨裡')
    expect(cleanPrompt('阿鐵走進雨裡')).toBe('阿鐵走進雨裡')
  })
})

describe('RecordsService.list', () => {
  it('還沒生成過：空的', () => {
    const h = setup()
    h.shots.create({})
    expect(h.records.list({})).toEqual({ records: [], total: 0, totalCostUsd: 0 })
  })

  it('生成完：每次圖片與影片都有一筆，附 prompt、模型、花費與結果，並對到鏡頭', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const snapshot = h.records.list({})

    const media = snapshot.records.filter((r) => r.kind === 'image' || r.kind === 'video')
    expect(media).toHaveLength(4)
    expect(snapshot.records.some((r) => r.kind === 'llm')).toBe(true)
    expect(snapshot.total).toBe(snapshot.records.length)
    // 新的在前
    const times = snapshot.records.map((r) => r.createdAt)
    expect([...times].sort().reverse()).toEqual(times)

    for (const record of media) {
      expect(record.status).toBe('succeeded')
      expect(record.prompt).toMatch(/阿鐵走進雨裡|雨停了/)
      expect(record.modelName).not.toBe('')
      expect(record.costUsd).toBeCloseTo(0.25)
      expect(record.result?.kind).toBe(record.kind)
      expect(record.target?.type).toBe('shot')
      expect(record.target?.label).toMatch(/^第 [12] 鏡$/)
      expect(record.canRedo).toBe(true)
      expect(record.params).toContain('16:9')
    }
    expect(media.find((r) => r.kind === 'video')?.params).toContain('3 秒')
    expect(snapshot.totalCostUsd).toBeGreaterThanOrEqual(1)
  })

  it('可以依種類與鏡頭篩選', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const first = h.shots.list().shots[0]
    const images = h.records.list({ kind: 'image' })
    expect(images.records.every((r) => r.kind === 'image')).toBe(true)
    expect(images.total).toBe(2)

    const ofShot = h.records.list({ shotId: first?.id ?? '' })
    expect(ofShot.records.map((r) => r.kind).sort()).toEqual(['image', 'video'])
    expect(h.records.list({ outcome: 'failed' }).total).toBe(0)
  })

  it('沒有專案：就是空的，不是錯誤', () => {
    const h = setup()
    expect(h.records.list({})).toEqual({ records: [], total: 0, totalCostUsd: 0 })
  })
})

describe('RecordsService.redo', () => {
  it('用同一段 prompt 再生成：鏡頭多一個新版本，舊的保留', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const first = h.shots.list().shots[0]
    const record = h.records.list({ shotId: first?.id ?? '', kind: 'image' }).records.at(0)
    expect(record).toBeDefined()
    const before = first?.firstFrames.length ?? 0

    await h.records.redo({ jobId: record?.id ?? '' })
    await h.idle(first?.id ?? '')

    const after = h.shots.list().shots[0]
    expect(after?.firstFrames.length).toBe(before + 1)
    expect(after?.error).toBeUndefined()
    // 新的一筆紀錄也出現了
    expect(h.records.list({ kind: 'image' }).total).toBe(3)
  })

  it('改過 prompt 再生成：鏡頭的 prompt 換成新的，新紀錄用的就是這段', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const first = h.shots.list().shots[0]
    const record = h.records.list({ shotId: first?.id ?? '', kind: 'image' }).records[0]

    await h.records.redo({ jobId: record?.id ?? '', prompt: '貓咪在雨中奔跑，電影感' })
    await h.idle(first?.id ?? '')

    expect(h.shots.list().shots[0]?.prompt).toBe('貓咪在雨中奔跑，電影感')
    const latest = h.records.list({ shotId: first?.id ?? '', kind: 'image' }).records[0]
    expect(latest?.prompt).toBe('貓咪在雨中奔跑，電影感')
  })

  it('找不到的紀錄、不能重生的紀錄：說明原因', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    await expect(h.records.redo({ jobId: 'nope' })).rejects.toThrow('找不到這筆紀錄')
    const llm = h.records.list({ kind: 'llm' }).records[0]
    expect(llm?.canRedo).toBe(false)
    await expect(h.records.redo({ jobId: llm?.id ?? '' })).rejects.toThrow('沒辦法直接重新生成')
  })
})
