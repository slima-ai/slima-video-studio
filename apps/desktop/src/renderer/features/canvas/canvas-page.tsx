import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  useStoreApi,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  CANVAS_IMPORT_EXT,
  CANVAS_IMPORT_MAX_BYTES,
  CanvasAddKindSchema,
  type CanvasAddKind,
  type CanvasGraph,
  type CanvasImportResult,
  type CanvasMove,
  type CanvasViewport,
} from '@svs/schema'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

import { Button } from '../../components/button'
import { Spinner } from '../../components/skeleton'
import { LONG_TOAST_MS, useToast } from '../../components/toast'
import { useHistory } from '../../lib/history'
import { useShots } from '../shots/use-shots'
import { creditsPreferred } from '../../lib/export-credits'
import { revealLabel } from '../../lib/reveal-label'
import { call, errorText } from '../../lib/svs'
import { useResolvedTheme } from '../../lib/theme'
import {
  CanvasActionsContext,
  ConnectedPortsContext,
  LinkingContext,
  LodContext,
  type Lod,
  type CanvasActions,
  type PortRef,
  type RunEstimate,
  type RunScope,
} from './canvas-actions'
import { FIT_OPTIONS, NODE_SIZE, type CanvasEdge, type CanvasNode } from './canvas-model'
import './canvas.css'
import { DRAG_MIME, NodePalette, TopBar, ZoomControls } from './chrome'
import { choicesFor, type AddChoice } from './connection-rules'
import { nodeEntries, paneEntries, type ContextEntry } from './context-menu'
import { DELETE_TOAST_MS, FIXED_EDGE_REASON, planDelete, type DeletePlan } from './delete-plan'
import { DetailPanel, keyOfTarget, panelTargetOf, type PanelTarget } from './detail-panel'
import { READABLE_ZOOM, openViewport, useFitAll } from './fit-all'
import { FLOAT_PANEL } from './floating-panel'
import { DragOverlay } from './drag-overlay'
import { ConnectionLine, EDGE_TYPES } from './edges'
import { toFlowGraph } from './from-ipc'
import {
  boundsOf,
  chainOf,
  freeSpot,
  isFrame,
  isGroup,
  membersOf,
  panToReveal,
  rectOf,
  sceneAt,
  visibleRect,
  type Rect,
} from './geometry'
import { StartCards } from './canvas-start'
import { GrowConfirm } from './grow-confirm'
import { LooseBanner } from './loose-banner'
import { SplitConfirm, useStorySplit } from './story-split'
import { AddMenu, CONTEXT_W, ContextMenu, type MenuEntry } from './menus'
import { PerfOverlay } from './perf-overlay'
import { NODE_TYPES } from './nodes'
import { RenameBox, isRenamable, type RenameTarget } from './rename-box'
import { RunModeMenu } from './run-mode-menu'
import { SceneLabels } from './scene-labels'
import { GettingStartedDialog } from '../help/getting-started-dialog'
import { ShortcutsDialog } from './shortcuts-dialog'
import { anchorOf, type ConfirmAnchor } from './run-confirm'
import { HoverTip } from './hover-tip'
import { useAiMarks } from './use-ai-marks'
import { RunPlanConfirm } from './run-confirm-plan'
import { useCanvas } from './use-canvas'
import { ANY_ONELINER, useGrow } from './use-grow'
import { useLinking } from './use-linking'
import { useNodeDrag } from './use-node-drag'
import { isRunnable, usePendingCost, useRun } from './use-run'

const GRID = 16
/** 節點超過這個數量就顯示小地圖。 */
const MINIMAP_AFTER = 40
/** 節點多到連線畫不動時，參考線只在相連的節點被選取或滑過時才畫。 */
const MANY_NODES = 400
const VIEWPORT_SAVE_DELAY_MS = 500
/** 效能自測的自動平移：視角繞一圈的半徑（螢幕像素）。 */
const PERF_PAN_RADIUS = 600
/** 畫布上現在能新增的種類（獨立圖片、影片、便條等自由節點到 M6-9 才開放）。 */
const ADDABLE: readonly CanvasAddKind[] = CanvasAddKindSchema.options
/** 左側面板與新增選單列的種類：能新增的，再加「圖片或影片」（上傳）。 */
const MENU_KINDS = [...ADDABLE, 'freeImage'] as const

/** 貼上時由自動排版決定位置的種類（不照位移放）。 */
const AUTO_PLACED = new Set(['shot', 'scene'])
/** 再做一份時可以疊在原件上（錯開一點）的種類；鏡頭的圖、影片的副本要找空位，別蓋住原本的。 */
const SELF_OVERLAP = new Set([
  'note',
  'group',
  'freeImage',
  'freeVideo',
  'oneliner',
  'character',
  'location',
])
const addKindOf = (kind: string): CanvasAddKind | undefined =>
  ADDABLE.find((candidate) => candidate === kind)
/** 新節點「長出來」的動畫時間。 */
const BORN_MS = 700
/** 上方列的高度：新節點要避開它。 */
const TOPBAR_H = 56
/** 新節點要避開上方列與左側節點面板（面板約 236px 寬）。 */
const REVEAL_MARGIN = { top: TOPBAR_H + 24, left: 260, right: 48, bottom: 48 } as const
/** 新節點放的位置要在這之內：再讓出右下角的縮放列（高約 48）。 */
const PLACE_MARGIN = { ...REVEAL_MARGIN, bottom: 72 } as const

/** 沒指定位置時，一句話放在角色與地點那一欄的左邊、第一個場的高度（自動排版的內容從它右邊長出來）。 */
const ONELINER_HOME = { x: -150, y: 110 } as const

interface XY {
  x: number
  y: number
}
const snap = (value: number): number => Math.round(value / GRID) * GRID

/** 這個連接點旁邊可以新增哪幾種節點（只算現在開放的；圖片是選檔上傳）。 */
const addableAt = (portId: string, side: 'in' | 'out'): AddChoice[] =>
  choicesFor(portId, side).filter(
    (choice) => choice.kind === 'freeImage' || addKindOf(choice.kind) !== undefined,
  )

declare global {
  interface Window {
    /** E2E 與量測流暢度的腳本用，讀目前的節點。 */
    __svsCanvas?: ReturnType<typeof useReactFlow<CanvasNode, CanvasEdge>>
  }
}

interface CanvasProps {
  graph: CanvasGraph
  /** 新增之後馬上重新讀資料（不等事件）。 */
  onChanged: () => void
  /** 馬上重新讀資料，讀完才完成。 */
  onRefresh: () => Promise<void>
  /** 展開步驟的鏡頭 id（只記在畫面上）。 */
  expanded: ReadonlySet<string>
  onExpanded: (next: ReadonlySet<string>) => void
}

function Canvas({ graph, onChanged, onRefresh, expanded, onExpanded }: CanvasProps) {
  const rf = useReactFlow<CanvasNode, CanvasEdge>()
  const fitAll = useFitAll()
  useEffect(() => {
    window.__svsCanvas = rf
  }, [rf])
  const toast = useToast()
  const theme = useResolvedTheme()
  const history = useHistory()
  const containerRef = useRef<HTMLDivElement>(null)

  // 一開始的視角只決定一次：上次的視角（縮到看不清楚的不算，卡片只剩色塊）；
  // 沒存過且已經有節點，就等畫布準備好（onInit）再決定：放得進畫面就全部顯示，
  // 放不下就定位到第一個入口（一句話卡或第一場），不要縮到全部塞進去；
  // 空畫布維持原點（之後 fitView 屬性變了會讓 React Flow 重新縮放，所以不能跟著資料換）
  const [initialView] = useState(() => {
    const saved =
      graph.viewport && graph.viewport.zoom >= READABLE_ZOOM ? graph.viewport : undefined
    return {
      defaultViewport: saved ?? { x: 0, y: 0, zoom: 1 },
      decide: saved === undefined && graph.nodes.length > 0,
    }
  })
  const { decide: decideOnInit, ...initialProps } = initialView
  const store = useStoreApi<CanvasNode, CanvasEdge>()
  const onInit = useCallback((): void => {
    if (!decideOnInit) return
    const { width, height } = store.getState()
    const view = openViewport(rf.getNodes(), { width, height })
    if (view === 'fit') void rf.fitView(FIT_OPTIONS)
    else if (view) void rf.setViewport(view)
  }, [decideOnInit, rf, store])
  const flow = useMemo(() => toFlowGraph(graph), [graph])
  // 拖移：存好位置（鏡頭換場時一併改所屬的場）再重新讀資料；這段時間畫面維持放開時的樣子
  const persistMove = useCallback(
    async (request: CanvasMove, sceneTitle: string | undefined): Promise<void> => {
      try {
        await call('canvas.move', request)
        await onRefresh()
        if (sceneTitle !== undefined) {
          toast.show({
            key: 'canvas-move',
            message: `已移到${sceneTitle}`,
            action: { label: '復原', onAction: history.undo },
          })
        }
      } catch (error) {
        toast.show({ message: errorText(error), tone: 'danger' })
      }
    },
    [history.undo, onRefresh, toast],
  )
  const drag = useNodeDrag({ rf, grid: GRID, base: flow.nodes, persist: persistMove })
  // 選取只存在畫面：資料重新載入時，還在的節點維持選取
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // AI 工具（MCP）剛改過的節點：亮一下、標「AI 剛改」；刪掉的用提示說清楚、可以復原
  const aiMarks = useAiMarks((message) => {
    toast.show({
      key: 'ai-removed',
      message,
      action: { label: '復原', onAction: history.undo },
      ms: 10_000,
    })
  })
  const { seen: aiSeen, prune: aiPrune, rekindle: aiRekindle, fresh: aiFresh } = aiMarks
  // 使用者選取了、或滑過一下，就算看過
  useEffect(() => {
    aiSeen(selected)
  }, [selected, aiSeen])
  // 還標著「AI 剛改」的節點之後內容又變了（例如 AI 叫的生成做完）：再亮一次
  const aiPrints = useRef(new Map<string, string>())
  useEffect(() => {
    aiPrune(new Set(graph.nodes.map((n) => n.key)))
  }, [graph.nodes, aiPrune])
  useEffect(() => {
    const changed: string[] = []
    for (const node of graph.nodes) {
      if (!aiFresh.has(node.key)) continue
      const print = JSON.stringify([
        node.title,
        node.summary,
        node.status,
        node.assetHash,
        node.version,
        node.error,
      ])
      const old = aiPrints.current.get(node.key)
      aiPrints.current.set(node.key, print)
      if (old !== undefined && old !== print) changed.push(node.key)
    }
    if (changed.length > 0) aiRekindle(changed)
  }, [graph.nodes, aiRekindle, aiFresh])
  // 剛新增的節點：選取它、播一次長出動畫、必要時平移到看得見的地方
  const [born, setBorn] = useState<string | undefined>()
  // 一句話生成中陸續長出來的節點（節點與連到它們的線各播一次長出動畫）
  const [grown, setGrown] = useState<ReadonlySet<string>>(new Set())
  const grownScene = useRef<string | undefined>(undefined)
  const latestFlow = useRef(flow)
  latestFlow.current = flow
  // 剛放下、資料還沒重新讀回來的格子：連按好幾次「新增」時，後面的要避開前面的（畫面上的節點還沒更新）
  const justPlaced = useRef<{ rect: { x: number; y: number; w: number; h: number }; at: number }[]>(
    [],
  )
  /** 現在畫布上被佔住的格子，加上剛放下、還沒出現在畫面上的。 */
  const obstaclesNow = useCallback((): CanvasNode[] => {
    const now = Date.now()
    justPlaced.current = justPlaced.current.filter((p) => now - p.at < 4000)
    const pending = justPlaced.current.map((p, index): CanvasNode => ({
      id: `placed:${String(index)}`,
      type: 'frame',
      position: { x: p.rect.x, y: p.rect.y },
      width: p.rect.w,
      height: p.rect.h,
      data: { kind: 'scene', title: '' },
    }))
    return [...latestFlow.current.nodes, ...pending]
  }, [])
  const rememberPlaced = useCallback((at: XY, size: { w: number; h: number }): void => {
    justPlaced.current.push({ rect: { x: at.x, y: at.y, ...size }, at: Date.now() })
  }, [])
  /** 把節點平移到看得見（避開上方列與左側面板）；平移動畫結束時完成，回傳畫面移了多少。 */
  const revealNode = useCallback(
    async (node: CanvasNode): Promise<{ dx: number; dy: number } | undefined> => {
      const el = containerRef.current
      if (!el) return undefined
      const viewport = rf.getViewport()
      const pan = panToReveal(
        viewport,
        { width: el.clientWidth, height: el.clientHeight },
        rectOf(node),
        REVEAL_MARGIN,
      )
      if (!pan) return undefined
      await rf.setViewport({ ...viewport, ...pan }, { duration: 300 })
      return { dx: pan.x - viewport.x, dy: pan.y - viewport.y }
    },
    [rf],
  )
  // 這次生成是從哪個一句話按的（長完時連它一起放進畫面）
  const growSource = useRef<string | undefined>(undefined)
  // 就地改名的函式在後面才定義：畫布動作（卡片上的雙擊）用 ref 呼叫它
  const startRenameRef = useRef<(nodeId: string) => void>(undefined)
  const grow = useGrow({
    onFinished: async () => {
      // 長完了：讀最後的資料，再一次把「一句話＋新的那一場」放進畫面。
      // 長的過程中畫面不動（不然節點一個個冒出來時畫面一直跳），只在這裡動一次
      const key = grownScene.current
      const source = growSource.current
      grownScene.current = undefined
      growSource.current = undefined
      await onRefresh()
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      const ids = [key, source].filter(
        (id): id is string => id !== undefined && latestFlow.current.nodes.some((n) => n.id === id),
      )
      // 等這次動畫做完才算長完（data-growing 這時才變 false、才跳「短片生成好了」）
      if (key !== undefined && ids.includes(key)) {
        await rf.fitView({ ...FIT_OPTIONS, nodes: ids.map((id) => ({ id })), duration: 400 })
      }
    },
  })
  const { start: startGrow, stop: stopGrow } = grow
  const runner = useRun({
    nodes: flow.nodes,
    // 從上方列執行時，要做的第一格可能不在畫面裡：先只平移（不縮放）把它帶進來，面板再出現
    beforeConfirm: async (plan) => {
      const first = plan.steps.find((step) => step.kind !== 'cut')?.key ?? 'cut'
      const node = latestFlow.current.nodes.find((n) => n.id === first)
      return node ? revealNode(node) : undefined
    },
  })
  const shotsSnapshot = useShots()
  const [panel, setPanel] = useState<PanelTarget>()
  const panelKey = panel ? keyOfTarget(panel) : undefined
  // 面板真的有內容才算開著（鏡頭被刪掉時面板會自己收起）
  const panelOpen =
    panel !== undefined &&
    (!('shotId' in panel) || shotsSnapshot.shots.some((s) => s.id === panel.shotId))
  // 面板開著時選了另一格（有面板的）：面板跟著換成那一格
  useEffect(() => {
    if (selected.size !== 1) return
    const [only] = selected
    const next = only === undefined ? undefined : panelTargetOf(only)
    if (!next) return
    setPanel((current) => (current && keyOfTarget(current) !== keyOfTarget(next) ? next : current))
  }, [selected])
  // 面板開著時，右下角的提示往左讓開（提示在整個 App 的最上層，用根元素的屬性告訴它）
  useEffect(() => {
    const root = document.documentElement
    if (panelOpen) root.dataset.canvasPanel = 'open'
    else delete root.dataset.canvasPanel
    return () => {
      delete root.dataset.canvasPanel
    }
  }, [panelOpen])
  // 面板打開或換了一格：那一格被面板擋住就平移讓位（只平移、不縮放）
  useEffect(() => {
    if (panelKey === undefined) return
    const node = latestFlow.current.nodes.find((n) => n.id === panelKey)
    const el = containerRef.current
    if (!node || !el) return
    const viewport = rf.getViewport()
    const pan = panToReveal(
      viewport,
      { width: el.clientWidth, height: el.clientHeight },
      rectOf(node),
      { ...REVEAL_MARGIN, right: FLOAT_PANEL.width + FLOAT_PANEL.inset * 2 + 24 },
    )
    if (pan) void rf.setViewport({ ...viewport, ...pan }, { duration: 300 })
  }, [panelKey, rf])
  const { ask: askRun } = runner
  // ▶ 滑過與 ▾ 選單看的預估：照目前選的品質等級問後端這一次會跑什麼、大概多少錢（或為什麼還不能跑）
  const runQuality = runner.quality
  const estimateRun = useCallback(
    async (nodeId: string, scope?: RunScope): Promise<RunEstimate | undefined> => {
      try {
        const plan = await call('canvas.runPlan', {
          keys: [nodeId],
          ...(scope ? { scope } : {}),
          ...(runQuality ? { quality: runQuality } : {}),
        })
        return {
          usd: plan.estimatedUsd,
          lowerBound: plan.estimateIsLowerBound,
          nothing: plan.ok && plan.steps.length === 0,
          ...(plan.ok ? {} : { issue: plan.issue ?? '現在不能跑。' }),
        }
      } catch {
        return undefined
      }
    },
    [runQuality],
  )
  const [runMenu, setRunMenu] = useState<{ nodeId: string; anchor: ConfirmAnchor }>()
  // 展開或收合步驟：下面的列往下讓開或收回來（300ms），只在這段時間給格子加位移動畫
  const [shifting, setShifting] = useState(false)
  const shiftTimer = useRef<number | undefined>(undefined)
  const animateRows = useCallback((): void => {
    window.clearTimeout(shiftTimer.current)
    setShifting(true)
    shiftTimer.current = window.setTimeout(() => {
      setShifting(false)
    }, 700)
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(shiftTimer.current)
    },
    [],
  )
  const shotIds = useMemo(
    () => graph.nodes.filter((n) => n.kind === 'shot').map((n) => n.key.replace(/^shot:/, '')),
    [graph.nodes],
  )
  const allExpanded = shotIds.length > 0 && shotIds.every((id) => expanded.has(id))
  const closePanel = useCallback((): void => {
    setPanel(undefined)
  }, [])
  const hasShots = useMemo(() => graph.nodes.some((n) => n.kind === 'shot'), [graph.nodes])
  const pendingCost = usePendingCost(graph, hasShots, runner.quality)
  // 確認執行時，標亮會跑的那一串節點（「執行到這裡」）
  const highlight = useMemo(
    () => new Set(runner.pending?.plan.highlightKeys ?? []),
    [runner.pending],
  )
  const growingRef = useRef(grow.running)
  growingRef.current = grow.running
  const nodes = useMemo(
    () =>
      drag.nodes.map((n) => {
        const picked = selected.has(n.id)
        const aiTouched = aiMarks.fresh.has(n.id)
        const aiFlash = aiMarks.flash.has(n.id)
        const fresh = n.id === born || grown.has(n.id)
        const busy =
          n.data.kind === 'oneliner' && (grow.running === n.id || grow.running === ANY_ONELINER)
        const glow = highlight.has(n.id)
        if (!picked && !fresh && !busy && !glow && !aiTouched) return n
        return {
          ...n,
          ...(picked ? { selected: true } : {}),
          ...(fresh || busy || glow || aiTouched
            ? {
                data: {
                  ...n.data,
                  ...(fresh ? { born: true } : {}),
                  ...(aiTouched ? { aiTouched: true } : {}),
                  ...(aiFlash ? { aiFlash: true } : {}),
                  ...(busy ? { status: 'running' as const } : {}),
                  ...(glow ? { glow: true } : {}),
                },
              }
            : {}),
        }
      }),
    [drag.nodes, selected, born, grown, grow.running, highlight, aiMarks.fresh, aiMarks.flash],
  )
  const lod = useStore((s): Lod =>
    s.transform[2] >= 0.5 ? 'full' : s.transform[2] >= 0.25 ? 'mid' : 'low',
  )
  // 縮小時要放大的字（場的編號、卡片名稱）用到目前的縮放；只在縮小的層級才更新。
  // 每 5% 才更新一次：--zoom 一變，整個畫布的樣式都要重算，每 1% 就更新的話縮放時會掉格
  const zoom = useStore((s) =>
    s.transform[2] < 0.5 ? Math.max(0.05, Math.round(s.transform[2] * 20) / 20) : 1,
  )

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]): void => {
    const picks = changes.flatMap((c) => (c.type === 'select' ? [c] : []))
    if (picks.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const pick of picks) {
        if (pick.selected) next.add(pick.id)
        else next.delete(pick.id)
      }
      return next
    })
  }, [])

  // 點到的線（React Flow 的線是我們自己給的，選取要自己記）：高亮、按 Delete 剪掉；選了格子就放掉
  const [pickedEdge, setPickedEdge] = useState<string>()
  useEffect(() => {
    if (selected.size > 0) setPickedEdge(undefined)
  }, [selected])

  // 相連的節點被選取時連線變亮、上游執行中時有流動動畫
  const edges = useMemo(() => {
    const running = new Set(flow.nodes.filter((n) => n.data.status === 'running').map((n) => n.id))
    // 格子很多時只畫主線；參考線（角色、地點）只畫跟選取的格子相連的（uiux-spec §12.13）
    const many = flow.nodes.length > MANY_NODES
    return flow.edges.flatMap((edge): CanvasEdge[] => {
      const hot =
        selected.has(edge.source) ||
        selected.has(edge.target) ||
        (highlight.has(edge.source) && highlight.has(edge.target))
      const tone = edge.data?.tone ?? 'main'
      if (many && tone === 'ref' && !hot && edge.selected !== true) return []
      return [
        {
          ...edge,
          ...(pickedEdge === edge.id ? { selected: true } : {}),
          data: {
            tone,
            hot,
            flowing: running.has(edge.target),
            ...(grown.has(edge.target) ? { born: true } : {}),
            ...(edge.data?.cuttable === true ? { cuttable: true } : {}),
          },
        },
      ]
    })
  }, [flow, selected, grown, highlight, pickedEdge])

  // 有接線的連接點：沒接線的平常藏起來（F：懸空的點不要露出來）
  const connectedPorts = useMemo(
    () =>
      new Set(
        flow.edges.flatMap((e) => [
          `${e.source}|${e.sourceHandle ?? ''}`,
          `${e.target}|${e.targetHandle ?? ''}`,
        ]),
      ),
    [flow.edges],
  )

  // ── 視角記憶：停下來半秒後存起來（不進復原歷史） ──
  const saveTimer = useRef<number | undefined>(undefined)
  const onMoveEnd = useCallback((_: unknown, viewport: CanvasViewport): void => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      call('canvas.viewport', viewport).catch(() => undefined)
    }, VIEWPORT_SAVE_DELAY_MS)
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
    },
    [],
  )

  // 背景做完事（例如生成完自動接片）的通知
  useEffect(
    () =>
      window.svs.on('canvas.notice', (notice) => {
        toast.show({
          key: 'canvas-notice',
          message: notice.message,
          ...(notice.tone === 'danger' ? { tone: 'danger' as const } : {}),
        })
      }),
    [toast],
  )

  // ── 新增節點 ──
  // place：新節點想放的位置（畫布座標，節點上緣中間）；沒有就交給自動排版
  const [addMenu, setAddMenu] = useState<{ at: XY; place?: XY; from?: PortRef }>()
  const pendingReveal = useRef<string | undefined>(undefined)
  const pendingFit = useRef(false)
  const bornTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(bornTimer.current)
    },
    [],
  )
  // 資料重新載入、新節點出現了：選取、長出動畫、平移到看得見
  useEffect(() => {
    const key = pendingReveal.current
    if (key === undefined) return
    const node = flow.nodes.find((n) => n.id === key)
    if (!node) return
    pendingReveal.current = undefined
    setSelected(new Set([key]))
    setBorn(key)
    window.clearTimeout(bornTimer.current)
    bornTimer.current = window.setTimeout(() => {
      setBorn(undefined)
    }, BORN_MS)
    if (pendingFit.current) {
      pendingFit.current = false
      // 等節點都進了畫布的內部狀態再算外框
      window.setTimeout(() => {
        fitAll(300)
      }, 80)
    } else void revealNode(node)
  }, [flow.nodes, revealNode, fitAll])
  // 一句話生成中，資料每次重新載入就多幾個節點：新出現的播長出動畫
  const knownKeys = useRef<ReadonlySet<string> | undefined>(undefined)
  const growTimers = useRef<number[]>([])
  useEffect(() => {
    const previous = knownKeys.current
    knownKeys.current = new Set(flow.nodes.map((n) => n.id))
    if (!previous || growingRef.current === undefined) return
    const fresh = flow.nodes.filter((n) => !previous.has(n.id))
    if (fresh.length === 0) return
    const ids = fresh.map((n) => n.id)
    // 記住新的場，長完時才把它帶進畫面；長的過程中不移動畫面
    const frame = fresh.find((n) => n.type === 'frame')
    if (frame && grownScene.current === undefined) grownScene.current = frame.id
    setGrown((current) => new Set([...current, ...ids]))
    growTimers.current.push(
      window.setTimeout(() => {
        setGrown((current) => {
          const next = new Set(current)
          for (const id of ids) next.delete(id)
          return next
        })
      }, BORN_MS),
    )
  }, [flow.nodes])
  useEffect(
    () => () => {
      for (const timer of growTimers.current) window.clearTimeout(timer)
    },
    [],
  )

  /** 畫面上的點（滑鼠位置、面板中央）對應的畫布座標。 */
  const flowPointOf = useCallback((screen: XY): XY => rf.screenToFlowPosition(screen), [rf])
  const centerOfView = useCallback((): XY => {
    const rect = containerRef.current?.getBoundingClientRect()
    return flowPointOf({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    })
  }, [flowPointOf])
  /** 現在畫面上看得到、沒被上方列、左側面板、右側面板、縮放列蓋住的範圍（畫布座標）。 */
  const placeArea = useCallback((): Rect | undefined => {
    const el = containerRef.current
    if (!el) return undefined
    return visibleRect(
      rf.getViewport(),
      { width: el.clientWidth, height: el.clientHeight },
      panelOpen
        ? { ...PLACE_MARGIN, right: FLOAT_PANEL.width + FLOAT_PANEL.inset * 2 + 24 }
        : PLACE_MARGIN,
    )
  }, [rf, panelOpen])
  const addNode = useCallback(
    (
      kind: CanvasAddKind,
      place?: XY,
      from?: PortRef,
      story?: string,
      after?: { fit?: boolean; empty?: boolean; message?: string },
    ): void => {
      // 鏡頭放進游標所在的場；角色與地點放在想放的位置，被佔住就挪到最近的空位
      const sceneKey = kind === 'shot' && place ? sceneAt(flow.nodes, place)?.id : undefined
      let spot: XY | undefined
      let box: { width: number; height: number } | undefined
      const at =
        place ??
        (kind === 'oneliner'
          ? ONELINER_HOME
          : kind === 'note' || kind === 'group' || kind === 'character' || kind === 'location'
            ? centerOfView()
            : undefined)
      if (
        at &&
        (kind === 'character' || kind === 'location' || kind === 'oneliner' || kind === 'note')
      ) {
        const size = NODE_SIZE[kind]
        const free = freeSpot(
          obstaclesNow(),
          size,
          { x: at.x - size.w / 2, y: at.y - 20 },
          undefined,
          undefined,
          placeArea(),
        )
        spot = { x: snap(free.x), y: snap(free.y) }
        rememberPlaced(spot, size)
      }
      if (kind === 'group') {
        // 有選取的格子：群組框住它們（選到場框就框住整場）；沒有就放一個空的在這裡
        // 鏡頭連同它的圖與影片一起框（它們本來就一起動）。
        // 從左邊面板或選單「新增」的（empty）永遠是空的：剛新增的節點會自動被選取，
        // 不然新的群組框會蓋在它上面，也壓到旁邊的場框；要框住選取的用 Ctrl+G
        const picked = flow.nodes.flatMap((n) =>
          after?.empty === true || !selected.has(n.id) || isGroup(n)
            ? []
            : isFrame(n)
              ? membersOf(flow.nodes, n.id)
              : n.data.kind === 'shot'
                ? chainOf(flow.nodes, n.data.shotId)
                : [n],
        )
        const around = boundsOf(picked)
        // 上面比場框多留：群組的標題列在場框的標題列上面，兩個都抓得到；
        // 下面只留 16，免得壓到下一列鏡頭
        const rect = around
          ? { x: around.x - 16, y: around.y - 44, w: around.w + 32, h: around.h + 36 }
          : (() => {
              // 沒有選取：放一個空的群組框在這裡；那裡被別的格子佔住就挪到空位（不然框出一堆不相干的格子）
              const size = { w: 480, h: 300 }
              const free = freeSpot(
                obstaclesNow(),
                size,
                { x: (at?.x ?? 0) - 240, y: (at?.y ?? 0) - 150 },
                undefined,
                undefined,
                placeArea(),
              )
              rememberPlaced({ x: snap(free.x), y: snap(free.y) }, size)
              return { x: snap(free.x), y: snap(free.y), ...size }
            })()
        spot = { x: rect.x, y: rect.y }
        box = { width: rect.w, height: rect.h }
      }
      call('canvas.add', {
        kind,
        ...(spot ? { x: spot.x, y: spot.y } : {}),
        ...(box ?? {}),
        ...(sceneKey === undefined ? {} : { sceneKey }),
        ...(from ? { from: { key: from.nodeId, port: from.portId, side: from.side } } : {}),
      })
        .then(async (result) => {
          // 空畫布上先寫好的故事：一起存進新的一句話
          if (kind === 'oneliner' && story !== undefined && story !== '') {
            await call('canvas.updateOneliner', { key: result.key, patch: { story } })
          }
          pendingReveal.current = result.key
          onChanged()
          // 從空白畫布「自己一步一步來」加的第一個鏡頭：不自動打開右邊的面板（會蓋住畫布右半邊的
          // 剪輯節點），改成把整串節點放進畫面，要寫描述就雙擊卡片
          if (after?.fit === true) pendingFit.current = true
          // 新增的都能用 Cmd/Ctrl+Z 收回
          toast.show({
            key: 'canvas-add',
            message:
              after?.message ??
              (kind === 'character' ? `已新增角色「${result.title}」` : `已新增${result.title}`),
            action: { label: '復原', onAction: history.undo },
            ...(after?.message === undefined ? {} : { ms: 10_000 }),
          })
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [flow.nodes, selected, centerOfView, placeArea, history.undo, onChanged, toast],
  )
  // ── 貼一段故事拆分鏡（空白畫布的入口之一） ──
  const split = useStorySplit({ onChanged })

  // ── 沒歸場的鏡頭：畫布上方提醒，一鍵看到它們、或歸進最後一個場 ──
  const loose = useMemo(
    () => flow.nodes.filter((n) => n.data.kind === 'shot' && n.data.sceneId === undefined),
    [flow.nodes],
  )
  const lastScene = useMemo(
    () => flow.nodes.filter((n) => n.data.kind === 'scene').at(-1),
    [flow.nodes],
  )
  const sceneNameOf = (scene: CanvasNode): string => scene.data.title
  const showLoose = useCallback((): void => {
    void rf.fitView({
      nodes: loose.map((n) => ({ id: n.id })),
      maxZoom: 1,
      padding: FIT_OPTIONS.padding,
      duration: 300,
    })
  }, [rf, loose])
  const assignLoose = useCallback((): void => {
    const shotIds = loose.map((n) => n.id.replace(/^shot:/, ''))
    const where = lastScene === undefined ? '新的場' : `「${lastScene.data.title}」`
    call('shots.assignScene', { shotIds })
      .then(() => {
        onChanged()
        toast.show({
          key: 'canvas-assign',
          message: `已把 ${String(shotIds.length)} 個鏡頭歸進${where}，它們會接進成品`,
          action: { label: '復原', onAction: history.undo },
          ms: 10_000,
        })
      })
      .catch((error: unknown) => {
        toast.show({ message: errorText(error), tone: 'danger' })
      })
  }, [loose, lastScene, onChanged, toast, history.undo])

  /** Tab 或 / 開的選單：選單在畫面上方中間，新節點放在畫面正中央。 */
  const openMenuAtCenter = useCallback((): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    setAddMenu({
      at: { x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 124, y: (rect?.top ?? 0) + 120 },
      place: centerOfView(),
    })
  }, [centerOfView])
  const linking = useLinking({
    graph: flow,
    onChanged,
    addableCount: (portId, side) => addableAt(portId, side).length,
    openAddMenu: (from, at) => {
      // 放開的地方就是新節點的位置：輸出點拉出來的放在右邊一點、輸入點的放在左邊
      const point = flowPointOf(at)
      setAddMenu({
        at,
        place: { x: point.x + (from.side === 'out' ? 120 : -120), y: point.y },
        from,
      })
    },
  })

  // ── 整理：拖過的格子回到自動排版，再全部顯示 ──
  const tidy = useCallback((): void => {
    call('canvas.tidy', {})
      .then(async (result) => {
        // 格子滑回自動排好的位置（300ms），不是一下跳過去
        if (result.reset > 0) animateRows()
        await onRefresh()
        fitAll()
        toast.show({
          key: 'canvas-tidy',
          message:
            result.reset === 0
              ? '已經是排好的樣子了'
              : `已整理：${String(result.reset)} 格回到自動排好的位置`,
          ...(result.reset === 0 ? {} : { action: { label: '復原', onAction: history.undo } }),
        })
      })
      .catch((error: unknown) => {
        toast.show({ message: errorText(error), tone: 'danger' })
      })
  }, [animateRows, fitAll, history.undo, onRefresh, toast])

  // ── 刪除：不跳確認框，直接刪、提示寫清楚後果並附「復原」（資料表的列、版本、聲音都能整個找回來，
  //    圖和影片檔本來就不會被刪） ──
  const removeNow = useCallback(
    (plan: DeletePlan): void => {
      call('canvas.remove', { keys: plan.keys })
        .then(() => {
          setSelected(new Set())
          onChanged()
          toast.show({
            key: 'canvas-delete',
            message: plan.message,
            action: { label: '復原', onAction: history.undo },
            ms: DELETE_TOAST_MS,
          })
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [history.undo, onChanged, toast],
  )
  const requestDelete = useCallback(
    (ids?: ReadonlySet<string>): void => {
      const { plan, reason } = planDelete(flow.nodes, ids ?? selected)
      if (plan) removeNow(plan)
      else if (reason) toast.show({ message: reason })
    },
    [flow.nodes, selected, toast, removeNow],
  )
  const requestDeleteRef = useRef(requestDelete)
  requestDeleteRef.current = requestDelete
  // 選到線按 Delete：剪得掉的剪掉（一步復原），固定的線說明原因
  const pickedEdgeRef = useRef(pickedEdge)
  pickedEdgeRef.current = pickedEdge
  const edgeKeyRef = useRef<(edges: { id: string; cuttable: boolean }[]) => void>(() => undefined)
  edgeKeyRef.current = (edges) => {
    const cuttable = edges.filter((e) => e.cuttable)
    if (cuttable.length === 0) toast.show({ message: FIXED_EDGE_REASON })
    for (const edge of cuttable) linking.unlinkEdge(edge.id)
  }

  // ── 複製、貼上（uiux-spec §12.10）：鏡頭接在原鏡頭後面、場整場複製到最後、角色與地點加「副本」、
  //    圖與影片貼成獨立的格子、自由格子原樣複製；整批一步復原 ──
  const clipboard = useRef<{
    keys: string[]
    /** 照位移貼上的格子（鏡頭、場由自動排版放，不算）的範圍。 */
    rect: { x: number; y: number; w: number; h: number }
    pasted: number
  }>(undefined)
  const [canPaste, setCanPaste] = useState(false)
  /** 記下要複製的格子；剪輯不能複製。回傳記下了幾格。 */
  const copyNodes = useCallback(
    (ids?: ReadonlySet<string>): number => {
      const picked = latestFlow.current.nodes.filter(
        (n) => (ids ?? selected).has(n.id) && n.data.kind !== 'cut',
      )
      if (picked.length === 0) return 0
      const placed = picked.filter((n) => !AUTO_PLACED.has(n.data.kind))
      const box = boundsOf(placed.length > 0 ? placed : picked)
      clipboard.current = {
        keys: picked.map((n) => n.id),
        rect: box ?? { x: 0, y: 0, w: 0, h: 0 },
        pasted: 0,
      }
      setCanPaste(true)
      return picked.length
    },
    [selected],
  )
  /** 貼上：沒給位置就往右下挪一點（連續貼會一張張錯開）；給了位置就貼在那裡。 */
  const pasteNodes = useCallback(
    (at?: XY): void => {
      const board = clipboard.current
      if (!board) {
        toast.show({ key: 'paste', message: '先選取格子按 Ctrl+C 複製，再按 Ctrl+V 貼上' })
        return
      }
      board.pasted += 1
      const step = 40 * board.pasted
      const { rect } = board
      // 沒給位置：往右下錯開一點；那裡被別的格子佔住就挪到最近的空位
      // （自由格子、角色、地點可以疊在自己的原件上，像一般的「再做一份」）
      const copied = new Set(board.keys)
      const obstacles = latestFlow.current.nodes.filter(
        (n) => !(copied.has(n.id) && SELF_OVERLAP.has(n.data.kind)),
      )
      const spot = at
        ? { x: snap(at.x), y: snap(at.y) }
        : freeSpot(obstacles, { w: rect.w, h: rect.h }, { x: rect.x + step, y: rect.y + step })
      const offset = { dx: spot.x - rect.x, dy: spot.y - rect.y }
      call('canvas.paste', { keys: board.keys, ...offset })
        .then((result) => {
          onChanged()
          if (result.added.length > 0) {
            setSelected(new Set(result.added.map((a) => a.key)))
            const [only] = result.added
            toast.show({
              key: 'canvas-paste',
              message:
                result.added.length === 1 && only
                  ? `已貼上「${only.title}」`
                  : `已貼上 ${String(result.added.length)} 格`,
              action: { label: '復原', onAction: history.undo },
            })
          }
          if (result.skipped.length > 0) {
            toast.show({
              message: result.skipped.map((x) => `「${x.name}」沒貼上：${x.reason}`).join('\n'),
              tone: 'danger',
            })
          }
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [history.undo, onChanged, toast],
  )
  const copyRef = useRef({ copyNodes, pasteNodes })
  copyRef.current = { copyNodes, pasteNodes }
  const onPickAdd = (choice: AddChoice): void => {
    const menu = addMenu
    setAddMenu(undefined)
    if (!menu) return
    if (choice.kind === 'freeImage') {
      // 從「第一張畫面」或「參考圖」的「＋」：選好的圖直接接上去
      const from = menu.from
      importFiles(
        menu.place,
        from?.side === 'in' ? { key: from.nodeId, port: from.portId } : undefined,
      )
      return
    }
    const kind = addKindOf(choice.kind)
    if (kind) addNode(kind, menu.place, menu.from, undefined, { empty: true })
  }
  // ── 放上圖片或影片：「上傳」選檔，或從檔案總管拖進來 ──
  /** 放在想放的地方；被佔住就挪到最近的空位（不然自動排版的場會被推開）。 */
  const mediaSpot = useCallback(
    (at: XY): XY => {
      const size = NODE_SIZE.freeImage
      const free = freeSpot(
        obstaclesNow(),
        size,
        { x: at.x - size.w / 2, y: at.y - size.h / 2 },
        undefined,
        undefined,
        placeArea(),
      )
      const spot = { x: snap(free.x), y: snap(free.y) }
      rememberPlaced(spot, size)
      return spot
    },
    [obstaclesNow, rememberPlaced, placeArea],
  )
  const reportImport = useCallback(
    (result: CanvasImportResult): void => {
      if (result.added.length > 0) {
        onChanged()
        const [only] = result.added
        // 放上來的圖、影片跟其他新增的一樣：不在看得到的地方就平移過去
        pendingReveal.current = only?.key
        toast.show({
          key: 'canvas-import',
          message:
            result.added.length === 1 && only
              ? `已放上「${only.title}」${result.connected === true ? '，也接上去了' : ''}`
              : `已放上 ${String(result.added.length)} 個檔案${result.connected === true ? '，第一張圖接上去了' : ''}`,
          action: { label: '復原', onAction: history.undo },
        })
      }
      if (result.notice !== undefined) toast.show({ message: result.notice, tone: 'danger' })
      if (result.skipped.length > 0) {
        toast.show({
          message: result.skipped.map((s) => `「${s.name}」沒放上去：${s.reason}`).join('\n'),
          tone: 'danger',
        })
      }
    },
    [history.undo, onChanged, toast],
  )
  const importFiles = useCallback(
    (place?: XY, connectTo?: { key: string; port: string }): void => {
      const at = place ?? centerOfView()
      // 一次選好幾個檔案時，主行程每個檔案各找空位：把現在被佔住的地方一起給它
      // （要在算第一個檔案的位置之前取，不然第一個檔案會把自己的位置也算成「被佔住」）
      const avoid = obstaclesNow()
        .filter((n) => !isGroup(n))
        .map(rectOf)
        .filter((r) => r.w > 0 && r.h > 0)
      const spot = mediaSpot(at)
      call('canvas.importFiles', {
        ...spot,
        ...(connectTo ? { connectTo } : {}),
        avoid,
      })
        .then(reportImport)
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [centerOfView, mediaSpot, obstaclesNow, reportImport, toast],
  )
  const importDropped = async (files: readonly File[], at: XY): Promise<void> => {
    for (const [index, file] of files.entries()) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const mime = CANVAS_IMPORT_EXT[ext]
      if (!mime) {
        reportImport({
          added: [],
          skipped: [
            {
              name: file.name,
              reason: '不支援這種檔案（可以放 PNG、JPG、WebP 圖片或 MP4、WebM、MOV 影片）',
            },
          ],
        })
        continue
      }
      if (file.size > CANVAS_IMPORT_MAX_BYTES) {
        reportImport({
          added: [],
          skipped: [
            { name: file.name, reason: '檔案太大（超過 200 MB），請改用左側的「圖片或影片」選檔' },
          ],
        })
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        reportImport(
          await call('canvas.importBytes', {
            name: file.name,
            mime,
            bytes,
            ...mediaSpot({ x: at.x + index * 240, y: at.y }),
          }),
        )
      } catch (error) {
        toast.show({ message: errorText(error), tone: 'danger' })
      }
    }
  }
  const onDrop = (event: DragEvent): void => {
    const at = flowPointOf({ x: event.clientX, y: event.clientY })
    // 從檔案總管拖進來的圖片或影片
    if (event.dataTransfer.files.length > 0) {
      event.preventDefault()
      void importDropped([...event.dataTransfer.files], at)
      return
    }
    const dragged = event.dataTransfer.getData(DRAG_MIME)
    if (dragged === 'freeImage') {
      event.preventDefault()
      importFiles(at)
      return
    }
    const kind = addKindOf(dragged)
    if (!kind) return
    event.preventDefault()
    addNode(kind, at)
  }

  const actions = useMemo<CanvasActions>(
    () => ({
      openAdd: (from, at) => {
        // 新節點放在「＋」旁邊：輸出點在右邊、輸入點在左邊
        const point = flowPointOf(at)
        setAddMenu({
          at,
          place: { x: point.x + (from.side === 'out' ? 200 : -200), y: point.y },
          from,
        })
      },
      canAdd: (portId, side) => addableAt(portId, side).length > 0,
      aiSeen: (nodeId) => {
        aiSeen([nodeId])
      },
      focusNode: (nodeId) => {
        const node = rf.getNode(nodeId)
        if (!node) return
        const w = node.width ?? 0
        const h = node.height ?? 0
        void rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: 1,
          duration: 300,
        })
      },
      deleteEdge: linking.unlinkEdge,
      toggleSteps: (shotKey) => {
        const shotId = shotKey.replace(/^shot:/, '')
        const next = new Set(expanded)
        if (next.has(shotId)) next.delete(shotId)
        else next.add(shotId)
        animateRows()
        onExpanded(next)
      },
      rejoinFinal: () => {
        toast.show({ key: 'final', message: '接成成品中…' })
        call('shots.rejoin', {})
          .then(() => {
            onChanged()
            toast.show({ key: 'final', message: '成品接好了' })
          })
          .catch((error: unknown) => {
            toast.show({ key: 'final', message: errorText(error), tone: 'danger' })
          })
      },
      exportFinal: () => {
        call('quickstart.export', { credits: creditsPreferred() })
          .then(({ path }) => {
            const name = path.split(/[\\/]/).pop() ?? path
            toast.show({
              key: 'final',
              message: `已匯出到專案的「匯出」資料夾：${name}`,
              // 比一般提示久：第一次匯出的人要來得及看到檔名、按下去找檔案
              ms: LONG_TOAST_MS,
              action: {
                label: revealLabel(),
                onAction: () => {
                  call('files.reveal', { exportName: name }).catch(() => undefined)
                },
              },
            })
          })
          .catch((error: unknown) => {
            toast.show({ key: 'final', message: errorText(error), tone: 'danger' })
          })
      },
      startRename: (nodeId) => {
        startRenameRef.current?.(nodeId)
      },
      saveShotDescription: (shotKey, description) => {
        const shotId = shotKey.replace(/^shot:/, '')
        call('shots.update', { shotId, patch: { description } })
          .then(() => {
            onChanged()
            toast.show({
              key: 'shot-description',
              message: '已改鏡頭描述：第一張畫面和影片要重跑才會用到',
              action: { label: '復原', onAction: history.undo },
            })
          })
          .catch((error: unknown) => {
            onChanged()
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
      savePrompt: (shotKey, prompt) => {
        const shotId = shotKey.replace(/^shot:/, '')
        call('shots.update', { shotId, patch: { prompt } })
          .then(() => {
            onChanged()
            toast.show({
              key: 'step-prompt',
              message:
                prompt === null
                  ? '回到自動整理的 Prompt'
                  : '已改送給模型的 Prompt：第一張畫面和影片要重跑才會用到',
              action: { label: '復原', onAction: history.undo },
            })
          })
          .catch((error: unknown) => {
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
      growStory: (nodeId, params, anchor, stage) => {
        grownScene.current = undefined
        growSource.current = nodeId
        startGrow(
          nodeId,
          params,
          anchor,
          {
            hasContent: flow.nodes.some((n) => n.data.kind === 'shot'),
            existing: {
              scenes: flow.nodes.filter((n) => n.data.kind === 'scene').length,
              shots: flow.nodes.filter((n) => n.data.kind === 'shot').length,
            },
            // 同一個一句話第幾次生成：換一批新的結果
            variation: flow.edges.filter((e) => e.source === nodeId).length,
          },
          stage,
        )
      },
      updateOneliner: (nodeId, patch) => {
        call('canvas.updateOneliner', { key: nodeId, patch })
          .then(onChanged)
          .catch((error: unknown) => {
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
      stopGrow,
      stopNode: (nodeId) => {
        // 一句話生成中：停止整次生成；一般的執行：停止這一鏡
        if (growingRef.current !== undefined) {
          stopGrow()
          return
        }
        const shotId = /^shot:([^:]+)/.exec(nodeId)?.[1]
        if (shotId === undefined) return
        call('shots.cancel', { shotId })
          .then(() => {
            toast.show({ key: 'run', message: '已經停止這一鏡，做好的部分留著' })
          })
          .catch((error: unknown) => {
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
      updateFree: (nodeId, patch) => {
        call('canvas.updateFree', { key: nodeId, patch })
          .then(() => {
            onChanged()
          })
          .catch((error: unknown) => {
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
      deleteNode: (nodeId) => {
        // 卡片上的刪除鈕：這一格在多選裡就是刪整個選取（跟右鍵、Delete 鍵一致）
        requestDelete(selected.has(nodeId) && selected.size > 1 ? selected : new Set([nodeId]))
      },
      openPanel: (nodeId) => {
        setPanel(panelTargetOf(nodeId))
      },
      run: (nodeId, anchor, scope) => {
        askRun({ keys: [nodeId], ...(scope ? { scope } : {}) }, anchor)
      },
      runEstimate: (nodeId, scope) => estimateRun(nodeId, scope),
      openRunMenu: (nodeId, anchor) => {
        setRunMenu({ nodeId, anchor })
      },
      toggleInCut: (nodeId) => {
        const node = rf.getNode(nodeId)
        const shotKey = node?.data.shotId
        const shotId = shotKey?.replace(/^shot:/, '')
        if (!node || !shotKey || !shotId) return
        const on = node.data.inCut === false
        const name = rf.getNode(shotKey)?.data.title ?? '這一鏡'
        call('shots.update', { shotId, patch: { inCut: on } })
          .then(() => {
            // 說清楚影響：剪輯會跳過它（或放回去），而且可以復原
            toast.show({
              key: 'canvas-incut',
              message: on
                ? `${name}放回成品：接成成品時會用到它。`
                : `${name}不放進成品：接成成品時會跳過這一鏡，剪輯的鏡數跟著少一。`,
              action: { label: '復原', onAction: history.undo },
            })
          })
          .catch((error: unknown) => {
            toast.show({ message: errorText(error), tone: 'danger' })
          })
      },
    }),
    [
      flowPointOf,
      flow.edges,
      flow.nodes,
      startGrow,
      stopGrow,
      askRun,
      linking.unlinkEdge,
      onChanged,
      rf,
      toast,
      history.undo,
      aiSeen,
    ],
  )

  // Cmd/Ctrl+Enter：執行選取的節點（補跑還沒有結果的）。用捕捉階段，
  // 免得選取中的節點先吃掉 Enter（React Flow 會把 Enter 當成切換選取）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      const el = event.target
      if (
        el instanceof HTMLElement &&
        (el.matches('input, textarea, select, button, [role="dialog"] *') || el.isContentEditable)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      const keys = rf
        .getNodes()
        .filter((n) => n.selected === true && isRunnable(n.id))
        .map((n) => n.id)
      if (keys.length === 0) {
        toast.show({ key: 'run-hint', message: '先選取要執行的鏡頭、圖、影片或剪輯' })
        return
      }
      const first = containerRef.current?.querySelector(
        `.react-flow__node[data-id="${keys[0] ?? ''}"]`,
      )
      const box = containerRef.current?.getBoundingClientRect()
      const middle = {
        left: (box?.left ?? 0) + (box?.width ?? 800) / 2 + 170,
        right: (box?.left ?? 0) + (box?.width ?? 800) / 2 + 170,
        top: (box?.top ?? 0) + (box?.height ?? 600) / 2,
        bottom: (box?.top ?? 0) + (box?.height ?? 600) / 2,
      }
      const anchor: ConfirmAnchor = first ? anchorOf(first) : middle
      askRun({ keys }, anchor)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [rf, askRun, toast])

  // F2 改名：輸入框蓋在標題列上
  const [renaming, setRenaming] = useState<RenameTarget>()
  const startRename = useCallback(
    (nodeId: string): void => {
      const node = rf.getNode(nodeId)
      const el = containerRef.current?.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
      if (!node || !el) return
      const head = el.querySelector('.svs-frame-title, .svs-group-grip') ?? el
      const box = head.getBoundingClientRect()
      // 場框的標題是「第 N 場・標題」，只改後面的標題
      const title = node.data.title
      const initial = isFrame(node) ? title.slice(title.indexOf('・') + 1) : title
      setRenaming({
        key: nodeId,
        initial,
        rect: { left: box.left, top: box.top, width: box.width, height: 34 },
      })
    },
    [rf],
  )
  startRenameRef.current = startRename
  const commitRename = (target: RenameTarget, title: string): void => {
    setRenaming(undefined)
    call('canvas.rename', { key: target.key, title })
      .then(() => {
        onChanged()
        toast.show({
          key: 'canvas-rename',
          message: `已改名為「${title}」`,
          action: { label: '復原', onAction: history.undo },
        })
      })
      .catch((error: unknown) => {
        toast.show({ message: errorText(error), tone: 'danger' })
      })
  }

  // 選取了節點時：方向鍵微調位置（Shift 一次 64px）、Enter 開面板、F2 改名。
  // 用捕捉階段，免得 React Flow 先把方向鍵與 Enter 拿去做它自己的事
  const selectionKeys = useRef({ nudge: drag.nudge, startRename, toast })
  selectionKeys.current = { nudge: drag.nudge, startRename, toast }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const arrow = event.key.startsWith('Arrow')
      if (!arrow && event.key !== 'Enter' && event.key !== 'F2') return
      const el = event.target
      if (
        el instanceof HTMLElement &&
        (el.matches('input, textarea, select, button, [role="menuitem"], [role="dialog"] *') ||
          el.isContentEditable)
      )
        return
      const picked = rf.getNodes().filter((n) => n.selected === true)
      if (picked.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const { nudge, startRename: rename, toast: tell } = selectionKeys.current
      if (arrow) {
        const step = event.shiftKey ? GRID * 4 : GRID
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        nudge(
          picked.map((n) => n.id),
          dx,
          dy,
        )
        return
      }
      const [only] = picked
      if (picked.length !== 1 || !only) {
        tell.show({ key: 'select-one', message: '一次選一格再按 Enter 或 F2' })
        return
      }
      if (event.key === 'F2') {
        if (isRenamable(only.id, only.data.kind)) rename(only.id)
        else tell.show({ key: 'select-one', message: '場、角色、地點、群組才能改名' })
        return
      }
      if (only.data.kind === 'note') {
        window.dispatchEvent(new CustomEvent('svs-edit-note', { detail: only.id }))
        return
      }
      const target = panelTargetOf(only.id)
      if (target) {
        setPanel(target)
        return
      }
      if (only.data.kind === 'oneliner') {
        containerRef.current
          ?.querySelector<HTMLTextAreaElement>(
            `.react-flow__node[data-id="${only.id}"] [data-testid="oneliner-story"]`,
          )
          ?.focus()
        return
      }
      tell.show({
        key: 'select-one',
        message: isRenamable(only.id, only.data.kind)
          ? only.data.kind === 'group'
            ? '按 F2 改名；選取時標題列右邊可以換顏色'
            : '按 F2 改名；詳細內容在左側的大綱、角色頁'
          : '這一格沒有面板可以打開',
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [rf])

  // ── 右鍵選單：格子上（依種類）、空白處各一組 ──
  const [menu, setMenu] = useState<{ at: XY; entries: MenuEntry[] }>()
  // 「？」選單：怎麼開始、鍵盤快捷鍵、效能自測
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false)
  const [perfOpen, setPerfOpen] = useState(false)
  const openHelp = (anchor: ConfirmAnchor): void => {
    setAddMenu(undefined)
    setMenu({
      at: { x: anchor.right - CONTEXT_W, y: anchor.bottom + 6 },
      entries: [
        {
          label: '怎麼開始',
          hint: '三個步驟',
          onSelect: () => {
            setGettingStartedOpen(true)
          },
        },
        {
          label: '鍵盤快捷鍵',
          onSelect: () => {
            setShortcutsOpen(true)
          },
        },
        {
          label: '效能自測',
          hint: '看每秒幾格',
          onSelect: () => {
            setPerfOpen(true)
          },
        },
      ],
    })
  }
  /** 效能自測的「自動平移」：每一格畫面挪一點視角（繞一圈回到原處），回傳每一格的時間點。 */
  const autoPan = useCallback(
    (ms: number): Promise<number[]> =>
      new Promise((resolve) => {
        const start = rf.getViewport()
        const times: number[] = []
        let first: number | undefined
        const step = (now: number): void => {
          first ??= now
          times.push(now)
          const t = now - first
          if (t >= ms) {
            void rf.setViewport(start)
            resolve(times)
            return
          }
          const angle = (t / ms) * Math.PI * 2
          void rf.setViewport({
            x: start.x - Math.sin(angle) * PERF_PAN_RADIUS,
            y: start.y - (1 - Math.cos(angle)) * (PERF_PAN_RADIUS / 2),
            zoom: start.zoom,
          })
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    [rf],
  )
  const onDemoSeeded = (): void => {
    onExpanded(new Set())
    void onRefresh().then(() => {
      requestAnimationFrame(() => {
        fitAll()
      })
    })
  }
  const pointAnchor = (at: XY): ConfirmAnchor => ({
    left: at.x,
    right: at.x,
    top: at.y,
    bottom: at.y,
  })
  const doEntry = (entry: ContextEntry, at: XY, targets: readonly CanvasNode[]): void => {
    const [first] = targets
    switch (entry.id) {
      case 'open':
        if (first) setPanel(panelTargetOf(first.id))
        break
      case 'story':
        containerRef.current
          ?.querySelector<HTMLTextAreaElement>(
            `.react-flow__node[data-id="${first?.id ?? ''}"] [data-testid="oneliner-story"]`,
          )
          ?.focus()
        break
      case 'note':
        if (first) window.dispatchEvent(new CustomEvent('svs-edit-note', { detail: first.id }))
        break
      case 'run':
        askRun({ keys: targets.filter((n) => isRunnable(n.id)).map((n) => n.id) }, pointAnchor(at))
        break
      case 'incut':
        if (first) actions.toggleInCut(first.id)
        break
      case 'rename':
        if (first) startRename(first.id)
        break
      case 'focus':
        if (first) actions.focusNode(first.id)
        break
      case 'steps':
        if (first) actions.toggleSteps?.(first.id)
        break
      case 'copy': {
        const count = copyNodes(new Set(targets.map((n) => n.id)))
        toast.show({ key: 'copy', message: `已複製 ${String(count)} 格，按 Ctrl+V 貼上` })
        break
      }
      case 'duplicate':
        if (copyNodes(new Set(targets.map((n) => n.id))) > 0) pasteNodes()
        break
      case 'paste':
        pasteNodes(flowPointOf(at))
        break
      case 'delete':
        requestDelete(new Set(targets.map((n) => n.id)))
        break
      case 'add':
        setAddMenu({ at, place: flowPointOf(at) })
        break
      case 'tidy':
        tidy()
        break
      case 'fit':
        fitAll()
        break
    }
  }
  const openMenu = (
    event: MouseEvent | ReactMouseEvent,
    entries: ContextEntry[],
    targets: readonly CanvasNode[],
  ): void => {
    event.preventDefault()
    const at = { x: event.clientX, y: event.clientY }
    if (entries.length === 0) return
    setAddMenu(undefined)
    setMenu({
      at,
      entries: entries.map((entry) => ({
        label: entry.label,
        ...(entry.hint ? { hint: entry.hint } : {}),
        ...(entry.danger ? { danger: true } : {}),
        ...(entry.separated ? { separated: true } : {}),
        ...(entry.disabled === true ? { disabled: true } : {}),
        ...(entry.why === undefined ? {} : { why: entry.why }),
        onSelect: () => {
          doEntry(entry, at, targets)
        },
      })),
    })
  }
  const onNodeContextMenu = (event: ReactMouseEvent, node: CanvasNode): void => {
    const picked = rf.getNodes().filter((n) => n.selected === true)
    const inGroup = picked.some((n) => n.id === node.id) && picked.length > 1
    // 按在沒選取的格子上：先只選它（之後的動作對它做）
    if (!inGroup) setSelected(new Set([node.id]))
    openMenu(event, nodeEntries(node, picked), inGroup ? picked : [node])
  }

  // Cmd/Ctrl+C 複製、Cmd/Ctrl+V 貼上、Cmd/Ctrl+D 再做一份
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && key !== 'v' && key !== 'd') return
      const el = event.target
      if (
        el instanceof HTMLElement &&
        (el.matches('input, textarea, select') || el.isContentEditable)
      )
        return
      // 有選取畫面上的文字（例如提示裡的字）時，Ctrl+C 照一般的複製文字
      if (key === 'c' && (window.getSelection()?.toString() ?? '') !== '') return
      const { copyNodes: copy, pasteNodes: paste } = copyRef.current
      if (key === 'v') {
        event.preventDefault()
        paste()
        return
      }
      event.preventDefault()
      const count = copy()
      if (count === 0) {
        toast.show({ key: 'select-one', message: '先選取要複製的格子' })
        return
      }
      if (key === 'd') paste()
      else toast.show({ key: 'copy', message: `已複製 ${String(count)} 格，按 Ctrl+V 貼上` })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [toast])

  // Cmd/Ctrl+G：把選取的格子框成一個群組
  const addNodeRef = useRef(addNode)
  addNodeRef.current = addNode
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'g') return
      const el = event.target
      if (
        el instanceof HTMLElement &&
        (el.matches('input, textarea, select') || el.isContentEditable)
      )
        return
      event.preventDefault()
      if (!rf.getNodes().some((n) => n.selected === true)) {
        toast.show({ key: 'select-one', message: '先選取要框起來的格子，再按 Ctrl+G' })
        return
      }
      addNodeRef.current('group')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [rf, toast])

  // 沒有選取任何東西時，方向鍵平移畫布
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const el = event.target
      if (
        el instanceof HTMLElement &&
        (el.matches('input, textarea, select, button, [role="menuitem"]') || el.isContentEditable)
      )
        return
      // 刪除選取的節點
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault()
        // 只選到線（沒選到格子）：Delete 就是剪線；固定的線說明為什麼剪不掉
        const edge = rf.getEdges().find((e) => e.id === pickedEdgeRef.current)
        if (edge && !rf.getNodes().some((n) => n.selected === true)) {
          setPickedEdge(undefined)
          edgeKeyRef.current([{ id: edge.id, cuttable: edge.data?.cuttable === true }])
          return
        }
        requestDeleteRef.current()
        return
      }
      // Tab 或 / 開新增選單
      if ((event.key === 'Tab' || event.key === '/') && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        openMenuAtCenter()
        return
      }
      if (!event.key.startsWith('Arrow')) return
      if (rf.getNodes().some((n) => n.selected === true)) return
      event.preventDefault()
      const step = event.shiftKey ? 240 : 80
      const v = rf.getViewport()
      const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0
      const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0
      void rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 150 })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [rf, openMenuAtCenter])

  const empty = graph.nodes.length === 0
  return (
    <CanvasActionsContext.Provider value={actions}>
      <ConnectedPortsContext.Provider value={connectedPorts}>
        <LinkingContext.Provider value={linking.linking}>
          <LodContext.Provider value={lod}>
            <div
              ref={containerRef}
              data-testid="canvas-root"
              data-lod={lod}
              data-alt={drag.alt}
              data-growing={grow.running !== undefined || grow.finishing}
              data-shifting={shifting}
              data-confirming={runner.pending !== undefined || grow.confirm !== undefined}
              data-many={nodes.length > MANY_NODES}
              className="svs-canvas absolute inset-0 bg-surface text-fg"
              style={{ '--zoom': zoom } as CSSProperties}
              onDragOver={(event) => {
                if (
                  event.dataTransfer.types.includes(DRAG_MIME) ||
                  event.dataTransfer.types.includes('Files')
                )
                  event.preventDefault()
              }}
              onDrop={onDrop}
              onDoubleClick={(event) => {
                // 雙擊空白處：在那裡開新增選單
                if (
                  event.target instanceof Element &&
                  event.target.classList.contains('react-flow__pane')
                ) {
                  const at = { x: event.clientX, y: event.clientY }
                  setAddMenu({ at, place: flowPointOf(at) })
                }
              }}
            >
              <ReactFlow<CanvasNode, CanvasEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                colorMode={theme}
                onNodesChange={onNodesChange}
                onNodeContextMenu={onNodeContextMenu}
                onSelectionContextMenu={(event, picked) => {
                  const [first] = picked
                  if (first) openMenu(event, nodeEntries(first, picked), picked)
                }}
                onEdgeClick={(_, edge) => {
                  setPickedEdge(edge.id)
                }}
                onPaneClick={() => {
                  setPickedEdge(undefined)
                  closePanel()
                }}
                onPaneContextMenu={(event) => {
                  openMenu(event, paneEntries(canPaste), [])
                }}
                onMoveEnd={onMoveEnd}
                connectionLineComponent={ConnectionLine}
                onNodeDragStart={drag.onNodeDragStart}
                onNodeDrag={drag.onNodeDrag}
                onNodeDragStop={drag.onNodeDragStop}
                snapToGrid={!drag.alt}
                snapGrid={[GRID, GRID]}
                nodeDragThreshold={3}
                autoPanOnNodeDrag
                autoPanSpeed={12}
                onConnect={linking.onConnect}
                onConnectStart={linking.onConnectStart}
                onConnectEnd={linking.onConnectEnd}
                onReconnect={linking.onReconnect}
                onReconnectStart={linking.onReconnectStart}
                onReconnectEnd={linking.onReconnectEnd}
                reconnectRadius={14}
                isValidConnection={linking.isValidConnection}
                autoPanOnConnect
                connectionRadius={28}
                // 空白處拖曳＝框選（碰到就算）；平移用兩指捲動、滾輪、中鍵拖曳或按住空白鍵拖曳
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                panOnDrag={[1]}
                panOnScroll
                zoomOnScroll={false}
                zoomOnDoubleClick={false}
                zoomActivationKeyCode={['Meta', 'Control']}
                panActivationKeyCode="Space"
                selectionKeyCode="Shift"
                multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                deleteKeyCode={null}
                minZoom={0.1}
                maxZoom={2}
                onlyRenderVisibleElements
                {...initialProps}
                onInit={onInit}
                proOptions={{ hideAttribution: true }}
              >
                {/* 縮得很小時點點密到看不出來，每一格畫面卻都要重畫一整片：不畫 */}
                {lod !== 'full' ? null : (
                  <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.4} />
                )}
                {lod === 'low' ? <SceneLabels nodes={nodes} /> : null}
                {nodes.length > MINIMAP_AFTER ? (
                  <MiniMap pannable zoomable position="bottom-left" />
                ) : null}
                <DragOverlay guides={drag.guides} dropTarget={drag.dropTarget} />
                <ZoomControls
                  right={panelOpen ? FLOAT_PANEL.width + FLOAT_PANEL.inset * 2 : FLOAT_PANEL.inset}
                />
              </ReactFlow>
              <NodePalette
                kinds={MENU_KINDS}
                onAdd={(kind) => {
                  if (kind === 'freeImage') {
                    importFiles()
                    return
                  }
                  const added = addKindOf(kind)
                  if (added) addNode(added, undefined, undefined, undefined, { empty: true })
                }}
              />
              {menu ? (
                <ContextMenu
                  at={menu.at}
                  entries={menu.entries}
                  onClose={() => {
                    setMenu(undefined)
                  }}
                />
              ) : null}
              {renaming ? (
                <RenameBox
                  target={renaming}
                  onCommit={(title) => {
                    commitRename(renaming, title)
                  }}
                  onCancel={() => {
                    setRenaming(undefined)
                  }}
                />
              ) : null}
              {addMenu ? (
                <AddMenu
                  at={addMenu.at}
                  title={addMenu.from ? '接上新的一格' : '新增'}
                  kinds={MENU_KINDS}
                  {...(addMenu.from
                    ? { choices: addableAt(addMenu.from.portId, addMenu.from.side) }
                    : {})}
                  onPick={onPickAdd}
                  onClose={() => {
                    setAddMenu(undefined)
                  }}
                />
              ) : null}
              <TopBar
                {...(hasShots
                  ? {
                      steps: {
                        allExpanded,
                        onToggle: () => {
                          animateRows()
                          onExpanded(allExpanded ? new Set() : new Set(shotIds))
                        },
                      },
                    }
                  : {})}
                canUndo={history.state.canUndo}
                canRedo={history.state.canRedo}
                undoCount={history.state.undoCount ?? 0}
                redoCount={history.state.redoCount ?? 0}
                undoLabel={
                  history.state.canUndo ? `復原：${history.state.undoLabel ?? ''}` : '復原'
                }
                redoLabel={
                  history.state.canRedo ? `重做：${history.state.redoLabel ?? ''}` : '重做'
                }
                onUndo={history.undo}
                onRedo={history.redo}
                {...(hasShots
                  ? {
                      onRunAll: (anchor: ConfirmAnchor) => {
                        askRun({ keys: [], all: true }, anchor)
                      },
                    }
                  : {})}
                pendingCostUsd={pendingCost.usd}
                allDone={pendingCost.done}
                joinOnly={pendingCost.joinOnly}
                running={
                  grow.running !== undefined
                    ? 'grow'
                    : runner.active
                      ? { done: runner.active.finished.size, total: runner.active.keys.length }
                      : undefined
                }
                onStop={grow.running !== undefined ? stopGrow : runner.stop}
                {...(hasShots ? { onTidy: tidy } : {})}
                onHelp={openHelp}
              />
              {perfOpen ? (
                <PerfOverlay
                  counts={{ nodes: nodes.length, edges: edges.length }}
                  pan={autoPan}
                  onSeeded={onDemoSeeded}
                  onClose={() => {
                    setPerfOpen(false)
                  }}
                />
              ) : null}
              {gettingStartedOpen ? (
                <GettingStartedDialog
                  onClose={() => {
                    setGettingStartedOpen(false)
                  }}
                />
              ) : null}
              {shortcutsOpen ? (
                <ShortcutsDialog
                  onClose={() => {
                    setShortcutsOpen(false)
                  }}
                />
              ) : null}
              {linking.hint ? (
                <p
                  role="status"
                  data-testid="connect-hint"
                  className="pointer-events-none fixed z-50 animate-fade-in rounded-lg bg-fg px-3 py-1.5 text-xs text-surface shadow-panel"
                  style={{ left: linking.hint.at.x, top: linking.hint.at.y }}
                >
                  {linking.hint.text}
                </p>
              ) : null}
              <HoverTip
                root={containerRef}
                hidden={runner.pending !== undefined || grow.confirm !== undefined}
              />
              <DetailPanel
                top={TOPBAR_H + FLOAT_PANEL.inset}
                target={panel}
                snapshot={shotsSnapshot}
                nodes={flow.nodes}
                refreshKey={graph}
                onChanged={onChanged}
                onRun={(request, plan) => {
                  runner.start({ request, plan })
                }}
                quality={runner.quality}
                onQuality={runner.setQuality}
                onClose={closePanel}
              />
              {runner.pending ? (
                <RunPlanConfirm
                  plan={runner.pending.plan}
                  anchor={runner.pending.anchor}
                  quality={runner.quality}
                  onQuality={runner.setQuality}
                  onOk={runner.confirm}
                  onCancel={runner.cancel}
                />
              ) : null}
              {runMenu ? (
                <RunModeMenu
                  kind={rf.getNode(runMenu.nodeId)?.data.kind === 'video' ? 'video' : 'image'}
                  anchor={runMenu.anchor}
                  estimate={(scope) => estimateRun(runMenu.nodeId, scope)}
                  onPick={(scope) => {
                    const { nodeId, anchor } = runMenu
                    setRunMenu(undefined)
                    askRun({ keys: [nodeId], scope }, anchor)
                  }}
                  onClose={() => {
                    setRunMenu(undefined)
                  }}
                />
              ) : null}
              {grow.confirm ? (
                <GrowConfirm pending={grow.confirm} onOk={grow.run} onCancel={grow.cancelConfirm} />
              ) : null}
              {empty ? (
                // 空畫布：三種起點（手動、貼故事拆分鏡、一句話），不只「一句話」一條路
                <StartCards
                  busy={split.busy}
                  onManual={() => {
                    addNode('shot', undefined, undefined, undefined, {
                      fit: true,
                      message:
                        '已加上第一個鏡頭（放在新的場裡）。雙擊卡片上的描述寫畫面，寫好按 ▶ 生成；要更多設定按卡片右上的 ↗',
                    })
                  }}
                  onSplit={split.start}
                  onOneliner={(story) => {
                    // 放在內容的左邊（自動排版的場從它右邊長出來），畫面會平移過去
                    addNode('oneliner', undefined, undefined, story)
                  }}
                />
              ) : null}
              {split.pending ? (
                <SplitConfirm pending={split.pending} onOk={split.run} onCancel={split.cancel} />
              ) : null}
              {loose.length > 0 ? (
                <LooseBanner
                  count={loose.length}
                  sceneName={lastScene === undefined ? undefined : sceneNameOf(lastScene)}
                  onShow={showLoose}
                  onAssign={assignLoose}
                />
              ) : null}
            </div>
          </LodContext.Provider>
        </LinkingContext.Provider>
      </ConnectedPortsContext.Provider>
    </CanvasActionsContext.Provider>
  )
}

/** 畫布首頁：整個專案的節點圖，資料來自 `canvas.get`。 */
export function CanvasPage() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const { state, reload, refresh } = useCanvas(expanded)

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-6 text-fg-muted" data-testid="canvas-loading">
        <Spinner label="載入畫布" />
        載入畫布…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-danger">{state.message}</p>
        <Button variant="secondary" onClick={reload}>
          重試
        </Button>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Canvas
        graph={state.graph}
        onChanged={reload}
        onRefresh={refresh}
        expanded={expanded}
        onExpanded={setExpanded}
      />
    </ReactFlowProvider>
  )
}
