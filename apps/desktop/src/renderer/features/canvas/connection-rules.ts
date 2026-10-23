import type { Connection } from '@xyflow/react'

import { portOf, type CanvasEdge, type CanvasNode, type EdgeTone, type Graph } from './canvas-model'
import { t, msg, type MessageRef } from '@svs/schema'

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

/** 手動接的單線輸入點：拉一條新線進來，會取代原本那條（地點、第一張畫面），不用先剪線。 */
const REPLACEABLE = new Set(['img-first', 'shot-ref-loc', 'scene-loc'])

/** 接錯時游標旁的一行白話提示（依輸出點）。 */
const WRONG_TARGET: Readonly<Record<string, MessageRef>> = {
  'story-out': msg('canvas.aOneLinerCanOnly'),
  'char-out': msg('canvas.aCharacterCanOnlyConnect'),
  'loc-out': msg('canvas.aLocationCanOnlyConnect'),
  'shot-out': msg('canvas.aShotCanOnlyConnect'),
  'img-out': msg('canvas.aPictureCanOnlyConnect'),
  'scene-out': msg('canvas.aSceneCanOnlyConnect'),
  'free-img-out': msg('canvas.aPictureCanConnectTo2'),
  'free-vid-out': msg('canvas.aVideoCanTConnect2'),
  'cut-out': msg('canvas.theCutIsTheLast'),
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
  options: { replace?: boolean } = {},
): string | undefined {
  const { source, target, sourceHandle, targetHandle } = connection
  if (source === target) return t('canvas.canTConnectToItself')
  const from = graph.nodes.find((n) => n.id === source)
  const to = graph.nodes.find((n) => n.id === target)
  const out = portOf(from, sourceHandle)
  const into = portOf(to, targetHandle)
  if (!from || !to || !out || !into || out.side !== 'out' || into.side !== 'in') {
    return t('canvas.canTConnectHere')
  }
  const outKind = portKind(out.id)
  const inKind = portKind(into.id)
  if (!(TARGETS[outKind] ?? []).includes(inKind)) {
    return t(WRONG_TARGET[outKind] ?? msg('canvas.canTConnectHere'))
  }
  if (outKind === 'shot-out' && from.data.shotId !== to.data.shotId) {
    return t('canvas.thisShotSPicturesAre')
  }
  const taken = graph.edges.filter((e) => e.target === target && e.targetHandle === into.id)
  if (taken.some((e) => e.source === source && e.sourceHandle === out.id)) {
    return outKind === 'char-out'
      ? t('canvas.isAlreadyInThisShot2', { title: from.data.title })
      : t('canvas.theseTwoAreAlreadyConnected2')
  }
  if (SINGLE.has(inKind) && taken.length > 0) {
    // 新拉的線取代原本那條（改接一條已經存在的線時不行：要先剪掉目標上原本的）
    if (REPLACEABLE.has(inKind) && options.replace !== false) return undefined
    if (inKind === 'cut-slot') return t('canvas.thisSceneIsAlreadyConnected')
    if (inKind === 'img-first') return t('canvas.thisPictureAlreadyHasA')
    if (inKind === 'shot-ref-loc' || inKind === 'scene-loc')
      return t('canvas.thereSAlreadyALocation')
    return t('canvas.thereSAlreadyALine')
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
  options: { replace?: boolean } = {},
): string | undefined {
  const reason = explainConnection(connection, graph, options)
  if (reason) return reason
  const from = graph.nodes.find((n) => n.id === connection.source)
  const to = graph.nodes.find((n) => n.id === connection.target)
  const out = portOf(from, connection.sourceHandle)
  const into = portOf(to, connection.targetHandle)
  return out && into && LINKABLE.has(`${portKind(out.id)}>${portKind(into.id)}`)
    ? undefined
    : t('canvas.theseTwoDonTNeed')
}

/** 新拉的線會取代掉的那條線（接進單線輸入點、而且那裡已經有一條）；沒有就是 undefined。 */
export function replacedEdge(
  connection: { target: string; targetHandle?: string | null | undefined },
  graph: Graph,
): CanvasEdge | undefined {
  const into = portOf(
    graph.nodes.find((n) => n.id === connection.target),
    connection.targetHandle,
  )
  if (!into || !REPLACEABLE.has(portKind(into.id))) return undefined
  return graph.edges.find((e) => e.target === connection.target && e.targetHandle === into.id)
}

/** 拖線的一端可以改接的線：目標連接點是這幾種（角色、地點、第一張畫面）。 */
export const isRewirable = (targetPort: string | null | undefined): boolean =>
  targetPort === 'shot-ref-char' || REPLACEABLE.has(targetPort ?? '')

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
    // 預設不能拖端點改接（固定的那一串）；從資料來的、可以剪的那幾種線在 from-ipc 再打開
    reconnectable: false,
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
