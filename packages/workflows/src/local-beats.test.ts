import {
  AppError,
  type AssetRef,
  type CardJob,
  type NodeDefinition,
  type ReportedCost,
  type RunContext,
} from '@svs/schema'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { NODE_INFO, NODE_TYPES, cardVideoNode, stillVideoNode } from './nodes'
import { buildShotWorkflow } from './quickstart'
import { STUDIO_SERVICE_KEY, type StudioServices } from './services'

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const NOW = '2026-01-01T00:00:00.000Z'
const base = {
  style: 'realistic' as const,
  durationSec: 3,
  aspectRatio: '16:9' as const,
  models: { image: 'openrouter/gemini-3-pro-image', video: 'openrouter/kling-3.0-standard' },
  now: NOW,
}
const ref = (hash: string, kind: AssetRef['kind'] = 'image'): AssetRef => ({
  hash: hash.repeat(64),
  kind,
  mime: kind === 'image' ? 'image/png' : 'video/mp4',
  bytes: 1,
})

describe('一般鏡頭的單鏡流程跟加本機格子之前逐字相同（舊專案不會被標成「需要重跑」）', () => {
  // 這四個雜湊是在加「本機格子」之前，用同一份輸入跑現在的 buildShotWorkflow 量到的
  it('純文字生圖＋影片／有原聲有負面提示有角色禁忌／接上傳的圖／接上傳的圖加尾幀', () => {
    expect(sha(buildShotWorkflow(base))).toBe(
      '1ba54844f042abbb6020870bf5813c016a6429fe0e8be9108c7f4ed87006e527',
    )
    expect(
      sha(
        buildShotWorkflow({
          ...base,
          audio: true,
          negativePrompt: 'x',
          characterAvoids: [{ name: 'A', avoid: 'mouth' }] as never,
        }),
      ),
    ).toBe('76fe590b8fa6e15d5564f9a7185ddc24800758ac3ac58ae4360df3a27882af62')
    expect(sha(buildShotWorkflow({ ...base, firstFrame: ref('a') }))).toBe(
      '08173f95baeaaeb2b9dd377ad41d3af78b47ee334b84503454e28f3f7f6ac153',
    )
    expect(sha(buildShotWorkflow({ ...base, firstFrame: ref('a'), endFrame: ref('b') }))).toBe(
      '5535812ed83f9b8a2c0b1c44444d56cfd80c78863e16488eecb77ec4f78571c4',
    )
  })
})

describe('流程形狀：三種格子各一個', () => {
  const card: CardJob = { kind: 'card', text: '有些光，要有人陪你一起守', subtext: '' }

  it('字卡（與片名卡）：只有一個本機節點，不吃圖、沒有模型；節點編號仍叫 video（版本記錄照舊接得上）', () => {
    const flow = buildShotWorkflow({ ...base, beat: { kind: 'card', job: card } })
    expect(flow.nodes.map((n) => [n.id, n.type, n.modelId])).toEqual([
      ['video', NODE_TYPES.cardVideo, undefined],
      ['out', '$output', undefined],
    ])
    expect(
      flow.edges.map((e) => `${e.from.nodeId}.${e.from.port}>${e.to.nodeId}.${e.to.port}`),
    ).toEqual(['video.video>out.value'])
    const params = flow.nodes[0]?.params
    expect(params).toMatchObject({ card, durationSec: 3, aspectRatio: '16:9' })
  })

  it('靜態鏡頭：組提示 → 首幀圖 → 本機運鏡；沒有影片模型、沒有送給影片模型的提示與運鏡線', () => {
    const flow = buildShotWorkflow({ ...base, beat: { kind: 'still', motion: 'zoom_in' } })
    expect(flow.nodes.map((n) => [n.id, n.type])).toEqual([
      ['in', '$input'],
      ['prompt', NODE_TYPES.shotPrompt],
      ['image', NODE_TYPES.image],
      ['video', NODE_TYPES.stillVideo],
      ['out', '$output'],
    ])
    const video = flow.nodes.find((n) => n.id === 'video')
    expect(video?.modelId).toBeUndefined()
    expect(video?.params).toMatchObject({ durationSec: 3, motion: 'zoom_in', aspectRatio: '16:9' })
    const edges = flow.edges.map(
      (e) => `${e.from.nodeId}.${e.from.port}>${e.to.nodeId}.${e.to.port}`,
    )
    expect(edges).toContain('image.image>video.image')
    expect(edges).toContain('video.video>out.value')
    expect(
      edges.filter((e) => e.endsWith('>video.prompt') || e.endsWith('>video.cameraMove')),
    ).toEqual([])
    // 圖片節點還是要圖片模型
    expect(flow.nodes.find((n) => n.id === 'image')?.modelId).toBe(base.models.image)
  })

  it('靜態鏡頭接了上傳的圖：首幀是固定的圖，一樣接本機運鏡', () => {
    const flow = buildShotWorkflow({
      ...base,
      firstFrame: ref('a'),
      beat: { kind: 'still', motion: 'none' },
    })
    expect(flow.nodes.map((n) => n.type)).toContain(NODE_TYPES.fixedImage)
    expect(flow.nodes.find((n) => n.id === 'video')?.type).toBe(NODE_TYPES.stillVideo)
  })

  it('beat 是 video（或沒給）：就是一般流程', () => {
    expect(sha(buildShotWorkflow({ ...base, beat: { kind: 'video' } }))).toBe(
      sha(buildShotWorkflow(base)),
    )
  })

  it('兩個新節點有白話名稱與分類', () => {
    expect(NODE_INFO[NODE_TYPES.stillVideo]?.category).toBe('video')
    expect(NODE_INFO[NODE_TYPES.cardVideo]?.category).toBe('video')
  })
})

function run(
  def: NodeDefinition,
  args: { params: unknown; inputs?: Record<string, unknown>; studio: Partial<StudioServices> },
) {
  const costs: ReportedCost[] = []
  const ctx: RunContext = {
    params: def.params.parse(args.params),
    inputs: args.inputs ?? {},
    runInputs: {},
    modelId: undefined,
    signal: new AbortController().signal,
    nodeRunId: 'n',
    services: { [STUDIO_SERVICE_KEY]: args.studio },
    reportCost: (c) => costs.push(c),
    runSub: () => Promise.reject(new Error('不應呼叫')),
  }
  return Promise.resolve(def.run(ctx)).then((out) => ({ out, costs }))
}

describe('本機節點：不花錢、不呼叫任何供應商', () => {
  const generate = vi.fn(() => Promise.reject(new Error('不該呼叫供應商')))
  const concatVideos = vi.fn()

  it('video.still：交給本機運鏡，回傳影片；沒有 generate 呼叫、沒有花費', async () => {
    const stillToVideo = vi.fn<NonNullable<StudioServices['stillToVideo']>>(() =>
      Promise.resolve(ref('c', 'video')),
    )
    const { out, costs } = await run(stillVideoNode, {
      params: { durationSec: 2.5, aspectRatio: '16:9', motion: 'pan_left' },
      inputs: { image: ref('a') },
      studio: { generate, concatVideos, stillToVideo },
    })
    expect(out.video).toEqual(ref('c', 'video'))
    expect(stillToVideo).toHaveBeenCalledOnce()
    const [frame, options] = stillToVideo.mock.calls[0] ?? []
    expect(frame).toEqual(ref('a'))
    expect(options).toMatchObject({
      durationSec: 2.5,
      aspectRatio: '16:9',
      motion: 'pan_left',
      fps: 24,
    })
    expect(generate).not.toHaveBeenCalled()
    expect(costs).toEqual([])
  })

  it('video.card：交給本機字卡，回傳影片；沒有 generate 呼叫、沒有花費', async () => {
    const cardToVideo = vi.fn(() => Promise.resolve(ref('d', 'video')))
    const job: CardJob = {
      kind: 'title',
      title: '黑藤裂谷',
      author: '某作者',
      endLine: '12 月 1 日上市',
    }
    const { out, costs } = await run(cardVideoNode, {
      params: { card: job, durationSec: 4, aspectRatio: '9:16' },
      studio: { generate, concatVideos, cardToVideo },
    })
    expect(out.video).toEqual(ref('d', 'video'))
    expect(cardToVideo).toHaveBeenCalledWith(
      job,
      { durationSec: 4, aspectRatio: '9:16', fps: 24 },
      expect.anything(),
    )
    expect(generate).not.toHaveBeenCalled()
    expect(costs).toEqual([])
  })

  it('這個 App 沒有字卡服務（studio 沒給 cardToVideo）：白話錯誤，不是壞掉', async () => {
    await expect(
      run(cardVideoNode, {
        params: { card: { kind: 'card', text: 'x' }, durationSec: 2, aspectRatio: '16:9' },
        studio: { generate, concatVideos },
      }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('兩個節點都沒有 estimateCost（估價是 0）', () => {
    expect(stillVideoNode.estimateCost).toBeUndefined()
    expect(cardVideoNode.estimateCost).toBeUndefined()
  })
})
