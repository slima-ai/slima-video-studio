import type { CanvasLink } from '@svs/schema'
import type {
  Connection,
  FinalConnectionState,
  IsValidConnection,
  OnConnectStart,
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'
import type { Linking, PortRef } from './canvas-actions'
import { portsOf, type CanvasEdge, type Graph } from './canvas-model'
import { choicesFor, explainLink } from './connection-rules'

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

  const isValidConnection = useCallback<IsValidConnection<CanvasEdge>>(
    (connection) => explainLink(connection, graphRef.current) === undefined,
    [],
  )

  const onConnect = useCallback(
    (connection: Connection): void => {
      if (explainLink(connection, graphRef.current) !== undefined) return
      const message = linkMessage(connection, titleOf)
      call('canvas.link', linkOf(connection))
        .then(() => {
          onChanged()
          toast.show({
            key: 'canvas-link',
            message,
            action: { label: '復原', onAction: history.undo },
          })
        })
        .catch(fail)
    },
    [fail, history.undo, onChanged, toast],
  )

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
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

  return { linking, hint, isValidConnection, onConnect, onConnectStart, onConnectEnd, unlinkEdge }
}
