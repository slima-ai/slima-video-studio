import type { Connection } from '@xyflow/react'

import { portOf, type CanvasEdge, type CanvasNode, type EdgeTone, type Graph } from './canvas-model'

/** 剪輯的輸入槽 id 是 `cut-slot-<n>`，規則上算同一種。 */
export const portKind = (portId: string): string =>
  portId.startsWith('cut-slot-') ? 'cut-slot' : portId

/** 每種輸出點可以接到哪些輸入點。 */
const TARGETS: Readonly<Record<string, readonly string[]>> = {
  'story-out': ['scene-story'],
  'char-out': ['shot-ref-char'],
  'loc-out': ['shot-ref-loc', 'scene-loc'],
  'shot-out': ['img-in'],
  'img-out': ['vid-in'],
  'scene-out': ['cut-slot'],
  'free-img-out': ['img-first', 'char-ref', 'loc-ref'],
  'cut-out': [],
}

/** 輸入點一次只收一條線。 */
const SINGLE = new Set(['img-in', 'img-first', 'vid-in', 'cut-slot', 'shot-ref-loc', 'scene-loc'])

/** 接錯時游標旁的一行白話提示（依輸出點）。 */
const WRONG_TARGET: Readonly<Record<string, string>> = {
  'story-out': '一句話只能接到場',
  'char-out': '角色只能接到鏡頭',
  'loc-out': '地點只能接到場或鏡頭',
  'shot-out': '鏡頭只能接到它的圖',
  'img-out': '圖只能接到影片',
  'scene-out': '場只能接到剪輯',
  'free-img-out': '圖片可以接到鏡頭的「第一張畫面」，或角色、地點的「參考圖」',
  'free-vid-out': '影片還不能接到別的格子',
  'cut-out': '剪輯是最後一步，沒有地方可以接',
}

/** 連得起來就回 undefined；連不起來回一行提示。 */
export function explainConnection(
  connection: {
    source: string
    target: string
    sourceHandle?: string | null | undefined
    targetHandle?: string | null | undefined
  },
  graph: Graph,
): string | undefined {
  const { source, target, sourceHandle, targetHandle } = connection
  if (source === target) return '不能接到自己'
  const from = graph.nodes.find((n) => n.id === source)
  const to = graph.nodes.find((n) => n.id === target)
  const out = portOf(from, sourceHandle)
  const into = portOf(to, targetHandle)
  if (!from || !to || !out || !into || out.side !== 'out' || into.side !== 'in') {
    return '這裡接不起來'
  }
  const outKind = portKind(out.id)
  const inKind = portKind(into.id)
  if (!(TARGETS[outKind] ?? []).includes(inKind)) {
    return WRONG_TARGET[outKind] ?? '這裡接不起來'
  }
  if (outKind === 'shot-out' && from.data.shotId !== to.data.shotId) {
    return '這個鏡頭的圖在它旁邊'
  }
  const taken = graph.edges.filter((e) => e.target === target && e.targetHandle === into.id)
  if (taken.some((e) => e.source === source && e.sourceHandle === out.id)) {
    return outKind === 'char-out' ? `${from.data.title}已經在這一鏡` : '這兩個已經接在一起了'
  }
  if (SINGLE.has(inKind) && taken.length > 0) {
    if (inKind === 'cut-slot') return '這一場已經接在剪輯上了'
    if (inKind === 'img-first') return '這張圖已經有第一張畫面了'
    if (inKind === 'shot-ref-loc' || inKind === 'scene-loc') return '這裡已經有地點了'
    return '這裡已經接了一條線'
  }
  return undefined
}

/** 現在拉得動、會寫回資料的線：角色→鏡頭、地點→鏡頭或場（其餘的線是固定的一串，或對應的節點還沒開放）。 */
const LINKABLE: ReadonlySet<string> = new Set([
  'char-out>shot-ref-char',
  'loc-out>shot-ref-loc',
  'loc-out>scene-loc',
  // 獨立圖片：當鏡頭的第一張畫面、加成角色或地點的參考圖
  'free-img-out>img-first',
  'free-img-out>char-ref',
  'free-img-out>loc-ref',
])

/** 同 `explainConnection`，再加上「這種線現在還不能手動接」。 */
export function explainLink(
  connection: Parameters<typeof explainConnection>[0],
  graph: Graph,
): string | undefined {
  const reason = explainConnection(connection, graph)
  if (reason) return reason
  const from = graph.nodes.find((n) => n.id === connection.source)
  const to = graph.nodes.find((n) => n.id === connection.target)
  const out = portOf(from, connection.sourceHandle)
  const into = portOf(to, connection.targetHandle)
  return out && into && LINKABLE.has(`${portKind(out.id)}>${portKind(into.id)}`)
    ? undefined
    : '這兩個不用手動接，它們會自己連在一起'
}

/** 這條線畫成主線還是參考線：兩端只要有一端是參考類就是參考線。 */
export function toneOf(
  connection: Parameters<typeof edgeFor>[0],
  nodes: readonly CanvasNode[],
): EdgeTone {
  const out = portOf(
    nodes.find((n) => n.id === connection.source),
    connection.sourceHandle,
  )
  const into = portOf(
    nodes.find((n) => n.id === connection.target),
    connection.targetHandle,
  )
  return out?.tone === 'ref' || into?.tone === 'ref' ? 'ref' : 'main'
}

export function edgeFor(
  connection: Pick<Connection, 'source' | 'target'> & {
    sourceHandle?: string | null | undefined
    targetHandle?: string | null | undefined
  },
  nodes: readonly CanvasNode[],
): CanvasEdge {
  const tone = toneOf(connection, nodes)
  const sourceHandle = connection.sourceHandle ?? ''
  const targetHandle = connection.targetHandle ?? ''
  return {
    id: `${connection.source}:${sourceHandle}->${connection.target}:${targetHandle}`,
    source: connection.source,
    sourceHandle,
    target: connection.target,
    targetHandle,
    type: tone === 'ref' ? 'ref' : 'flow',
    data: { tone },
    interactionWidth: 20,
  }
}

/** 從一個連接點拉線，放開在空白處時，選單裡列出哪幾種節點接得上（新節點的種類與要接的點）。 */
export interface AddChoice {
  kind:
    | 'oneliner'
    | 'scene'
    | 'shot'
    | 'image'
    | 'video'
    | 'cut'
    | 'character'
    | 'location'
    | 'freeImage'
    | 'freeVideo'
    | 'note'
    | 'group'
  /** 新節點上要接的連接點。 */
  port?: string
}

const FROM_OUT: Readonly<Record<string, readonly AddChoice[]>> = {
  // 一句話的線是生成時自己接的，不從「＋」新增
  'char-out': [{ kind: 'shot', port: 'shot-ref-char' }],
  'loc-out': [
    { kind: 'shot', port: 'shot-ref-loc' },
    { kind: 'scene', port: 'scene-loc' },
  ],
  // 鏡頭 → 圖 → 影片、場 → 剪輯是固定的一串，不從「＋」新增
  'free-img-out': [
    { kind: 'character', port: 'char-ref' },
    { kind: 'location', port: 'loc-ref' },
  ],
}

const FROM_IN: Readonly<Record<string, readonly AddChoice[]>> = {
  'shot-ref-char': [{ kind: 'character', port: 'char-out' }],
  'shot-ref-loc': [{ kind: 'location', port: 'loc-out' }],
  'scene-loc': [{ kind: 'location', port: 'loc-out' }],
  'img-first': [{ kind: 'freeImage', port: 'free-img-out' }],
  'char-ref': [{ kind: 'freeImage', port: 'free-img-out' }],
  'loc-ref': [{ kind: 'freeImage', port: 'free-img-out' }],
}

export function choicesFor(portId: string, side: 'in' | 'out'): readonly AddChoice[] {
  const key = portKind(portId)
  return (side === 'out' ? FROM_OUT[key] : FROM_IN[key]) ?? []
}
