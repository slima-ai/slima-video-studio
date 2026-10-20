import type { CanvasGraph, CanvasNode as IpcNode, CanvasNodeKind } from '@svs/schema'

import { assetUrl } from '../../lib/asset'
import { timeAgo, usageLine } from '../../lib/usage'
import {
  CUT_WIDTH,
  NODE_SIZE,
  STEP_SIZE,
  cutHeight,
  type CanvasNode,
  type Graph,
  type NodeKind,
} from './canvas-model'
import { edgeFor, isRewirable } from './connection-rules'

/** 主行程的節點種類 → 畫面上的種類（舊的「上傳素材」種類畫成圖片卡）。 */
const KIND: Readonly<Record<CanvasNodeKind, NodeKind>> = {
  oneliner: 'oneliner',
  scene: 'scene',
  shot: 'shot',
  image: 'image',
  video: 'video',
  cut: 'cut',
  character: 'character',
  location: 'location',
  free_image: 'freeImage',
  free_video: 'freeVideo',
  upload: 'freeImage',
  note: 'note',
  group: 'group',
  step: 'step',
}

const thumbOf = (hash: string | undefined): string | undefined =>
  hash === undefined ? undefined : `url("${assetUrl(hash)}") center / cover no-repeat`

/** 影片長度：「0:15」「1:05」。 */
export const clockOf = (sec: number): string => {
  const whole = Math.round(sec)
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

/** 卡片底部那一行：「3.2 秒・約 US$0.02（估算）・剛剛」。 */
function usageTextOf(usage: IpcNode['usage']): string | undefined {
  if (!usage) return undefined
  const line = usageLine({ durationMs: usage.durationMs, costUsd: usage.costUsd })
  return [
    line ? `${line}${usage.costEstimated === true ? '（估算）' : ''}` : undefined,
    timeAgo(usage.createdAt),
  ]
    .filter(Boolean)
    .join('・')
}

function toNode(n: IpcNode): CanvasNode {
  const kind = KIND[n.kind]
  const data: CanvasNode['data'] = {
    kind,
    title: n.title,
    sceneId: n.sceneKey,
    shotId: n.shotKey,
    summary: n.summary,
    meta: n.meta,
    thumb: kind === 'video' || kind === 'freeVideo' ? undefined : thumbOf(n.assetHash),
    videoSrc:
      (kind === 'video' || kind === 'freeVideo') && n.assetHash !== undefined
        ? assetUrl(n.assetHash)
        : undefined,
    status: n.status,
    error: n.error,
    oneliner: n.oneliner,
    tags: n.tags,
    lockedTags: n.lockedTags,
    inCut: n.inCut,
    color: n.color,
    sceneNo: n.sceneNo,
    step: n.step,
    expanded: n.expanded,
    usageText: usageTextOf(n.usage),
    footer:
      n.version === undefined
        ? undefined
        : `v${String(n.version)}${n.modelId === undefined ? '' : `・${n.modelName ?? n.modelId}`}`,
  }
  if (kind === 'scene') {
    return {
      id: n.key,
      type: 'frame',
      position: { x: n.x, y: n.y },
      ...sized(n.width ?? 400, n.height ?? 300),
      zIndex: -1,
      dragHandle: '.svs-frame-grip',
      data,
    }
  }
  if (kind === 'group') {
    return {
      id: n.key,
      type: 'freeGroup',
      position: { x: n.x, y: n.y },
      ...sized(n.width ?? 480, n.height ?? 300),
      // 在場框底下：框住的格子都畫在它上面
      zIndex: -2,
      dragHandle: '.svs-group-grip',
      data,
    }
  }
  if (kind === 'step') {
    // 展開步驟的三格跟著鏡頭走：不能單獨拖、也不能選（裡面的 Prompt 可以直接改）
    return {
      id: n.key,
      type: 'step',
      position: { x: n.x, y: n.y },
      ...sized(STEP_SIZE.w, STEP_SIZE.h[n.step?.stage ?? 'model']),
      draggable: false,
      selectable: false,
      data,
    }
  }
  if (kind === 'cut') {
    const slots = (n.slots ?? []).map((slot) => ({
      id: slot.id,
      label: slot.label,
      note: `${String(slot.used)}/${String(slot.total)} 鏡`,
      partial: slot.used < slot.total,
      ...(slot.used < slot.total
        ? { why: slot.excluded > 0 ? '有鏡頭沒放進成品' : '有鏡頭還沒有影片' }
        : {}),
    }))
    const final = n.final
    return {
      id: n.key,
      type: 'cut',
      position: { x: n.x, y: n.y },
      ...sized(CUT_WIDTH, cutHeight(slots.length)),
      data: {
        ...data,
        slots,
        // 有成品：第一格當縮圖、可以播放，底部寫第幾版與長度；跟現在的影片對不上就提醒重新接
        ...(final
          ? {
              videoSrc: assetUrl(final.assetHash),
              thumb: undefined,
              footer: `成品 v${String(final.version)}${
                final.durationSec === undefined ? '' : ` · ${clockOf(final.durationSec)}`
              }${final.stale ? ' · 鏡頭有變動，要重新接' : ''}`,
              finalStale: final.stale,
            }
          : { footer: '成品還沒接', thumb: 'linear-gradient(135deg,#1f3d3a,#0c1a19)' }),
      },
    }
  }
  const size = NODE_SIZE[kind]
  return {
    id: n.key,
    type: 'card',
    position: { x: n.x, y: n.y },
    ...sized(size.w, size.h),
    data,
  }
}

/**
 * 節點的尺寸是固定的，直接當成「量好的尺寸」交給 React Flow。不帶 `measured` 的話，
 * 每次節點物件重建（選取、重新讀資料、長出動畫）React Flow 都會丟掉量好的尺寸與連接點位置重量一次，
 * 線會閃一下；畫面外的節點（onlyRenderVisibleElements）永遠量不到，fitView 就一直等不到完成。
 */
function sized(width: number, height: number): Pick<CanvasNode, 'width' | 'height' | 'measured'> {
  return { width, height, measured: { width, height } }
}

/** 把 `canvas.get` 的結果轉成 React Flow 用的節點與連線。 */
export function toFlowGraph(graph: CanvasGraph): Graph {
  const mapped = graph.nodes.map(toNode)
  // 影片節點要知道同一鏡的第一張畫面好了沒（▶ 的說明不同）
  const imageDone = new Set(
    mapped.filter((n) => n.data.kind === 'image' && n.data.status === 'done').map((n) => n.id),
  )
  const nodes = mapped.map((n) =>
    n.data.kind === 'video'
      ? {
          ...n,
          data: { ...n.data, imageReady: imageDone.has(n.id.replace(/:video$/, ':image')) },
        }
      : n,
  )
  const edges = graph.edges.map((e) => {
    const edge = edgeFor(
      {
        source: e.source,
        sourceHandle: e.sourcePort,
        target: e.target,
        targetHandle: e.targetPort,
      },
      nodes,
    )
    // 資料關係（角色、地點接到鏡頭或場）與獨立圖片接出去的線才能剪；
    // 鏡頭→圖→影片、場→剪輯是固定的一串
    const cuttable = e.free ? e.sourcePort === 'free-img-out' : e.kind === 'reference'
    if (!cuttable) return edge
    return {
      ...edge,
      data: { tone: edge.data?.tone ?? 'ref', cuttable: true },
      // 角色、地點、獨立圖片接到第一張畫面的線：拖兩端的點可以改接到別處
      reconnectable: isRewirable(e.targetPort),
    }
  })
  return { nodes, edges }
}
