import type { CanvasMove } from '@svs/schema'
import type { OnNodeDrag, ReactFlowInstance } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CanvasEdge, CanvasNode } from './canvas-model'
import {
  chainOf,
  insideGroup,
  isFrame,
  isGroup,
  membersOf,
  nextSlot,
  placeChain,
  refreshFrames,
  rectOf,
  sceneAt,
  snapToNodes,
  type Guide,
} from './geometry'
import { t } from '@svs/schema'

interface XY {
  x: number
  y: number
}

/** 拖動中整串節點的層級：蓋過別的場裡的節點。 */
const RAISED_Z = 1000

/** 拖動事件的游標位置（觸控也算）。 */
function pointerOf(event: MouseEvent | TouchEvent): XY {
  const point = 'touches' in event ? event.touches[0] : event
  return { x: point?.clientX ?? 0, y: point?.clientY ?? 0 }
}

/** 拖動中（以及放開後、等資料重新載入前）畫面上要蓋過資料的部分。 */
interface Live {
  positions: ReadonlyMap<string, XY>
  /** 換了場的節點（節點鍵 → 場節點鍵）。 */
  sceneOf: ReadonlyMap<string, string>
  /** 游標進了別的場框：原本的框暫時不算這些成員，才不會撐大去壓到別的框。 */
  away: ReadonlySet<string> | undefined
  raised: ReadonlySet<string>
  /** 放開後要移進的場框。 */
  target: string | undefined
}

export interface NodeDrag {
  /** 套上拖動狀態之後的節點。 */
  nodes: CanvasNode[]
  guides: Guide[]
  /** 拖著鏡頭到了別的場框上方時，那個場框。 */
  dropTarget: CanvasNode | undefined
  /** 按著 Alt：不吸附格線、只拖單一節點。 */
  alt: boolean
  onNodeDragStart: OnNodeDrag<CanvasNode>
  onNodeDrag: OnNodeDrag<CanvasNode>
  onNodeDragStop: OnNodeDrag<CanvasNode>
  /**
   * 方向鍵微調選取的節點（鏡頭帶著它的圖與影片、場框帶著整場）。畫面馬上動，
   * 停下來一下才存；連按好幾下只存一次、只算一步復原。
   */
  nudge: (ids: readonly string[], dx: number, dy: number) => void
}

/** 連按方向鍵時，停下來多久才存。 */
const NUDGE_SAVE_MS = 350

export interface UseNodeDragOptions {
  rf: ReactFlowInstance<CanvasNode, CanvasEdge>
  /** 格線間距（沒按 Alt 時吸附到格線）。 */
  grid: number
  /** 資料載入進來的節點。 */
  base: CanvasNode[]
  /**
   * 放開之後把結果存起來並重新載入資料；回傳的 promise 完成前，畫面維持放開時的樣子。
   * `sceneTitle` 有值表示鏡頭換了場。
   */
  persist: (request: CanvasMove, sceneTitle: string | undefined) => Promise<void>
}

const sceneTitleOf = (frame: CanvasNode): string => frame.data.title.split(/\s*[・·]\s*/u)[0] ?? ''

/**
 * 拖曳：吸附格線與對齊輔助線、鏡頭整串一起動（Alt 單獨）、拖場框就是整個場一起動、
 * 把鏡頭拖進別的場框會亮起並提示。放開時只送出一次 `canvas.move`（一筆歷史）。
 */
export function useNodeDrag({ rf, grid, base, persist }: UseNodeDragOptions): NodeDrag {
  const [live, setLive] = useState<Live>()
  const [guides, setGuides] = useState<Guide[]>([])
  const [alt, setAlt] = useState(false)

  const nodes = useMemo(() => {
    if (!live) return base
    const withLive = base.map((node) => {
      const position = live.positions.get(node.id)
      const sceneKey = live.sceneOf.get(node.id)
      const raised = live.raised.has(node.id)
      let next = node
      if (position) next = { ...next, position }
      if (sceneKey !== undefined) next = { ...next, data: { ...next.data, sceneId: sceneKey } }
      if (raised) next = { ...next, zIndex: RAISED_Z }
      if (isFrame(node)) {
        const want =
          live.target === node.id
            ? t('canvas.releaseToMoveIntoScene', { value: String(node.data.sceneNo ?? '') })
            : undefined
        if (node.data.hint !== want) next = { ...next, data: { ...next.data, hint: want } }
      }
      return next
    })
    return refreshFrames(withLive, live.away)
  }, [base, live])
  const latest = useRef(nodes)
  latest.current = nodes
  // 拖之前的資料：拖動中這一串會先算成目標場的成員，放開時要跟原本的場比
  const baseRef = useRef(base)
  baseRef.current = base
  const liveRef = useRef(live)
  liveRef.current = live
  const dragging = useRef<
    | {
        start: ReadonlyMap<string, XY>
        last: ReadonlyMap<string, XY>
        /** 按下去的那一點（畫布座標）。 */
        from: XY
      }
    | undefined
  >(undefined)
  // 最後一次按下去的位置（螢幕座標）。React Flow 要游標移超過門檻（3px）才開始拖，
  // 而且從「開始拖的那一點」起算，格子會一直落後游標一段；所以自己從按下去的那一點起算。
  const downAt = useRef<XY | undefined>(undefined)

  // 空的場框沒有成員可以帶著走（位置是排版算的），不讓拖
  const withDraggable = useMemo(
    () =>
      nodes.map((node) =>
        isFrame(node) && membersOf(nodes, node.id).length === 0
          ? { ...node, draggable: false }
          : node,
      ),
    [nodes],
  )

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      downAt.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') setAlt(event.type === 'keydown')
    }
    const onBlur = (): void => {
      setAlt(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>(
    (event) => {
      dragging.current = {
        start: new Map(latest.current.map((n) => [n.id, n.position])),
        last: new Map(),
        // 不吸附：開了格線吸附時 screenToFlowPosition 預設會把座標也對到格線上，移 3px 可能算成 16
        from: rf.screenToFlowPosition(downAt.current ?? pointerOf(event), { snapToGrid: false }),
      }
    },
    [rf],
  )

  const onNodeDrag = useCallback<OnNodeDrag<CanvasNode>>(
    (event, node, moved) => {
      const drag = dragging.current
      const current = latest.current
      if (!drag) return
      const primary = current.find((n) => n.id === node.id)
      const start = drag.start.get(node.id)
      if (!primary || !start) return
      const group = new Set(moved.map((n) => n.id))
      group.add(node.id)
      const frame = isFrame(primary)
      const alone = event.altKey

      // 整串一起動：鏡頭帶著它的圖與影片、場框帶著裡面的鏡頭（單獨拖就只動自己）
      const mates = new Map<string, CanvasNode>()
      const bring = (list: readonly CanvasNode[]): void => {
        for (const mate of list) if (!group.has(mate.id)) mates.set(mate.id, mate)
      }
      for (const dragged of moved.length > 0 ? moved : [node]) {
        const source = current.find((n) => n.id === dragged.id)
        if (!source) continue
        if (isFrame(source)) bring(membersOf(current, source.id))
        else if (isGroup(source)) bring(insideGroup(current, source))
        else if (source.data.kind === 'shot' && !alone) bring(chainOf(current, source.data.shotId))
      }

      // 格子跟著游標：從按下去的那一點起算移了多少（沒按 Alt 時吸附格線）
      const pointer = rf.screenToFlowPosition(pointerOf(event), { snapToGrid: false })
      const raw = { x: start.x + pointer.x - drag.from.x, y: start.y + pointer.y - drag.from.y }
      const onGrid = (value: number): number => Math.round(value / grid) * grid
      let pos = raw

      // 吸附：對齊別的格子優先，沒有對齊的方向才吸附格線（先吸格線的話，縮小時一格很寬，
      // 會被推到對齊範圍外）。場框只吸格線；按著 Alt 都不吸
      if (!alone && !frame) {
        const skip = new Set([...group, ...mates.keys()])
        const others = current
          .filter((n) => !skip.has(n.id) && !isFrame(n) && !isGroup(n))
          .map(rectOf)
        const snapped = snapToNodes(
          { ...rectOf(primary), x: raw.x, y: raw.y },
          others,
          rf.getZoom(),
        )
        const guided = new Set(snapped.guides.map((g) => g.axis))
        pos = {
          x: guided.has('x') ? snapped.x : onGrid(raw.x),
          y: guided.has('y') ? snapped.y : onGrid(raw.y),
        }
        setGuides(snapped.guides)
      } else {
        if (!alone) pos = { x: onGrid(raw.x), y: onGrid(raw.y) }
        setGuides([])
      }
      const dx = pos.x - start.x
      const dy = pos.y - start.y
      const positions = new Map<string, XY>()
      for (const id of [...group, ...mates.keys()]) {
        const from = drag.start.get(id)
        if (from) positions.set(id, { x: from.x + dx, y: from.y + dy })
      }
      positions.set(node.id, pos)
      drag.last = positions

      // 游標進了別的場框：那個框亮起並提示；原本的框先不算被拖的這一串。
      // 「原本」要看拖之前的資料：拖動中這一串已經先算成目標場的成員了，用它比會把目標場排除掉
      const originalScene = baseRef.current.find((n) => n.id === node.id)?.data.sceneId
      const target =
        primary.data.kind === 'shot'
          ? sceneAt(current, rf.screenToFlowPosition(pointerOf(event)), originalScene)
          : undefined
      // 拖進別的場框：這一串先算成那一場的成員，目標框即時長大把它包住、原本的框縮回去
      setLive({
        positions,
        sceneOf: target
          ? new Map([...positions.keys()].map((id) => [id, target.id] as const))
          : new Map(),
        away: undefined,
        raised: new Set(positions.keys()),
        target: target?.id,
      })
    },
    [rf, grid],
  )

  const onNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(
    (_event, node) => {
      const drag = dragging.current
      dragging.current = undefined
      setGuides([])
      const settled = drag?.last
      const finish = (): void => {
        setLive(undefined)
      }
      if (!drag || !settled || settled.size === 0) {
        finish()
        return
      }
      const current = latest.current
      const primary = current.find((n) => n.id === node.id)
      if (!primary) {
        finish()
        return
      }
      // 拖動中暫時不算進框的成員要算回來：先用放開時的位置，再看有沒有換場
      const targetId = liveRef.current?.target
      const target = targetId === undefined ? undefined : current.find((n) => n.id === targetId)
      const positions = new Map(settled)
      const sceneOf = new Map<string, string>()
      let reparent: CanvasMove['reparent']
      const originalScene = baseRef.current.find((n) => n.id === node.id)?.data.sceneId
      if (primary.data.kind === 'shot' && target && target.id !== originalScene) {
        const chain = chainOf(current, primary.data.shotId)
        const chainIds = new Set(chain.map((n) => n.id))
        const slot = nextSlot(
          current.filter((n) => !chainIds.has(n.id)),
          target,
        )
        const placed = placeChain(
          current.map((n) =>
            chainIds.has(n.id) ? { ...n, position: drag.start.get(n.id) ?? n.position } : n,
          ),
          primary.data.shotId ?? '',
          slot,
        )
        for (const n of placed) if (chainIds.has(n.id)) positions.set(n.id, n.position)
        for (const id of chainIds) sceneOf.set(id, target.id)
        reparent = { shotKey: primary.id, sceneKey: target.id }
      }
      const moves = [...positions]
        .filter(([id]) => {
          const n = current.find((c) => c.id === id)
          return n !== undefined && !isFrame(n)
        })
        .filter(([id, p]) => {
          const was = drag.start.get(id)
          return reparent !== undefined || was?.x !== p.x || was.y !== p.y
        })
        .map(([key, p]) => ({ key, x: p.x, y: p.y }))
      // 單獨拖鏡頭（Alt）時，沒動的圖與影片要把位置存下來；不然它們沒有存過位置，重新載入後會跟著鏡頭走
      for (const move of [...moves]) {
        const shot = current.find((n) => n.id === move.key && n.data.kind === 'shot')
        if (!shot) continue
        for (const mate of chainOf(current, shot.data.shotId)) {
          if (positions.has(mate.id) || moves.some((m) => m.key === mate.id)) continue
          const at = drag.start.get(mate.id) ?? mate.position
          moves.push({ key: mate.id, x: at.x, y: at.y })
        }
      }
      if (moves.length === 0 && !reparent) {
        finish()
        return
      }
      // 畫面先停在放開的樣子，存好、重新載入之後才交還給資料
      setLive({
        positions,
        sceneOf,
        away: undefined,
        raised: new Set(),
        target: undefined,
      })
      void persist(
        { moves, ...(reparent ? { reparent } : {}) },
        target && reparent ? sceneTitleOf(target) : undefined,
      ).finally(finish)
    },
    [persist],
  )

  const nudgeTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(nudgeTimer.current)
    },
    [],
  )
  const nudge = useCallback(
    (ids: readonly string[], dx: number, dy: number): void => {
      if (dragging.current) return
      const current = latest.current
      const group = new Set<string>()
      for (const id of ids) {
        const node = current.find((n) => n.id === id)
        if (!node) continue
        if (isFrame(node)) for (const m of membersOf(current, node.id)) group.add(m.id)
        else if (isGroup(node)) for (const m of insideGroup(current, node)) group.add(m.id)
        else if (node.data.kind === 'shot')
          for (const m of chainOf(current, node.data.shotId)) group.add(m.id)
        group.add(node.id)
      }
      const positions = new Map(liveRef.current?.positions ?? [])
      for (const id of group) {
        const node = current.find((n) => n.id === id)
        if (!node || isFrame(node)) continue
        positions.set(id, { x: node.position.x + dx, y: node.position.y + dy })
      }
      if (positions.size === 0) return
      setLive({
        positions,
        sceneOf: new Map(),
        away: undefined,
        raised: new Set(),
        target: undefined,
      })
      window.clearTimeout(nudgeTimer.current)
      nudgeTimer.current = window.setTimeout(() => {
        nudgeTimer.current = undefined
        const moves = [...positions].map(([key, p]) => ({ key, x: p.x, y: p.y }))
        void persist({ moves }, undefined).finally(() => {
          // 存的這段時間又按了方向鍵：畫面維持新的位置，等下一次存完
          if (nudgeTimer.current === undefined) setLive(undefined)
        })
      }, NUDGE_SAVE_MS)
    },
    [persist],
  )

  const dropTarget = useMemo(
    () => nodes.find((n) => isFrame(n) && n.data.hint !== undefined),
    [nodes],
  )
  return {
    nodes: withDraggable,
    guides,
    dropTarget,
    alt,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    nudge,
  }
}
