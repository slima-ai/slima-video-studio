import type { EngineEvent } from '@svs/engine'
import type { NodeRun } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { ProgressTracker } from './progress-tracker'

const HASH = 'a'.repeat(64)
const asset = (kind: 'image' | 'video', hash = HASH) => ({
  hash,
  kind,
  mime: kind === 'image' ? 'image/png' : 'video/mp4',
  bytes: 10,
})

const nodeRun = (nodeId: string, extra: Partial<NodeRun> = {}): NodeRun => ({
  id: `nr-${nodeId}`,
  runId: 'r1',
  nodeId,
  status: 'succeeded',
  cacheKey: HASH,
  ...extra,
})
const finished = (nodeId: string, extra: Partial<NodeRun> = {}): EngineEvent => ({
  type: 'node-finished',
  runId: 'r1',
  nodeId,
  nodeRun: nodeRun(nodeId, extra),
})
const started = (nodeId: string): EngineEvent => ({
  type: 'node-started',
  runId: 'r1',
  nodeId,
  nodeRunId: 'x',
})

function begin() {
  const t = new ProgressTracker()
  t.handle({ type: 'run-started', runId: 'r1' })
  return t
}

describe('ProgressTracker', () => {
  it('還沒開始 → 沒有快照；run-started 之後是「拆鏡頭中」', () => {
    const t = new ProgressTracker()
    expect(t.snapshot()).toBeUndefined()
    expect(t.handle(started('breakdown'))).toBeUndefined()
    t.handle({ type: 'run-started', runId: 'r1' })
    expect(t.snapshot()).toMatchObject({
      runId: 'r1',
      status: 'running',
      phase: 'breakdown',
      shots: [],
    })
  })

  it('拆鏡完成 → 建立每一鏡（等待中、帶描述）與標題', () => {
    const t = begin()
    const s = t.handle(
      finished('breakdown', {
        output: {
          title: '雨天的貓',
          shots: [{ description: '貓走在雨中' }, { description: '貓找到家' }],
        },
      }),
    )
    expect(s).toMatchObject({
      phase: 'shots',
      title: '雨天的貓',
      shots: [
        { index: 0, step: 'waiting', description: '貓走在雨中' },
        { index: 1, step: 'waiting', description: '貓找到家' },
      ],
    })
  })

  it('每鏡依 組 Prompt → 首幀 → 影片 前進，並記下縮圖與影片', () => {
    const t = begin()
    t.handle(finished('breakdown', { output: { shots: [{}, {}] } }))
    expect(t.handle(started('each[1]/prompt'))?.shots[1]?.step).toBe('prompt')
    expect(t.handle(started('each[1]/image'))?.shots[1]?.step).toBe('image')
    const img = asset('image', 'b'.repeat(64))
    expect(
      t.handle(finished('each[1]/image', { output: { image: img } }))?.shots[1]?.imageHash,
    ).toBe(img.hash)
    expect(t.handle(started('each[1]/video'))?.shots[1]?.step).toBe('video')
    const vid = asset('video', 'c'.repeat(64))
    const s = t.handle(finished('each[1]/video', { output: { video: vid } }))
    expect(s?.shots[1]).toMatchObject({ step: 'done', imageHash: img.hash, videoHash: vid.hash })
    expect(s?.shots[0]?.step).toBe('waiting')
  })

  it('沿用快取（cached）的步驟也算完成', () => {
    const t = begin()
    const s = t.handle(
      finished('each[0]/image', { status: 'cached', output: { image: asset('image') } }),
    )
    expect(s?.shots[0]?.imageHash).toBe(HASH)
  })

  it('比拆鏡結果更早出現的鏡頭編號也能處理（補齊前面的鏡頭）', () => {
    const t = begin()
    const s = t.handle(started('each[2]/image'))
    expect(s?.shots.map((x) => x.step)).toEqual(['waiting', 'waiting', 'image'])
  })

  it('某一鏡失敗 → 只有那一鏡標失敗，附上原因；取消與被擋下的不算失敗', () => {
    const t = begin()
    t.handle(finished('breakdown', { output: { shots: [{}, {}, {}] } }))
    const s = t.handle(
      finished('each[0]/video', {
        status: 'failed',
        error: { code: 'provider_rejected', retryable: false, userMessage: '內容被拒絕' },
      }),
    )
    expect(s?.shots[0]).toMatchObject({ step: 'failed', error: '內容被拒絕' })
    expect(t.handle(finished('each[1]/video', { status: 'blocked' }))).toBeUndefined()
    expect(t.handle(finished('each[2]/video', { status: 'cancelled' }))).toBeUndefined()
    expect(t.snapshot()?.shots[1]?.step).toBe('waiting')
  })

  it('接片：開始 → 階段變成「接成一支」；完成 → 記下成品', () => {
    const t = begin()
    expect(t.handle(started('join'))?.phase).toBe('join')
    const vid = asset('video', 'd'.repeat(64))
    expect(t.handle(finished('join', { output: { video: vid } }))?.finalVideoHash).toBe(vid.hash)
    const done = t.handle({ type: 'run-finished', runId: 'r1', status: 'succeeded' })
    expect(done).toMatchObject({ status: 'succeeded', phase: 'done' })
  })

  it('拆鏡或接片失敗 → 整體錯誤訊息；run-finished 失敗 / 取消', () => {
    const t = begin()
    const failure = {
      status: 'failed' as const,
      error: {
        code: 'invalid_response' as const,
        retryable: true,
        userMessage: '模型回傳格式不對',
      },
    }
    expect(t.handle(finished('breakdown', failure))?.error).toEqual({
      userMessage: '模型回傳格式不對',
      retryable: true,
    })
    expect(t.handle({ type: 'run-finished', runId: 'r1', status: 'failed' })).toMatchObject({
      status: 'failed',
    })
    const t2 = begin()
    expect(t2.handle({ type: 'run-finished', runId: 'r1', status: 'cancelled' })?.status).toBe(
      'cancelled',
    )
    const t3 = begin()
    expect(t3.handle(finished('join', failure))?.error?.userMessage).toBe('模型回傳格式不對')
  })

  it('花費累加；預算超過時帶白話訊息', () => {
    const t = begin()
    const entry = (amountUsd: number) => ({
      type: 'cost-recorded' as const,
      runId: 'r1',
      entry: {
        id: 'c',
        projectId: 'p',
        provider: 'fal',
        modelId: 'fal/x',
        amountUsd,
        estimated: false,
        createdAt: '2026-10-12T08:00:00.000Z',
      },
    })
    t.handle(entry(0.1))
    expect(t.handle(entry(0.25))?.costUsd).toBeCloseTo(0.35)
    const s = t.handle({
      type: 'budget-exceeded',
      runId: 'r1',
      scope: 'run',
      limitUsd: 1,
      projectedUsd: 2,
    })
    expect(s?.error?.userMessage).toContain('超過單次執行的上限')
  })

  it('fail() 與 patch()', () => {
    const t = new ProgressTracker()
    expect(t.patch({ exportedPath: '/x.mp4' })).toBeUndefined()
    const s = t.fail('f1', { userMessage: '預估太貴', retryable: false })
    expect(s).toMatchObject({ runId: 'f1', status: 'failed', error: { userMessage: '預估太貴' } })
    expect(t.patch({ exportedPath: '/x.mp4' })?.exportedPath).toBe('/x.mp4')
  })

  it('壞掉的輸出不會讓進度壞掉', () => {
    const t = begin()
    expect(t.handle(finished('breakdown', { output: 'oops' }))).toBeUndefined()
    expect(t.handle(finished('each[0]/image', { output: { image: 1 } }))).toBeUndefined()
    expect(t.handle(finished('each[0]/video', { output: {} }))).toBeUndefined()
    expect(t.handle(finished('join', { output: null }))).toBeUndefined()
    expect(t.handle(finished('each[0]/prompt'))).toBeUndefined()
    expect(t.handle(finished('other'))).toBeUndefined()
  })
})
