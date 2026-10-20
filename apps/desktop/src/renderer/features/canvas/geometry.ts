import { COL_X, ROW_PITCH, SCENE_PAD, sizeOf, type CanvasNode, type Graph } from './canvas-model'

/** 場框裡的成員：同一場的鏡頭、圖、影片。 */
export const isMember = (node: CanvasNode): boolean =>
  node.data.kind === 'shot' || node.data.kind === 'image' || node.data.kind === 'video'

export const isFrame = (node: CanvasNode): boolean => node.data.kind === 'scene'

/** 自訂群組（自由節點）：框住的格子一起動，但不影響資料。 */
export const isGroup = (node: CanvasNode): boolean => node.data.kind === 'group'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function rectOf(node: CanvasNode): Rect {
  const { w, h } = sizeOf(node)
  return { x: node.position.x, y: node.position.y, w, h }
}

/** 成員的外框加上內距，場框就是這個大小。 */
export function boundsOf(members: readonly CanvasNode[]): Rect | undefined {
  if (members.length === 0) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const member of members) {
    const r = rectOf(member)
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return {
    x: minX - SCENE_PAD.x,
    y: minY - SCENE_PAD.top,
    w: maxX - minX + SCENE_PAD.x * 2,
    h: maxY - minY + SCENE_PAD.top + SCENE_PAD.bottom,
  }
}

/**
 * 場框隨內容自動伸縮：沒有成員的場框維持原樣。
 * `skip` 是暫時不算進框的成員（拖到別的場框上方時，原本的框不再撐著被拖的那一串）。
 */
export function refreshFrames(nodes: CanvasNode[], skip?: ReadonlySet<string>): CanvasNode[] {
  const bySceneMembers = new Map<string, CanvasNode[]>()
  for (const node of nodes) {
    if (!isMember(node) || node.data.sceneId === undefined) continue
    if (skip?.has(node.id) === true) continue
    const list = bySceneMembers.get(node.data.sceneId)
    if (list) list.push(node)
    else bySceneMembers.set(node.data.sceneId, [node])
  }
  const next = nodes.map((node) => {
    if (!isFrame(node)) return node
    const box = boundsOf(bySceneMembers.get(node.id) ?? [])
    if (!box) return node
    if (
      node.position.x === box.x &&
      node.position.y === box.y &&
      node.width === box.w &&
      node.height === box.h
    ) {
      return node
    }
    return {
      ...node,
      position: { x: box.x, y: box.y },
      width: box.w,
      height: box.h,
      // 尺寸是自己算的，量好的尺寸也跟著改（React Flow 用它算連接點與可見範圍）
      measured: { width: box.w, height: box.h },
    }
  })
  return next.some((n, i) => n !== nodes[i]) ? next : nodes
}

/** 鏡頭的那一串：同一個 shotId 的鏡頭、圖、影片。 */
export function chainOf(nodes: readonly CanvasNode[], shotId: string | undefined): CanvasNode[] {
  if (shotId === undefined) return []
  return nodes.filter((n) => isMember(n) && n.data.shotId === shotId)
}

/** 一個場框的所有成員。 */
export function membersOf(nodes: readonly CanvasNode[], sceneId: string): CanvasNode[] {
  return nodes.filter((n) => isMember(n) && n.data.sceneId === sceneId)
}

export interface Guide {
  axis: 'x' | 'y'
  /** 輔助線的位置（x 軸向就是一條垂直線的 x）。 */
  at: number
  from: number
  to: number
}

export const GUIDE_SNAP_PX = 5

/**
 * 對齊輔助線：拖動中的節點，邊緣或中線離其他節點 5px 內就吸附上去，
 * 並回傳要畫的輔助線。`zoom` 是目前的縮放，讓「5px」是畫面上的 5px。
 */
export function snapToNodes(
  moving: Rect,
  others: readonly Rect[],
  zoom: number,
): { x: number; y: number; guides: Guide[] } {
  const limit = GUIDE_SNAP_PX / zoom
  const edgesX = (r: Rect): number[] => [r.x, r.x + r.w / 2, r.x + r.w]
  const edgesY = (r: Rect): number[] => [r.y, r.y + r.h / 2, r.y + r.h]
  let bestX: { delta: number; at: number; other: Rect } | undefined
  let bestY: { delta: number; at: number; other: Rect } | undefined
  for (const other of others) {
    for (const mine of edgesX(moving)) {
      for (const theirs of edgesX(other)) {
        const delta = theirs - mine
        if (Math.abs(delta) <= limit && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, at: theirs, other }
        }
      }
    }
    for (const mine of edgesY(moving)) {
      for (const theirs of edgesY(other)) {
        const delta = theirs - mine
        if (Math.abs(delta) <= limit && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, at: theirs, other }
        }
      }
    }
  }
  const x = moving.x + (bestX?.delta ?? 0)
  const y = moving.y + (bestY?.delta ?? 0)
  const guides: Guide[] = []
  if (bestX) {
    guides.push({
      axis: 'x',
      at: bestX.at,
      from: Math.min(y, bestX.other.y) - 12,
      to: Math.max(y + moving.h, bestX.other.y + bestX.other.h) + 12,
    })
  }
  if (bestY) {
    guides.push({
      axis: 'y',
      at: bestY.at,
      from: Math.min(x, bestY.other.x) - 12,
      to: Math.max(x + moving.w, bestY.other.x + bestY.other.w) + 12,
    })
  }
  return { x, y, guides }
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * 新節點想放在 `want`（左上角），那裡被別的節點或場框佔住就找最近的空位：
 * 一圈一圈往外找，每圈挑離想放的位置最近的格子。節點之間留一點空隙。
 */
export function freeSpot(
  nodes: readonly CanvasNode[],
  size: { w: number; h: number },
  want: { x: number; y: number },
  step = 40,
  gap = 16,
  /** 只找這一塊裡面的空位（畫面上看得到、沒被上方列等蓋住的那塊）；裡面放不下才不限制。 */
  within?: Rect,
): { x: number; y: number } {
  // 群組只是一個框，新的格子可以放進去
  const blockers = nodes
    .filter((n) => !isGroup(n))
    .map(rectOf)
    .filter((r) => r.w > 0 && r.h > 0)
  const free = (at: { x: number; y: number }): boolean => {
    const box = { x: at.x - gap, y: at.y - gap, w: size.w + gap * 2, h: size.h + gap * 2 }
    return !blockers.some((r) => overlaps(box, r))
  }
  const inside = (at: { x: number; y: number }): boolean =>
    within === undefined ||
    (at.x >= within.x &&
      at.y >= within.y &&
      at.x + size.w <= within.x + within.w &&
      at.y + size.h <= within.y + within.h)
  const usable = (at: { x: number; y: number }): boolean => inside(at) && free(at)
  if (usable(want)) return want
  for (let ring = 1; ring <= 60; ring++) {
    const candidates: { x: number; y: number }[] = []
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        candidates.push({ x: want.x + dx * step, y: want.y + dy * step })
      }
    }
    candidates.sort(
      (a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y),
    )
    const found = candidates.find(usable)
    if (found) return found
  }
  // 看得到的範圍裡放不下（畫面太小、拉得太近）：退回不限範圍，由呼叫的人再平移到看得見
  return within === undefined ? want : freeSpot(nodes, size, want, step, gap)
}

export const contains = (rect: Rect, point: { x: number; y: number }): boolean =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h

/** 游標（鏡頭中心）在哪個場框裡；`except` 是自己原本的場。 */
export function sceneAt(
  nodes: readonly CanvasNode[],
  point: { x: number; y: number },
  except?: string,
): CanvasNode | undefined {
  return nodes.find(
    (n) => isFrame(n) && n.id !== except && n.width !== undefined && contains(rectOf(n), point),
  )
}

/** 場在大綱中的順序（按場框原本的順序）。 */
export const sceneOrder = (nodes: readonly CanvasNode[]): CanvasNode[] =>
  nodes.filter(isFrame).sort((a, b) => (a.data.sceneNo ?? 0) - (b.data.sceneNo ?? 0))

/** 新鏡頭在這個場裡的下一個空位：最後一列的下面；場是空的就放場框左上。 */
export function nextSlot(
  nodes: readonly CanvasNode[],
  scene: CanvasNode,
): { x: number; y: number } {
  const members = membersOf(nodes, scene.id)
  const shots = members.filter((m) => m.data.kind === 'shot')
  if (shots.length === 0) {
    return { x: scene.position.x + SCENE_PAD.x, y: scene.position.y + SCENE_PAD.top }
  }
  const lowest = shots.reduce((a, b) => (a.position.y >= b.position.y ? a : b))
  return { x: lowest.position.x, y: lowest.position.y + ROW_PITCH }
}

/** 把一串鏡頭、圖、影片整串移到某個位置（鏡頭的左上角），保持彼此的相對位置。 */
export function placeChain(nodes: CanvasNode[], shotId: string, to: { x: number; y: number }) {
  const chain = chainOf(nodes, shotId)
  const shot = chain.find((n) => n.data.kind === 'shot')
  if (!shot) return nodes
  const dx = to.x - shot.position.x
  const dy = to.y - shot.position.y
  const ids = new Set(chain.map((n) => n.id))
  return nodes.map((n) =>
    ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
  )
}

/** 鏡頭上的角色名字：由連到「出場角色」輸入點的線推出來（連線就是資料）。 */
export function syncTags(graph: Graph): Graph {
  const names = new Map<string, string[]>()
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const edge of graph.edges) {
    if (edge.targetHandle !== 'shot-ref-char') continue
    const from = byId.get(edge.source)
    if (!from) continue
    names.set(edge.target, [...(names.get(edge.target) ?? []), from.data.title])
  }
  const nodes = graph.nodes.map((node) => {
    if (node.data.kind !== 'shot') return node
    const want = names.get(node.id) ?? []
    const have = node.data.tags ?? []
    if (want.length === have.length && want.every((n, i) => n === have[i])) return node
    return { ...node, data: { ...node.data, tags: want } }
  })
  return nodes.some((n, i) => n !== graph.nodes[i]) ? { ...graph, nodes } : graph
}

/** 各邊要留的空間（畫面像素）：讓出上方列、左側節點面板等蓋在畫布上的東西。 */
export interface RevealMargin {
  top: number
  left: number
  right: number
  bottom: number
}

/** 畫面上看得到、沒被上方列與浮在畫布上的面板蓋住的那一塊，換成畫布座標；塊太小就回 undefined。 */
export function visibleRect(
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  margin: RevealMargin,
): Rect | undefined {
  const w = size.width - margin.left - margin.right
  const h = size.height - margin.top - margin.bottom
  if (w <= 0 || h <= 0) return undefined
  return {
    x: (margin.left - viewport.x) / viewport.zoom,
    y: (margin.top - viewport.y) / viewport.zoom,
    w: w / viewport.zoom,
    h: h / viewport.zoom,
  }
}

/** 讓一個節點在目前的視角裡看得見所需的最小平移；已經看得見就回 undefined。 */
export function panToReveal(
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  rect: Rect,
  margin: number | RevealMargin = 48,
): { x: number; y: number } | undefined {
  const m =
    typeof margin === 'number'
      ? { top: margin, left: margin, right: margin, bottom: margin }
      : margin
  const left = rect.x * viewport.zoom + viewport.x
  const top = rect.y * viewport.zoom + viewport.y
  const right = left + rect.w * viewport.zoom
  const bottom = top + rect.h * viewport.zoom
  let dx = 0
  let dy = 0
  if (left < m.left) dx = m.left - left
  else if (right > size.width - m.right) dx = size.width - m.right - right
  if (top < m.top) dy = m.top - top
  else if (bottom > size.height - m.bottom) dy = size.height - m.bottom - bottom
  if (dx === 0 && dy === 0) return undefined
  return { x: viewport.x + dx, y: viewport.y + dy }
}

export { COL_X, ROW_PITCH }

/**
 * 剪輯節點每個槽右側的「進成品鏡數」：由連進來的場，與場裡影片節點的「放進成品」推出來，
 * 讓使用者看得出哪些鏡頭被排除。
 */
export function syncCut(graph: Graph): Graph {
  const cut = graph.nodes.find((n) => n.data.kind === 'cut')
  const slots = cut?.data.slots
  if (!cut || !slots) return graph
  const sceneOfSlot = new Map<string, string>()
  for (const edge of graph.edges) {
    if (edge.target === cut.id && edge.targetHandle) sceneOfSlot.set(edge.targetHandle, edge.source)
  }
  const total = new Map<string, number>()
  const used = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.data.kind !== 'video' || node.data.sceneId === undefined) continue
    total.set(node.data.sceneId, (total.get(node.data.sceneId) ?? 0) + 1)
    if (node.data.inCut !== false)
      used.set(node.data.sceneId, (used.get(node.data.sceneId) ?? 0) + 1)
  }
  const next = slots.map((slot) => {
    const sceneId = sceneOfSlot.get(slot.id)
    const all = sceneId === undefined ? 0 : (total.get(sceneId) ?? 0)
    const inCut = sceneId === undefined ? 0 : (used.get(sceneId) ?? 0)
    const note = `${String(inCut)}/${String(all)} 鏡`
    const partial = inCut < all
    return slot.note === note && slot.partial === partial ? slot : { ...slot, note, partial }
  })
  if (next.every((slot, i) => slot === slots[i])) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n === cut ? { ...n, data: { ...n.data, slots: next } } : n)),
  }
}

const SHOT_TITLE = /^第 \d+ 鏡$/

/**
 * 鏡頭的「第 N 鏡」依序重編：先照場的順序，同一場裡由上到下。
 * 只改還叫預設名字的鏡頭，使用者自己改過的名字不動。
 */
export function renumberShots(nodes: CanvasNode[]): CanvasNode[] {
  const sceneNo = new Map(nodes.filter(isFrame).map((n) => [n.id, n.data.sceneNo ?? 0]))
  const shots = nodes
    .filter((n) => n.data.kind === 'shot')
    .sort((a, b) => {
      const sa = sceneNo.get(a.data.sceneId ?? '') ?? Number.MAX_SAFE_INTEGER
      const sb = sceneNo.get(b.data.sceneId ?? '') ?? Number.MAX_SAFE_INTEGER
      return sa - sb || a.position.y - b.position.y || a.position.x - b.position.x
    })
  const titles = new Map(shots.map((n, i) => [n.id, `第 ${String(i + 1)} 鏡`]))
  const next = nodes.map((n) => {
    const title = titles.get(n.id)
    if (title === undefined || n.data.title === title || !SHOT_TITLE.test(n.data.title)) return n
    return { ...n, data: { ...n.data, title } }
  })
  return next.some((n, i) => n !== nodes[i]) ? next : nodes
}

/** 群組框住的格子：整個落在群組裡的（場框是算出來的不算，別的群組也不算）。 */
export function insideGroup(nodes: readonly CanvasNode[], group: CanvasNode): CanvasNode[] {
  const box = rectOf(group)
  return nodes.filter((n) => {
    if (n.id === group.id || isFrame(n) || isGroup(n)) return false
    const r = rectOf(n)
    return r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h
  })
}
