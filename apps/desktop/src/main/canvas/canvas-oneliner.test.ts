import { ONELINER_DEFAULTS, type CanvasGraph, type LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'
import { projectCanvas } from './projection'

// 每個測試都要跑完整的快速開始，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 假拆鏡：阿鐵在前兩鏡出場，小花只在第二鏡跟他同框。 */
const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: ['阿鐵'] },
          {
            description: '阿鐵和小花撿起小貓',
            size: 'close_up',
            cameraMove: null,
            characters: ['阿鐵', '小花'],
          },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

function setup() {
  const harness = createStudioHarness({ mockLlm: breakdown })
  harnesses.push(harness)
  const history = createHistoryService({ projects: harness.projects, broadcast: () => undefined })
  harness.projects.create(`${harness.root}/a.svsproj`, 'A')
  return { ...harness, history }
}

const frames = (graph: CanvasGraph) => graph.nodes.filter((n) => n.kind === 'scene')

describe('一句話節點', () => {
  it('新增 → 預設設定出現在畫布上；改設定、改故事，投影跟著變', () => {
    const { canvas } = setup()
    const added = canvas.add({ kind: 'oneliner', x: 100, y: 200 })
    expect(added.key).toMatch(/^node:/)
    const node = canvas.get().nodes.find((n) => n.key === added.key)
    expect(node).toMatchObject({ kind: 'oneliner', x: 100, y: 200, oneliner: ONELINER_DEFAULTS })

    canvas.updateOneliner({
      key: added.key,
      patch: { story: '一隻貓在雨夜找到家', style: 'anime', shotCount: 6 },
    })
    const after = canvas.get().nodes.find((n) => n.key === added.key)
    expect(after?.summary).toBe('一隻貓在雨夜找到家')
    expect(after?.oneliner).toMatchObject({ style: 'anime', shotCount: 6, durationSec: 5 })
  })

  it('還沒有專案時新增一句話：自動建專案', () => {
    const harness = createStudioHarness()
    harnesses.push(harness)
    expect(harness.projects.current()).toBeUndefined()
    const added = harness.canvas.add({ kind: 'oneliner' })
    expect(harness.projects.current()).toBeDefined()
    expect(harness.canvas.get().nodes.map((n) => n.key)).toEqual([added.key])
  })

  it('改不存在的一句話節點 → 白話錯誤；一句話不能接線', () => {
    const { canvas } = setup()
    expect(() => {
      canvas.updateOneliner({ key: 'node:nope', patch: { story: 'x' } })
    }).toThrow(/找不到這個「一句話」/)
    const added = canvas.add({ kind: 'oneliner' })
    expect(() =>
      canvas.add({ kind: 'oneliner', from: { key: added.key, port: 'story-out', side: 'out' } }),
    ).toThrow(/還不能接/)
  })

  it('新增、修改、刪除都能復原', () => {
    const { canvas, history } = setup()
    const added = history.record('新增一句話', () => canvas.add({ kind: 'oneliner' }))
    history.record('修改一句話', () => {
      canvas.updateOneliner({ key: added.key, patch: { story: '第一版' } })
    })
    history.record('刪除', () => canvas.remove({ keys: [added.key] }))
    expect(canvas.get().nodes).toHaveLength(0)

    history.undo()
    expect(canvas.get().nodes.find((n) => n.key === added.key)?.summary).toBe('第一版')
    history.undo()
    expect(canvas.get().nodes.find((n) => n.key === added.key)?.summary).toBe('')
    history.undo()
    expect(canvas.get().nodes).toHaveLength(0)
  })

  it('刪掉一句話時，連到它長出來的場的線也一起拿掉', async () => {
    const { canvas, runQuickStart } = setup()
    const { key } = canvas.add({ kind: 'oneliner' })
    await runQuickStart({ mode: 'append', sourceKey: key })
    expect(canvas.get().edges.some((e) => e.source === key)).toBe(true)
    expect(canvas.remove({ keys: [key] })).toEqual({ removed: 1 })
    expect(canvas.get().edges.some((e) => e.source === key)).toBe(false)
    expect(frames(canvas.get())).toHaveLength(1)
  })
})

describe('從一句話生成', () => {
  it('新增成新的場：鏡頭放進新場、一句話連一條線到它、草稿角色卡自動建好', async () => {
    const { canvas, characters, runQuickStart } = setup()
    const { key } = canvas.add({ kind: 'oneliner' })
    const done = await runQuickStart({ mode: 'append', sourceKey: key })
    expect(done.status).toBe('succeeded')

    const graph = canvas.get()
    const [scene] = frames(graph)
    expect(frames(graph)).toHaveLength(1)
    const shots = graph.nodes.filter((n) => n.kind === 'shot')
    expect(shots).toHaveLength(3)
    expect(shots.every((s) => s.sceneKey === scene?.key)).toBe(true)
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: key,
        sourcePort: 'story-out',
        target: scene?.key,
        targetPort: 'scene-story',
        free: true,
      }),
    )
    expect(characters.list().map((c) => c.name)).toEqual(['阿鐵', '小花'])
    expect(scene?.title).toContain('雨天的貓')
  })

  it('剪輯卡帶著接好的成品（第幾版、多長）；再新增成一場後，成品只有新的那一場，標成要重新接', async () => {
    const { canvas, runQuickStart } = setup()
    const { key } = canvas.add({ kind: 'oneliner' })
    await runQuickStart({ mode: 'append', sourceKey: key })
    const cut = () => canvas.get().nodes.find((n) => n.kind === 'cut')
    expect(cut()?.final).toMatchObject({ version: 1, stale: false })
    expect(cut()?.final?.durationSec).toBeGreaterThan(0)
    await runQuickStart({ mode: 'append', sourceKey: key, variation: 1 })
    expect(cut()?.final).toMatchObject({ version: 2, stale: true })
  })

  it('同一個一句話再生成一次：預設再多一個場，舊的鏡頭與圖影片都還在', async () => {
    const { canvas, outline, runQuickStart } = setup()
    const { key } = canvas.add({ kind: 'oneliner' })
    await runQuickStart({ mode: 'append', sourceKey: key })
    const firstShots = canvas
      .get()
      .nodes.filter((n) => n.kind === 'shot')
      .map((n) => n.key)
    await runQuickStart({ mode: 'append', sourceKey: key, variation: 1 })

    const graph = canvas.get()
    expect(frames(graph)).toHaveLength(2)
    expect(graph.nodes.filter((n) => n.kind === 'shot')).toHaveLength(6)
    for (const shot of firstShots) expect(graph.nodes.some((n) => n.key === shot)).toBe(true)
    expect(graph.edges.filter((e) => e.source === key)).toHaveLength(2)
    // 兩個場放在同一幕
    expect(outline.get().acts).toHaveLength(1)
  })

  it('取代全部：舊的鏡頭與大綱換成新的，舊的線不留', async () => {
    const { canvas, outline, runQuickStart } = setup()
    const { key } = canvas.add({ kind: 'oneliner' })
    await runQuickStart({ mode: 'append', sourceKey: key })
    await runQuickStart({ mode: 'append', sourceKey: key, variation: 1 })
    await runQuickStart({ mode: 'replace', sourceKey: key, variation: 2 })

    const graph = canvas.get()
    expect(frames(graph)).toHaveLength(1)
    expect(graph.nodes.filter((n) => n.kind === 'shot')).toHaveLength(3)
    expect(graph.edges.filter((e) => e.source === key)).toHaveLength(1)
    expect(outline.get().acts).toHaveLength(1)
  })

  it('沒有一句話節點卻指定了來源 → 檢查就擋下來', () => {
    const { quickstart } = setup()
    const check = quickstart.check({
      story: '故事',
      style: 'anime',
      shotCount: 3,
      durationSec: 3,
      aspectRatio: '16:9',
      variation: 0,
      mode: 'append',
      sourceKey: 'node:nope',
    })
    expect(check.ok).toBe(false)
    expect(check.issues[0]?.message).toMatch(/找不到這個「一句話」/)
  })
})

describe('生成中的節點狀態', () => {
  const shot = {
    id: 's1',
    projectId: 'p',
    number: 1,
    description: '貓',
    status: 'generating',
    characters: [],
    dialogue: '',
    action: '',
    inCut: true,
  } as never
  const base = {
    scenes: [],
    shots: [shot],
    adoptedTakes: [],
    characters: [],
    heroHashes: new Map(),
    locations: [],
    freeNodes: [],
    freeEdges: [],
    positions: new Map(),
  }
  const statuses = (
    live: Map<
      string,
      { step?: 'prompt' | 'image' | 'video'; error?: string; failedStep?: 'image' | 'video' }
    >,
    adoptedTakes: unknown[] = [],
  ) => {
    const graph = projectCanvas({ ...base, live, adoptedTakes: adoptedTakes as never })
    return {
      image: graph.nodes.find((n) => n.kind === 'image'),
      video: graph.nodes.find((n) => n.kind === 'video'),
    }
  }

  it('整理 Prompt／生圖時圖在執行、影片在排隊；生影片時影片在執行', () => {
    for (const step of ['prompt', 'image'] as const) {
      const { image, video } = statuses(new Map([['s1', { step }]]))
      expect([image?.status, video?.status]).toEqual(['running', 'queued'])
    }
    const { image, video } = statuses(new Map([['s1', { step: 'video' }]]))
    expect([image?.status, video?.status]).toEqual(['running', 'running'])
  })

  it('失敗：原因掛在第一個還沒有結果的節點上', () => {
    const { image, video } = statuses(new Map([['s1', { error: '模型忙線中' }]]))
    expect([image?.status, video?.status]).toEqual(['failed', 'idle'])
    expect(image?.error).toBe('模型忙線中')
  })

  it('知道失敗在哪一步：重做影片失敗時，影片標失敗（舊的結果還在），第一張畫面照常是完成', () => {
    const take = (kind: 'first_frame' | 'video') => ({
      id: kind,
      shotId: 's1',
      ownerType: 'shot',
      ownerId: 's1',
      kind,
      version: 1,
      assetHash: 'a'.repeat(64),
      adopted: true,
      modelId: 'm',
      createdAt: '2026-10-13T00:00:00.000Z',
    })
    const { image, video } = statuses(
      new Map([['s1', { error: '內容被拒絕', failedStep: 'video' as const }]]),
      [take('first_frame'), take('video')],
    )
    expect([image?.status, video?.status]).toEqual(['done', 'failed'])
    expect(video?.error).toBe('內容被拒絕')
  })
})
