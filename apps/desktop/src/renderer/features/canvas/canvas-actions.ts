import type { CanvasUpdateFree, OnelinerParams } from '@svs/schema'
import { createContext, useContext } from 'react'

import type { ConfirmAnchor } from './run-confirm'

export interface PortRef {
  nodeId: string
  portId: string
  side: 'in' | 'out'
}

/** ▶ 旁的選單：只跑這個、這個和後面的、整條（見 CanvasRunRequest.scope）。 */
export type RunScope = 'this' | 'from-here' | 'chain'

/** ▶ 滑過或選單裡看到的預估：跑這一次大概多少錢、或為什麼還不能跑。 */
export interface RunEstimate {
  usd: number
  /** 有些步驟估不出來，實際可能更多。 */
  lowerBound: boolean
  /** 沒有要跑的步驟（都已經生成好了）。 */
  nothing: boolean
  /** 還不能跑的原因（「還不能跑：先要有第一張畫面…」）。 */
  issue?: string
}

/** 節點卡片裡的按鈕需要叫畫布做的事（由畫布頁提供）。 */
export interface CanvasActions {
  /** ▶：補跑上游還沒生成的，不重跑已經有結果的；先貼在按鈕旁確認花費。沒提供就不顯示 ▶。 */
  run?: (nodeId: string, anchor: ConfirmAnchor, scope?: RunScope) => void
  /** ▶ 滑過時要看的預估（不給 scope 就是 ▶ 本身會做的）。 */
  runEstimate?: (nodeId: string, scope?: RunScope) => Promise<RunEstimate | undefined>
  /** ▶ 旁的 ▾：打開「只跑這個／這個和後面的／整條」選單。沒提供就不顯示 ▾。 */
  openRunMenu?: (nodeId: string, anchor: ConfirmAnchor) => void
  /** 輸出點的「＋」：在這個點旁邊開新增選單。沒提供就不顯示「＋」（M6-7b 才接）。 */
  openAdd?: (from: PortRef, at: { x: number; y: number }) => void
  /** 這個連接點有沒有可以新增的節點（要不要顯示「＋」）；沒提供就照連線規則。 */
  canAdd?: (portId: string, side: 'in' | 'out') => boolean
  /** 卡片上的刪除鈕：刪這一格（在多選裡就刪整個選取）；刪完提示附「復原」。沒提供就不顯示刪除鈕。 */
  deleteNode?: (nodeId: string) => void
  /** 打開鏡頭（含它的圖與影片）或剪輯的詳情面板。沒提供就不顯示開啟鈕。 */
  openPanel?: (nodeId: string) => void
  /** 雙擊標題：置中並縮放到 100%。 */
  focusNode: (nodeId: string) => void
  /** 使用者看過這一格了（滑過一下）：「AI 剛改」的標記就收掉。 */
  aiSeen?: (nodeId: string) => void
  /** 雙擊場、角色、地點、群組的標題：就地改名（輸入框蓋在標題上）。沒提供就還是置中。 */
  startRename?: (nodeId: string) => void
  /** 雙擊鏡頭的描述改完：存回鏡頭（只存起來，圖與影片要重跑才會用到）。沒提供就不能就地改。 */
  saveShotDescription?: (shotKey: string, description: string) => void
  /** 雙擊鏡頭的旁白改完：存回鏡頭（空字串就是不念）。沒提供就不能就地改。 */
  saveShotDialogue?: (shotKey: string, dialogue: string) => void
  toggleInCut: (nodeId: string) => void
  /**
   * 一句話節點的「先產生分鏡」（stage = storyboard，只用文字模型）與「一次做完整支」（stage = full）：
   * 先確認花費，再接著現有的場長出新的場與鏡頭。沒提供就不顯示。
   */
  growStory?: (
    nodeId: string,
    params: OnelinerParams,
    anchor: ConfirmAnchor,
    stage: 'storyboard' | 'full',
  ) => void
  /** 一句話節點的設定改了（故事、畫風、鏡頭數…），存起來。 */
  updateOneliner?: (nodeId: string, patch: Partial<OnelinerParams>) => void
  /** 停止正在生成的短片。 */
  stopGrow?: () => void
  /** 生成中的圖或影片上的 ■：停止這一鏡。 */
  stopNode?: (nodeId: string) => void
  /** 改便條的字、群組的顏色（自由節點）。 */
  updateFree?: (nodeId: string, patch: CanvasUpdateFree['patch']) => void
  /** 連線中點的「×」：剪掉這條線。沒提供就不顯示「×」（M6-7c 才接）。 */
  deleteEdge?: (edgeId: string) => void
  /** 鏡頭的「展開步驟 ▸」：展開或收合這一鏡的步驟。沒提供就不顯示。 */
  toggleSteps?: (shotKey: string) => void
  /** 「整理 Prompt」那一格改了送給模型的 Prompt（null 回到自動整理的）。 */
  savePrompt?: (shotKey: string, prompt: string | null) => void
  /** 剪輯卡的「重新接片」：用各鏡現在採用的影片重新接成一支。 */
  rejoinFinal?: () => void
  /** 剪輯卡的「匯出 MP4」：把成品存到專案的「匯出」資料夾。 */
  exportFinal?: () => void
}

const NOOP: CanvasActions = {
  focusNode: () => undefined,
  toggleInCut: () => undefined,
}

export const CanvasActionsContext = createContext<CanvasActions>(NOOP)
export const useCanvasActions = (): CanvasActions => useContext(CanvasActionsContext)

/**
 * 拉線中：哪些連接點接得上（`節點 id|連接點 id`）。
 * 沒在拉線時是 undefined；接得上的亮綠、接不上的淡掉並且不顯示名字。
 */
export interface Linking {
  /** 從哪一邊拉出來；只有另一邊的點會被標示。 */
  fromSide: 'in' | 'out'
  valid: ReadonlySet<string>
  /** 從哪一格拉出來。 */
  fromNode: string
  /** 至少有一個點接得上的格子：整格標綠；其他的整格淡掉。 */
  validNodes: ReadonlySet<string>
}
export const LinkingContext = createContext<Linking | undefined>(undefined)
export const useLinking = (): Linking | undefined => useContext(LinkingContext)

/** 有接線的連接點（`節點 id|連接點 id`）；沒接線的平常藏起來，滑過或選取那一格才出現。 */
export const ConnectedPortsContext = createContext<ReadonlySet<string>>(new Set())
export const useConnectedPorts = (): ReadonlySet<string> => useContext(ConnectedPortsContext)

/** 縮放層級（LOD）：>=0.5 完整；0.25~0.5 只留標題、狀態色、縮圖；<0.25 只畫色塊。 */
export type Lod = 'full' | 'mid' | 'low'
/** 縮到只畫色塊時，卡片不放縮圖與影片（看不到，進出畫面時建影片元件卻很花時間）。 */
export const LodContext = createContext<Lod>('full')
export const useLod = (): Lod => useContext(LodContext)
