import type { CanvasLink } from '@svs/schema'
import type {
  Connection,
  FinalConnectionState,
  IsValidConnection,
  OnConnectStart,
  OnReconnect,
  ReactFlowProps,
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'
import type { Linking, PortRef } from './canvas-actions'
import { portsOf, type CanvasEdge, type CanvasNode, type Graph } from './canvas-model'
import { choicesFor, explainLink, replacedEdge } from './connection-rules'

type OnReconnectStart = NonNullable<ReactFlowProps<CanvasNode, CanvasEdge>['onReconnectStart']>
type OnReconnectEnd = NonNullable<ReactFlowProps<CanvasNode, CanvasEdge>['onReconnectEnd']>

interface XY {
  x: number
  y: number
}

export interface UseLinkingOptions {
  graph: Graph
  /** 寫好之後馬上重新讀資料。 */
  onChanged: () => void
  /** 拉線放開在空白處：在那裡開新增選單（只列接得上的）。 */
  openAddMenu: (from: PortRef, at: XY) => void
  /** 這個連接點旁邊現在能新增幾種節點。 */
  addableCount: (portId: string, side: 'in' | 'out') => number
}

const HINT_MS = 1500

/** 兩端的節點鍵與連接點，給 `canvas.link`／`canvas.unlink`。 */
const linkOf = (c: {
  source: string
  sourceHandle?: string | null | undefined
  target: string
  targetHandle?: string | null | undefined
}): CanvasLink => ({
  source: { key: c.source, port: c.sourceHandle ?? '' },
  target: { key: c.target, port: c.targetHandle ?? '' },
})

/** 接上線之後的一行白話提示。 */
function linkMessage(connection: Connection, titleOf: (id: string) => string): string {
  const from = titleOf(connection.source)
  const to = titleOf(connection.target)
  switch (connection.targetHandle ?? '') {
    case 'shot-ref-char':
      return `「${from}」加進${to}的出場角色`
    case 'img-first':
      return `「${from}」設成${titleOf(connection.target.replace(/:image$/, ''))}的第一張畫面，影片要重跑才會用到`
    case 'char-ref':
    case 'loc-ref':
      return `「${from}」加成「${to}」的參考圖`
    default:
      return `「${from}」設成${to.split('・')[0] ?? ''}的地點`
  }
}

/**
 * 拉線：從連接點拉出去，接得上的點亮綠、接不上的淡掉；放開在接得上的點就寫回資料，
 * 放在接不上的點旁邊出一行白話提示，放在空白處開新增選單。剪線（線中點的「×」）也在這裡。
 */
export function useLinking({ graph, onChanged, openAddMenu, addableCount }: UseLinkingOptions) {
  const toast = useToast()
  const history = useHistory()
  const [linking, setLinking] = useState<Linking>()
  const [hint, setHint] = useState<{ at: XY; text: string }>()
  const graphRef = useRef(graph)
  graphRef.current = graph
  // 正在拖一條線的一端改接：這條線本身不算「已經接著」，改接的目標也不能再蓋掉別的線
  const reconnecting = useRef<CanvasEdge>(undefined)

  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => {
      setHint(undefined)
    }, HINT_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [hint])

  const titleOf = (id: string): string =>
    graphRef.current.nodes.find((n) => n.id === id)?.data.title ?? ''

  const fail = useCallback(
    (error: unknown): void => {
      toast.show({ message: errorText(error), tone: 'danger' })
    },
    [toast],
  )

  /** 改接時看的圖：拿掉正在拖的那條線，也不允許蓋掉目標上原本的線。 */
  const rewireView = (old: CanvasEdge): { graph: Graph } => ({
    graph: {
      nodes: graphRef.current.nodes,
      edges: graphRef.current.edges.filter((e) => e.id !== old.id),
    },
  })

  const isValidConnection = useCallback<IsValidConnection<CanvasEdge>>((connection) => {
    const old = reconnecting.current
    if (old) {
      const view = rewireView(old)
      return explainLink(connection, view.graph, { replace: false }) === undefined
    }
    return explainLink(connection, graphRef.current) === undefined
  }, [])

  const onConnect = useCallback(
    (connection: Connection): void => {
      // 改接一條線時，RF 也會呼叫 onConnect 之前的流程；這裡只處理新拉的線
      if (reconnecting.current) return
      if (explainLink(connection, graphRef.current) !== undefined) return
      const message = linkMessage(connection, titleOf)
      // 接進單線的輸入點（地點、第一張畫面）而且那裡已經有一條：取代它，同一筆復原
      const replaced = replacedEdge(connection, graphRef.current)
      const request = replaced
        ? call('canvas.relink', { from: linkOf(replaced), to: linkOf(connection) })
        : call('canvas.link', linkOf(connection))
      request
        .then(() => {
          onChanged()
          toast.show({
            key: 'canvas-link',
            message: replaced
              ? `${message}（原本的「${titleOf(replaced.source)}」拿掉了）`
              : message,
            action: { label: '復原', onAction: history.undo },
          })
        })
        .catch(fail)
    },
    [fail, history.undo, onChanged, toast],
  )

  /** 拖一條線的一端到別處：舊線換成新線，同一筆復原；接不上就說原因、線留在原處。 */
  const onReconnect = useCallback<OnReconnect<CanvasEdge>>(
    (oldEdge, connection) => {
      const reason = explainLink(connection, rewireView(oldEdge).graph, { replace: false })
      if (reason !== undefined) {
        toast.show({ message: reason })
        return
      }
      const unchanged =
        oldEdge.source === connection.source &&
        oldEdge.target === connection.target &&
        (oldEdge.sourceHandle ?? '') === (connection.sourceHandle ?? '') &&
        (oldEdge.targetHandle ?? '') === (connection.targetHandle ?? '')
      if (unchanged) return
      const message = linkMessage(connection, titleOf)
      call('canvas.relink', { from: linkOf(oldEdge), to: linkOf(connection) })
        .then(() => {
          onChanged()
          toast.show({
            key: 'canvas-link',
            message: `已改接：${message}`,
            action: { label: '復原', onAction: history.undo },
          })
        })
        .catch(fail)
    },
    [fail, history.undo, onChanged, toast],
  )

  /** 開始拖線的一端：和拉新線一樣，接得上的點亮綠、接不上的淡掉（原本的線不算已經接著）。 */
  const onReconnectStart = useCallback<OnReconnectStart>((_event, edge, handleType) => {
    reconnecting.current = edge
    const graphView = rewireView(edge).graph
    // 拖的是目標端 → 固定的是輸出端（從輸出點拉出去）；反過來是從輸入點拉
    const fromSide = handleType === 'target' ? 'out' : 'in'
    const fixedNode = fromSide === 'out' ? edge.source : edge.target
    const fixedHandle = fromSide === 'out' ? (edge.sourceHandle ?? '') : (edge.targetHandle ?? '')
    const valid = new Set<string>()
    for (const node of graphView.nodes) {
      if (node.id === fixedNode) continue
      for (const port of portsOf(node.data)) {
        if (port.side === fromSide) continue
        const connection =
          fromSide === 'out'
            ? {
                source: fixedNode,
                sourceHandle: fixedHandle,
                target: node.id,
                targetHandle: port.id,
              }
            : {
                source: node.id,
                sourceHandle: port.id,
                target: fixedNode,
                targetHandle: fixedHandle,
              }
        if (explainLink(connection, graphView, { replace: false }) === undefined) {
          valid.add(`${node.id}|${port.id}`)
        }
      }
    }
    setLinking({
      fromSide,
      valid,
      fromNode: fixedNode,
      validNodes: new Set([...valid].map((key) => key.split('|')[0] ?? '')),
    })
  }, [])

  /** 放開：接上了就由 onReconnect 處理；沒接上（放在空白處或接不上的點）線留在原處，說一聲。 */
  const onReconnectEnd = useCallback<OnReconnectEnd>((event, _edge, _type, state) => {
    reconnecting.current = undefined
    setLinking(undefined)
    if (state.isValid === true) return
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const at = { x: (point?.clientX ?? 0) + 14, y: (point?.clientY ?? 0) + 14 }
    setHint({
      at,
      text: state.toHandle ? '這裡接不上，線留在原處' : '沒有接到任何點，線留在原處',
    })
  }, [])

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    // 拖線的一端改接時 RF 也會呼叫這裡：高亮由 onReconnectStart 算好了，不要蓋掉
    if (reconnecting.current) return
    if (params.nodeId === null || params.handleId === null) return
    const fromSide = params.handleType === 'target' ? 'in' : 'out'
    const valid = new Set<string>()
    const current = graphRef.current
    for (const node of current.nodes) {
      if (node.id === params.nodeId) continue
      for (const port of portsOf(node.data)) {
        if (port.side === fromSide) continue
        const connection =
          fromSide === 'out'
            ? {
                source: params.nodeId,
                sourceHandle: params.handleId,
                target: node.id,
                targetHandle: port.id,
              }
            : {
                source: node.id,
                sourceHandle: port.id,
                target: params.nodeId,
                targetHandle: params.handleId,
              }
        if (explainLink(connection, current) === undefined) valid.add(`${node.id}|${port.id}`)
      }
    }
    setLinking({
      fromSide,
      valid,
      fromNode: params.nodeId,
      validNodes: new Set([...valid].map((key) => key.split('|')[0] ?? '')),
    })
  }, [])

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState): void => {
      // 改接時放在空白處不開新增選單（由 onReconnectEnd 說線留在原處）
      if (reconnecting.current) return
      setLinking(undefined)
      if (state.isValid === true) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const at = { x: point?.clientX ?? 0, y: point?.clientY ?? 0 }
      const { fromHandle, fromNode, toHandle, toNode } = state
      if (!fromHandle) return
      const fromIsSource = fromHandle.type === 'source'
      if (toHandle && toNode) {
        // 放在接不上的點上：說明為什麼
        const reason = explainLink(
          fromIsSource
            ? {
                source: fromNode.id,
                sourceHandle: fromHandle.id ?? null,
                target: toNode.id,
                targetHandle: toHandle.id ?? null,
              }
            : {
                source: toNode.id,
                sourceHandle: toHandle.id ?? null,
                target: fromNode.id,
                targetHandle: fromHandle.id ?? null,
              },
          graphRef.current,
        )
        if (reason) setHint({ at: { x: at.x + 14, y: at.y + 14 }, text: reason })
      } else if (!toNode) {
        const side = fromIsSource ? 'out' : 'in'
        const portId = fromHandle.id ?? ''
        if (addableCount(portId, side) === 0 || choicesFor(portId, side).length === 0) {
          setHint({
            at: { x: at.x + 14, y: at.y + 14 },
            text: '這裡沒有可以接上的東西，請拉到另一格的圓點上',
          })
        } else {
          openAddMenu({ nodeId: fromNode.id, portId, side }, at)
        }
      }
    },
    [addableCount, openAddMenu],
  )

  /** 線中點的「×」：剪掉這條資料關係（鏡頭少一個角色、場或鏡頭不再指到地點）。 */
  const unlinkEdge = useCallback(
    (edgeId: string): void => {
      const edge = graphRef.current.edges.find((e) => e.id === edgeId)
      if (!edge || edge.data?.cuttable !== true) return
      const from = titleOf(edge.source)
      const to = titleOf(edge.target)
      call('canvas.unlink', linkOf(edge))
        .then(() => {
          onChanged()
          toast.show({
            key: 'canvas-link',
            message: `已剪掉「${from}」到${to}的線`,
            action: { label: '復原', onAction: history.undo },
          })
        })
        .catch(fail)
    },
    [fail, history.undo, onChanged, toast],
  )

  return {
    linking,
    hint,
    isValidConnection,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnect,
    onReconnectStart,
    onReconnectEnd,
    unlinkEdge,
  }
}
