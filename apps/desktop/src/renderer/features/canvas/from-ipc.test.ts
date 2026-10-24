import { t, type CanvasGraph, type CanvasNode } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { LETTERBOX_NOTE, toFlowGraph } from './from-ipc'

const HASH = 'a'.repeat(64)

const graph: CanvasGraph = {
  nodes: [
    {
      key: 'scene:s1',
      kind: 'scene',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      auto: true,
      title: '第 1 場・街角',
      sceneNo: 1,
    },
    {
      key: 'shot:a',
      kind: 'shot',
      x: 24,
      y: 44,
      auto: true,
      title: '第 1 鏡',
      summary: '貓在雨裡',
      meta: '中景・平視・3 秒',
      tags: ['阿鐵'],
      sceneKey: 'scene:s1',
      shotKey: 'shot:a',
    },
    {
      key: 'shot:a:image',
      kind: 'image',
      x: 309,
      y: 44,
      auto: true,
      title: '第一張畫面',
      status: 'done',
      assetHash: HASH,
      version: 2,
      modelId: 'img',
      sceneKey: 'scene:s1',
      shotKey: 'shot:a',
    },
    {
      key: 'shot:a:video',
      kind: 'video',
      x: 594,
      y: 44,
      auto: true,
      title: '影片',
      status: 'idle',
      inCut: false,
      sceneKey: 'scene:s1',
      shotKey: 'shot:a',
    },
    {
      key: 'character:c',
      kind: 'character',
      x: 60,
      y: 90,
      auto: true,
      title: '阿鐵',
      summary: '已鎖定',
    },
    {
      key: 'cut',
      kind: 'cut',
      x: 900,
      y: 290,
      auto: true,
      title: '剪輯',
      slots: [
        {
          id: 'cut-slot-1',
          sceneKey: 'scene:s1',
          label: '1・第 1 場',
          total: 2,
          used: 1,
          excluded: 1,
        },
      ],
    },
    { key: 'node:n', kind: 'free_video', x: 0, y: 500, auto: false, title: '自己的影片' },
  ],
  edges: [
    {
      id: 'e1',
      source: 'shot:a',
      sourcePort: 'shot-out',
      target: 'shot:a:image',
      targetPort: 'img-in',
      kind: 'data',
      free: false,
    },
    {
      id: 'e2',
      source: 'character:c',
      sourcePort: 'char-out',
      target: 'shot:a',
      targetPort: 'shot-ref-char',
      kind: 'reference',
      free: false,
    },
    {
      id: 'e3',
      source: 'scene:s1',
      sourcePort: 'scene-out',
      target: 'cut',
      targetPort: 'cut-slot-1',
      kind: 'data',
      free: false,
    },
  ],
}

describe('toFlowGraph', () => {
  const flow = toFlowGraph(graph)
  const node = (id: string) => flow.nodes.find((n) => n.id === id)

  it('場畫成可以只從標題拖的底層框，剪輯畫成直長型，其他畫成卡片並固定尺寸', () => {
    expect(node('scene:s1')).toMatchObject({ type: 'frame', width: 400, height: 300, zIndex: -1 })
    expect(node('cut')).toMatchObject({ type: 'cut', width: 260 })
    expect(node('shot:a')).toMatchObject({ type: 'card', width: 230, height: 246 })
  })

  it('節點資料：場與鏡頭的歸屬、角色標籤、放進成品、縮圖與版本', () => {
    expect(node('shot:a')?.data).toMatchObject({
      kind: 'shot',
      sceneId: 'scene:s1',
      shotId: 'shot:a',
      tags: ['阿鐵'],
      meta: '中景・平視・3 秒',
    })
    expect(node('shot:a:video')?.data).toMatchObject({ inCut: false, status: 'idle' })
    const image = node('shot:a:image')?.data
    expect(image?.thumb).toContain(HASH)
    expect(image?.footer).toBe('v2・img')
  })

  it('影片節點用影片檔當預覽（不是背景圖）；沒有影片檔就沒有預覽', () => {
    const withVideo = toFlowGraph({
      nodes: [
        {
          key: 'shot:b:video',
          kind: 'video',
          x: 0,
          y: 0,
          auto: true,
          title: '影片',
          status: 'done',
          assetHash: HASH,
          shotKey: 'shot:b',
        },
      ],
      edges: [],
    })
    expect(withVideo.nodes[0]?.data.videoSrc).toContain(HASH)
    expect(withVideo.nodes[0]?.data.thumb).toBeUndefined()
    expect(node('shot:a:video')?.data.videoSrc).toBeUndefined()
  })

  it('影片節點的裁切資料原樣帶到卡片上（徽章用）；沒裁的沒有', () => {
    const graph = toFlowGraph({
      nodes: [
        {
          key: 'shot:b:video',
          kind: 'video',
          x: 0,
          y: 0,
          auto: true,
          title: '影片',
          status: 'done',
          assetHash: HASH,
          shotKey: 'shot:b',
          trim: { startSec: 0, endSec: 3.5, videoSec: 5.041667 },
        },
        {
          key: 'shot:c:video',
          kind: 'video',
          x: 0,
          y: 0,
          auto: true,
          title: '影片',
          status: 'done',
          assetHash: HASH,
          shotKey: 'shot:c',
        },
      ],
      edges: [],
    })
    expect(graph.nodes[0]?.data.trim).toEqual({ startSec: 0, endSec: 3.5, videoSec: 5.041667 })
    expect(graph.nodes[1]?.data.trim).toBeUndefined()
  })

  it('剪輯的槽標出每場進成品的鏡數，有鏡頭沒放進去就標警示', () => {
    expect(node('cut')?.data.slots).toEqual([
      {
        id: 'cut-slot-1',
        label: '1・第 1 場',
        note: '1/2 鏡',
        partial: true,
        why: '有鏡頭沒放進成品',
      },
    ])
  })

  it('自由的影片畫成影片卡（縮圖用影片的第一格，不用背景圖）', () => {
    expect(node('node:n')?.data.kind).toBe('freeVideo')
    expect(node('node:n')?.data.thumb).toBeUndefined()
  })

  it('連線：參考連線是 ref，其他是主線，連接點對得上', () => {
    const edge = (id: string) => flow.edges.find((e) => e.id.includes(id))
    expect(flow.edges).toHaveLength(3)
    expect(edge('shot-ref-char')?.type).toBe('ref')
    expect(edge('img-in')?.type).toBe('flow')
    expect(edge('cut-slot-1')).toMatchObject({ sourceHandle: 'scene-out', target: 'cut' })
  })

  it('能剪的線：角色、地點接過去的線，和獨立圖片接出去的線；固定的一串不能剪', () => {
    const withImage = toFlowGraph({
      ...graph,
      nodes: [
        ...graph.nodes,
        { key: 'node:p', kind: 'free_image', x: 0, y: 700, auto: false, title: '雨夜' },
      ],
      edges: [
        ...graph.edges,
        {
          id: 'e4',
          source: 'node:p',
          sourcePort: 'free-img-out',
          target: 'shot:a:image',
          targetPort: 'img-first',
          kind: 'data',
          free: true,
        },
      ],
    })
    const cuttable = (id: string) =>
      withImage.edges.find((e) => e.id.includes(id))?.data?.cuttable === true
    expect(cuttable('img-first')).toBe(true)
    expect(cuttable('shot-ref-char')).toBe(true)
    expect(cuttable('img-in')).toBe(false)
    expect(cuttable('cut-slot-1')).toBe(false)
  })
})

describe('展開步驟的格子之間的線', () => {
  it('只是顯示用：標成 display，不畫「×」；鏡頭到圖的固定線與參考線照舊', () => {
    const steps = toFlowGraph({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          key: 'shot:a:step:prompt',
          kind: 'step',
          x: 24,
          y: 220,
          auto: true,
          title: '整理 Prompt',
          step: { stage: 'prompt', prompt: '貓在雨裡', edited: false },
        },
      ],
      edges: [
        ...graph.edges,
        {
          id: 'e5',
          source: 'shot:a',
          sourcePort: 'shot-steps',
          target: 'shot:a:step:prompt',
          targetPort: 'step-in',
          kind: 'data',
          free: false,
        },
        {
          id: 'e6',
          source: 'shot:a:step:prompt',
          sourcePort: 'step-out',
          target: 'shot:a:image',
          targetPort: 'img-in',
          kind: 'data',
          free: false,
        },
      ],
    })
    const display = (id: string) => steps.edges.find((e) => e.id.includes(id))?.data?.display
    expect(display('step-in')).toBe(true)
    expect(display('step-out')).toBe(true)
    // 沒有步驟的固定線不標 display（它照舊畫淡的「×」說明剪不掉的原因）；參考線照舊能剪
    expect(steps.edges.find((e) => e.id.includes('shot-ref-char'))?.data?.display).toBeUndefined()
    expect(steps.edges.find((e) => e.id.includes('shot-ref-char'))?.data?.cuttable).toBe(true)
  })
})

describe('首幀自動裁掉黑邊的提示', () => {
  const image = (letterboxTrimmed: boolean): CanvasGraph => ({
    nodes: [
      {
        key: 'shot:a:image',
        kind: 'image',
        x: 0,
        y: 0,
        auto: true,
        title: '第一張畫面',
        status: 'done',
        assetHash: HASH,
        version: 1,
        usage: {
          durationMs: 3200,
          costUsd: 0.14,
          createdAt: new Date().toISOString(),
          ...(letterboxTrimmed ? { letterboxTrimmed: true } : {}),
        },
      },
    ],
    edges: [],
  })

  it('裁過：卡片底部多「已自動裁掉黑邊」，滑過有完整說明（畫質可能較差、可以重新生成）；沒裁過就沒有', () => {
    const trimmed = toFlowGraph(image(true)).nodes[0]?.data
    expect(trimmed?.usageText).toContain('已自動裁掉黑邊')
    expect(trimmed?.usageText).toContain('US$0.14')
    expect(trimmed?.usageNote).toBe(t(LETTERBOX_NOTE))
    expect(t(LETTERBOX_NOTE)).toContain('畫質可能較差')
    expect(t(LETTERBOX_NOTE)).toContain('重新生成')
    const plain = toFlowGraph(image(false)).nodes[0]?.data
    expect(plain?.usageText).not.toContain('裁掉黑邊')
    expect(plain?.usageNote).toBeUndefined()
  })
})

describe('toFlowGraph：剪輯卡的成品說明（要重新接的原因照實寫）', () => {
  const footerOf = (final: CanvasNode['final']): string | undefined => {
    const withFinal = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.key === 'cut' ? { ...n, ...(final ? { final } : {}) } : n)),
    }
    return toFlowGraph(withFinal).nodes.find((n) => n.id === 'cut')?.data.footer
  }
  const base = {
    version: 3,
    assetHash: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-10-21T00:00:00.000Z',
  }

  it('對得上：只有版本與長度，沒有任何「要重新」的字', () => {
    const footer = footerOf({ ...base, durationSec: 9, stale: false })
    expect(footer).toContain('成品 v3')
    expect(footer).not.toContain('要重新')
  })

  it('鏡頭換了：鏡頭有變動，要重新接', () => {
    expect(footerOf({ ...base, stale: true, staleReason: 'shots' })).toContain(
      '鏡頭有變動，要重新接',
    )
    // 舊資料沒有原因：照舊當鏡頭
    expect(footerOf({ ...base, stale: true })).toContain('鏡頭有變動，要重新接')
  })

  it('只有聲音變了：寫聲音有變動、重混，不寫「鏡頭有變動」', () => {
    const footer = footerOf({ ...base, stale: true, staleReason: 'sound' })
    expect(footer).toContain('聲音有變動，要重新混音')
    expect(footer).not.toContain('鏡頭有變動')
  })
})
