import { edgeFor } from '../features/canvas/connection-rules'
import {
  COL_X,
  NODE_SIZE,
  ROW_PITCH,
  SCENE_PAD,
  type CanvasEdge,
  type CanvasNode,
  type CutSlot,
  type Graph,
} from '../features/canvas/canvas-model'
import { refreshFrames, renumberShots, syncCut, syncTags } from '../features/canvas/geometry'

const SHOT_TEXT = [
  ['貓在雨裡縮著走，路燈閃爍', '全景・平視・5 秒'],
  ['貓停在倉庫門口，抬頭', '中景・低角度・5 秒'],
  ['門縫透出暖黃的光', '特寫・平視・5 秒'],
  ['貓慢慢走進溫暖的倉庫', '全景・跟拍・5 秒'],
] as const
const SCENE_TEXT = [
  ['街角', '下雨的夜晚'],
  ['舊倉庫', '溫暖的燈'],
] as const
const GRADIENTS = [
  'linear-gradient(160deg,#3b4a6b,#141a2b)',
  'linear-gradient(160deg,#4a3b6b,#1b1430)',
  'linear-gradient(160deg,#6b5a3b,#2b2210)',
  'linear-gradient(160deg,#2f4a5c,#0f1c25)',
] as const

/** 一個場區塊最多放幾個場、一個場最多幾個鏡頭：只是雛形的排版。 */
const SHOTS_PER_SCENE = 2
const SCENES_PER_COLUMN = 10
const SCENE_STRIDE_Y = SHOTS_PER_SCENE * ROW_PITCH + 90
const SCENE_STRIDE_X = COL_X.video + 230 + SCENE_PAD.x * 2 + 140
const MAX_CUT_SLOTS = 12

/**
 * 幾何與連線規則的單元測試用的示範資料（寫死，不碰資料庫）。`shotCount` 預設 4；
 * 調大可以量大量節點的流暢度（250 鏡約 1,000 個節點）。
 */
export function makeDemo(shotCount = 4): Graph {
  const nodes: CanvasNode[] = []
  const links: Parameters<typeof edgeFor>[0][] = []
  const sceneCount = Math.ceil(shotCount / SHOTS_PER_SCENE)
  const baseX = 420
  const baseY = 90

  nodes.push({
    id: 'oneliner',
    type: 'card',
    position: { x: 40, y: baseY },
    width: 300,
    height: 250,
    data: {
      kind: 'oneliner',
      title: '一句話',
      summary: '一隻貓在下雨的夜晚找到溫暖的家',
      meta: '日系動畫・5 個鏡頭・5 秒・橫式',
      footer: '預估約 US$1.30',
    },
  })
  const characters = [
    ['阿鐵', '已鎖定 v2', 'linear-gradient(135deg,#6d5bd0,#2f2a55)'],
    ['小花', '草稿', 'linear-gradient(135deg,#e8a0b4,#6a3b57)'],
  ] as const
  characters.forEach(([name, state, thumb], i) => {
    nodes.push({
      id: `char:${String(i)}`,
      type: 'card',
      position: { x: 60, y: baseY + 340 + i * 240 },
      width: 220,
      height: 200,
      data: { kind: 'character', title: name, summary: state, thumb },
    })
  })
  nodes.push({
    id: 'loc:0',
    type: 'card',
    position: { x: 60, y: baseY + 340 + 2 * 240 },
    width: 220,
    height: 200,
    data: {
      kind: 'location',
      title: '舊倉庫',
      summary: '主場景圖',
      thumb: 'linear-gradient(135deg,#7a8794,#2b333b)',
    },
  })

  const slots: CutSlot[] = []
  let shotNo = 0
  for (let s = 0; s < sceneCount; s++) {
    const col = Math.floor(s / SCENES_PER_COLUMN)
    const row = s % SCENES_PER_COLUMN
    const sceneId = `scene:${String(s)}`
    const [place, mood] = SCENE_TEXT[s % SCENE_TEXT.length] ?? ['場', '']
    nodes.push({
      id: sceneId,
      type: 'frame',
      position: { x: baseX + col * SCENE_STRIDE_X, y: baseY + row * SCENE_STRIDE_Y },
      width: 400,
      height: 300,
      zIndex: -1,
      dragHandle: '.svs-frame-grip',
      data: {
        kind: 'scene',
        title: `第 ${String(s + 1)} 場・${place}`,
        summary: mood,
        sceneNo: s + 1,
      },
    })
    links.push({
      source: 'oneliner',
      sourceHandle: 'story-out',
      target: sceneId,
      targetHandle: 'scene-story',
    })
    if (s < MAX_CUT_SLOTS) {
      slots.push({
        id: `cut-slot-${String(s + 1)}`,
        label: `${String(s + 1)}・第 ${String(s + 1)} 場`,
      })
    }
    for (let r = 0; r < SHOTS_PER_SCENE && shotNo < shotCount; r++, shotNo++) {
      const [text, meta] = SHOT_TEXT[shotNo % SHOT_TEXT.length] ?? ['', '']
      const shotId = `shot:${String(shotNo)}`
      const x = baseX + col * SCENE_STRIDE_X + SCENE_PAD.x
      const y = baseY + row * SCENE_STRIDE_Y + SCENE_PAD.top + r * ROW_PITCH
      nodes.push({
        id: shotId,
        type: 'card',
        position: { x: x + COL_X.shot, y },
        width: 230,
        height: NODE_SIZE.shot.h,
        data: {
          kind: 'shot',
          title: `第 ${String(shotNo + 1)} 鏡`,
          summary: text,
          meta,
          sceneId,
          shotId,
          tags: [],
        },
      })
      nodes.push({
        id: `${shotId}:image`,
        type: 'card',
        position: { x: x + COL_X.image, y },
        width: 230,
        height: NODE_SIZE.image.h,
        data: {
          kind: 'image',
          title: '第一張畫面',
          summary: 'Gemini 3 Pro Image',
          sceneId,
          shotId,
          status: shotNo % 4 === 3 ? 'idle' : 'done',
          thumb: GRADIENTS[shotNo % GRADIENTS.length],
          footer: '⏱ 6.1 秒・US$0.13・剛剛　v2 ▾',
        },
      })
      const videoDone = shotNo < 2 || shotNo % 5 === 0
      nodes.push({
        id: `${shotId}:video`,
        type: 'card',
        position: { x: x + COL_X.video, y },
        width: 230,
        height: NODE_SIZE.image.h,
        data: {
          kind: 'video',
          title: '影片',
          summary: 'Kling 3.0 Standard',
          sceneId,
          shotId,
          inCut: true,
          status: videoDone ? 'done' : 'idle',
          thumb: GRADIENTS[(shotNo + 3) % GRADIENTS.length],
          footer: '⏱ 48 秒・US$0.63・剛剛',
        },
      })
      links.push({
        source: shotId,
        sourceHandle: 'shot-out',
        target: `${shotId}:image`,
        targetHandle: 'img-in',
      })
      links.push({
        source: `${shotId}:image`,
        sourceHandle: 'img-out',
        target: `${shotId}:video`,
        targetHandle: 'vid-in',
      })
      if (shotNo % 2 === 0) {
        links.push({
          source: 'char:0',
          sourceHandle: 'char-out',
          target: shotId,
          targetHandle: 'shot-ref-char',
        })
      }
      if (shotNo % 3 === 0) {
        links.push({
          source: 'char:1',
          sourceHandle: 'char-out',
          target: shotId,
          targetHandle: 'shot-ref-char',
        })
      }
      if (shotNo % 2 === 1) {
        links.push({
          source: 'loc:0',
          sourceHandle: 'loc-out',
          target: shotId,
          targetHandle: 'shot-ref-loc',
        })
      }
    }
  }

  const lastCol = Math.floor((sceneCount - 1) / SCENES_PER_COLUMN)
  nodes.push({
    id: 'cut',
    type: 'cut',
    position: { x: baseX + (lastCol + 1) * SCENE_STRIDE_X - 40, y: baseY + 200 },
    data: {
      kind: 'cut',
      title: '剪輯',
      summary: `${String(shotCount)} 個鏡頭`,
      slots,
      footer: '成品還沒接',
      thumb: 'linear-gradient(135deg,#1f3d3a,#0c1a19)',
    },
  })
  slots.forEach((slot, i) => {
    links.push({
      source: `scene:${String(i)}`,
      sourceHandle: 'scene-out',
      target: 'cut',
      targetHandle: slot.id,
    })
  })

  const base: Graph = { nodes, edges: [] }
  const edges: CanvasEdge[] = []
  for (const link of links) {
    edges.push(
      edgeFor({ ...link, sourceHandle: link.sourceHandle, targetHandle: link.targetHandle }, nodes),
    )
  }
  return normalize({ ...base, edges })
}

/** 場框貼合內容、鏡頭上的角色標籤跟連線同步。 */
export function normalize(graph: Graph): Graph {
  const synced = syncCut(syncTags(graph))
  const nodes = refreshFrames(renumberShots(synced.nodes))
  return nodes === synced.nodes ? synced : { ...synced, nodes }
}
