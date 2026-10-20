import type { CanvasGroupColor, CanvasStep, OnelinerParams } from '@svs/schema'
import type { Edge, Node } from '@xyflow/react'

/** 畫布上的節點種類（手感雛形用；M6-7 起改成由 `canvas.get` 投影而來）。 */
export type NodeKind =
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
  | 'step'

export type RunStatus = 'idle' | 'queued' | 'running' | 'done' | 'stale' | 'failed'

export interface CutSlot {
  /** 輸入點的 id，例如 `cut-slot-1`。 */
  id: string
  label: string
  /** 這一場放進成品的鏡數，例如「2/3 鏡」；由場與影片節點的「放進成品」推出來。 */
  note?: string | undefined
  /** 有鏡頭還不會接進成品（沒放進成品，或還沒有影片）。 */
  partial?: boolean | undefined
  /** partial 的原因（滑過時的提示）。 */
  why?: string | undefined
}

export interface CanvasNodeData extends Record<string, unknown> {
  kind: NodeKind
  title: string
  /** 鏡頭、圖、影片所屬的場（`scene:<n>`）；沒分場的是 undefined。 */
  sceneId?: string | undefined
  /** 同一個鏡頭的那一串（鏡頭、圖、影片）共用的 id。 */
  shotId?: string | undefined
  summary?: string | undefined
  meta?: string | undefined
  /** 縮圖：用 CSS 漸層代替真實圖片。 */
  thumb?: string | undefined
  /** 影片節點：影片檔網址，卡片上用 `<video>` 顯示第一格當縮圖。 */
  videoSrc?: string | undefined
  status?: RunStatus | undefined
  footer?: string | undefined
  /** 鏡頭：目前連進來的角色名字（由連線推出來）。 */
  tags?: string[] | undefined
  /** 已鎖定的出場角色：名字 → 版本號。 */
  lockedTags?: Readonly<Record<string, number>> | undefined
  /** 影片：放不放進成品。 */
  inCut?: boolean | undefined
  /** 場框：拖鏡頭經過時亮起並提示。 */
  hint?: string | undefined
  sceneNo?: number | undefined
  slots?: CutSlot[] | undefined
  /** 自訂群組的顏色。 */
  color?: CanvasGroupColor | undefined
  /** 「執行到這裡」時標亮那條鏈。 */
  glow?: boolean | undefined
  /** 剛長出來：播一次長出動畫。 */
  born?: boolean | undefined
  /** 卡片底部一行：「3.2 秒・約 US$0.02・剛剛」。 */
  usageText?: string | undefined
  /** 失敗的圖與影片節點：白話原因。 */
  error?: string | undefined
  /** 一句話節點的設定。 */
  oneliner?: OnelinerParams | undefined
  /** 剪輯：接好的成品跟現在的影片對不上（要重新接）。 */
  finalStale?: boolean | undefined
  /** 展開步驟的那一格（整理 Prompt、挑參考圖、送出模型）。 */
  step?: CanvasStep | undefined
  /** 鏡頭：步驟展開著。 */
  expanded?: boolean | undefined
  /** 影片：同一鏡的第一張畫面已經好了（▶ 的說明不同：直接生成影片，或先補第一張畫面）。 */
  imageReady?: boolean | undefined
}

export type CanvasNode = Node<CanvasNodeData>

export type EdgeTone = 'main' | 'ref'
export interface CanvasEdgeData extends Record<string, unknown> {
  tone: EdgeTone
  /** 相連的節點被選取時變亮。 */
  hot?: boolean
  /** 上游正在執行，線上有資料流動的動畫。 */
  flowing?: boolean
  /** 剛長出來：線從起點畫到終點，播一次。 */
  born?: boolean
  /** 這條線是資料關係（角色、地點的參考線），可以用「×」剪掉。 */
  cuttable?: boolean
}
export type CanvasEdge = Edge<CanvasEdgeData>

export interface Graph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** 每種節點固定的尺寸：縮放層級改變時卡片不會變高，連接點的位置才穩定。 */
export const NODE_SIZE: Readonly<
  Record<Exclude<NodeKind, 'scene' | 'cut' | 'group' | 'step'>, { w: number; h: number }>
> = {
  oneliner: { w: 300, h: 440 },
  shot: { w: 230, h: 160 },
  image: { w: 230, h: 246 },
  video: { w: 230, h: 246 },
  character: { w: 220, h: 200 },
  location: { w: 220, h: 200 },
  freeImage: { w: 220, h: 190 },
  freeVideo: { w: 220, h: 190 },
  note: { w: 200, h: 120 },
}

/** 展開步驟的三格：和鏡頭一樣寬，高度依內容（要和主行程 projection 的 STEP_H 一致）。 */
export const STEP_SIZE = { w: 230, h: { prompt: 150, refs: 104, model: 92 } } as const

export const CUT_WIDTH = 260
/** 剪輯節點：標題列、每場一列（32px）、16:9 成品縮圖、一行說明。 */
export const CUT_HEAD = 36
export const CUT_SLOT_PITCH = 32
const CUT_SLOTS_TOP = CUT_HEAD + 8
export const cutSlotTop = (index: number): number => CUT_SLOTS_TOP + index * CUT_SLOT_PITCH + 14
/** 剪輯卡底部「重新接片」「匯出 MP4」那一排的高度。 */
export const CUT_ACTIONS_H = 34
export const cutHeight = (slots: number): number =>
  CUT_SLOTS_TOP + slots * CUT_SLOT_PITCH + 4 + 130 + 8 + 30 + CUT_ACTIONS_H

/** 節點分類色（uiux-spec §3）。 */
export const KIND_COLOR: Readonly<Record<NodeKind, string>> = {
  oneliner: '#38bdf8',
  scene: '#94a3b8',
  shot: '#10b981',
  image: '#8b5cf6',
  video: '#f43f5e',
  cut: '#14b8a6',
  character: '#94a3b8',
  location: '#94a3b8',
  freeImage: '#8b5cf6',
  freeVideo: '#f43f5e',
  note: '#eab308',
  group: '#64748b',
  step: '#10b981',
}

/** 自訂群組的 6 種顏色。 */
export const GROUP_COLOR: Readonly<Record<CanvasGroupColor, { hex: string; label: string }>> = {
  slate: { hex: '#64748b', label: '灰' },
  blue: { hex: '#3b82f6', label: '藍' },
  green: { hex: '#22c55e', label: '綠' },
  amber: { hex: '#f59e0b', label: '黃' },
  rose: { hex: '#f43f5e', label: '紅' },
  violet: { hex: '#8b5cf6', label: '紫' },
}

export const KIND_LABEL: Readonly<Record<NodeKind, string>> = {
  oneliner: '一句話',
  scene: '場',
  shot: '鏡頭',
  image: '第一張畫面',
  video: '影片',
  cut: '剪輯',
  character: '角色',
  location: '地點',
  freeImage: '圖片',
  freeVideo: '影片',
  note: '便條',
  group: '群組',
  step: '步驟',
}

/** 連接點傳的東西是什麼（決定圓點與「吃／出」小標的顏色）。 */
export type PortType = 'story' | 'shot' | 'image' | 'video' | 'ref' | 'cut'

export const PORT_TYPE_COLOR: Readonly<Record<PortType, string>> = {
  story: '#38bdf8',
  shot: '#10b981',
  image: '#8b5cf6',
  video: '#f43f5e',
  ref: '#9ca3af',
  cut: '#14b8a6',
}

export interface PortDef {
  id: string
  side: 'in' | 'out'
  /** 主線用類型色；參考一律灰色。 */
  tone: EdgeTone
  /** 傳的是什麼：圓點與「吃／出」小標用這個顏色。 */
  type: PortType
  /** 「吃／出」那一行放不下完整名字時用的短名字。 */
  short?: string
  /** 滑過時顯示的小字。 */
  label: string
  top: number
}

/** 場框內的鏡頭欄位（鏡頭、圖、影片）。 */
export const SCENE_PAD = { x: 24, top: 44, bottom: 24 } as const
export const ROW_PITCH = 256
export const COL_X = { shot: 0, image: 285, video: 570 } as const

const PORTS: Readonly<Record<Exclude<NodeKind, 'cut'>, readonly PortDef[]>> = {
  oneliner: [{ id: 'story-out', side: 'out', tone: 'main', type: 'story', label: '故事', top: 96 }],
  scene: [
    { id: 'scene-story', side: 'in', tone: 'main', type: 'story', label: '故事', top: 28 },
    { id: 'scene-loc', side: 'in', tone: 'ref', type: 'ref', label: '地點', top: 56 },
    { id: 'scene-out', side: 'out', tone: 'main', type: 'video', label: '這場的片段', top: 28 },
  ],
  shot: [
    { id: 'shot-ref-char', side: 'in', tone: 'ref', type: 'ref', label: '角色', top: 100 },
    { id: 'shot-ref-loc', side: 'in', tone: 'ref', type: 'ref', label: '地點', top: 124 },
    { id: 'shot-out', side: 'out', tone: 'main', type: 'shot', label: '畫面描述', top: 70 },
  ],
  image: [
    { id: 'img-in', side: 'in', tone: 'main', type: 'shot', label: '鏡頭', top: 70 },
    {
      id: 'img-first',
      side: 'in',
      tone: 'main',
      type: 'image',
      label: '第一張畫面',
      short: '現成圖',
      top: 100,
    },
    { id: 'img-ref', side: 'in', tone: 'ref', type: 'ref', label: '參考', top: 130 },
    {
      id: 'img-out',
      side: 'out',
      tone: 'main',
      type: 'image',
      label: '第一張畫面',
      short: '圖',
      top: 70,
    },
  ],
  video: [{ id: 'vid-in', side: 'in', tone: 'main', type: 'image', label: '第一張畫面', top: 70 }],
  character: [
    { id: 'char-ref', side: 'in', tone: 'ref', type: 'ref', label: '參考圖', top: 70 },
    { id: 'char-out', side: 'out', tone: 'ref', type: 'ref', label: '角色', top: 70 },
  ],
  location: [
    { id: 'loc-ref', side: 'in', tone: 'ref', type: 'ref', label: '參考圖', top: 70 },
    { id: 'loc-out', side: 'out', tone: 'ref', type: 'ref', label: '地點', top: 70 },
  ],
  freeImage: [
    { id: 'free-img-out', side: 'out', tone: 'main', type: 'image', label: '圖', top: 70 },
  ],
  freeVideo: [
    { id: 'free-vid-out', side: 'out', tone: 'main', type: 'video', label: '影片', top: 70 },
  ],
  note: [],
  group: [],
  // 步驟的連接點畫在格子上下（StepNode 自己畫），不是左右兩排
  step: [],
}

export function portsOf(data: CanvasNodeData): readonly PortDef[] {
  if (data.kind !== 'cut') return PORTS[data.kind]
  const slots = data.slots ?? []
  return [
    ...slots.map((slot, index): PortDef => ({
      id: slot.id,
      side: 'in',
      tone: 'main',
      type: 'video',
      label: slot.label,
      top: cutSlotTop(index),
    })),
    { id: 'cut-out', side: 'out', tone: 'main', type: 'cut', label: '成品', top: cutSlotTop(0) },
  ]
}

export function portOf(node: CanvasNode | undefined, portId: string | null | undefined) {
  if (!node || !portId) return undefined
  return portsOf(node.data).find((port) => port.id === portId)
}

export function sizeOf(node: CanvasNode): { w: number; h: number } {
  const { kind } = node.data
  if (kind === 'cut') return { w: CUT_WIDTH, h: cutHeight(node.data.slots?.length ?? 0) }
  if (kind === 'scene' || kind === 'group' || kind === 'step') {
    return { w: node.width ?? 0, h: node.height ?? 0 }
  }
  return NODE_SIZE[kind]
}

/** 全部顯示時四邊留的空（px）：左邊讓出節點面板、上面讓出上方列。 */
export const FIT_PADDING = { top: 80, left: 270, right: 40, bottom: 48 } as const

const px = (n: number): `${number}px` => `${String(n)}px` as `${number}px`

/** 全部顯示：左邊讓出節點面板、上面讓出上方列。 */
export const FIT_OPTIONS = {
  /** 只有一兩個節點時不要放大到看不出全貌。 */
  maxZoom: 1,
  padding: {
    top: px(FIT_PADDING.top),
    left: px(FIT_PADDING.left),
    right: px(FIT_PADDING.right),
    bottom: px(FIT_PADDING.bottom),
  },
} as const
