import { createDemoSeeder, type DemoSeeder } from './perf/demo-seed'
import { createProjectLibrary, type ProjectLibrary } from './project-library'
import type { RecentStore } from './recent-projects'
import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import type { MediaTools } from '@svs/media'

import { createAnchorSuggester } from './characters/anchor-suggester'
import { createLocationService, type LocationService } from './locations/location-service'
import { createTurnaroundService, type TurnaroundService } from './characters/turnaround-service'
import { createConceptService, type ConceptService } from './characters/concept-service'
import type { CardRenderer } from './credits/credits'
import { createCardService, type CardService, type HtmlRenderer } from './cards/card-service'
import type { ProjectHandle } from '@svs/db'
import { createSoundService, type SoundService } from './sound/sound-service'
import { createCharacterService, type CharacterService } from './characters/character-service'
import type { KeyVault } from './keys/key-vault'
import type { Logger } from './logger'
import { createOutlineService, type OutlineService } from './outline/outline-service'
import { createHistoryService, type HistoryService } from './history/history-service'
import type { ProjectManager } from './project-manager'
import { createQuickStartService, type QuickStartService } from './quickstart/quickstart-service'
import { createCanvasService, type CanvasService } from './canvas/canvas-service'
import { createGraphService, type GraphService } from './graph/graph-service'
import { createFilesService, type FilesService } from './files/files-service'
import { createRecordsService, type RecordsService } from './records/records-service'
import { createUpgradeService, type UpgradeService } from './quickstart/upgrade-service'
import {
  createProjectRuntime,
  type Broadcast,
  type ProjectRuntime,
  type ProjectRuntimeDeps,
} from './runtime/project-runtime'
import { createSettingsService, type SettingsService } from './settings/model-service'
import type { SettingsStore } from './settings/settings-store'
import { createShotService, type ShotService } from './shots/shot-service'
import { createStoryboardService, type StoryboardService } from './storyboard/storyboard-service'
import { createAppLedger, type AppSpendLedger } from './costs/app-ledger'
import { createCostReconciler, type CostReconciler } from './costs/reconcile'
import { createTrailerService, type TrailerService } from './trailer/trailer-service'

export interface StudioAppOptions {
  projects: ProjectManager
  keys: KeyVault
  settings: SettingsStore
  /** App 層的花費帳本（花了錢、專案卻已經不在的那些）；要跟 ProjectManager 用同一個。沒給就只放記憶體。 */
  appLedger?: AppSpendLedger
  /** 沒給就載入內建的 ModelCard。 */
  models?: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 沒有開啟專案時，快速開始自動建立的專案放在這個資料夾裡。 */
  projectsDir: string
  /** 在檔案總管（Finder）裡顯示檔案；沒給就什麼都不做（測試用）。 */
  reveal?: (path: string) => void
  /** 「新專案」的選資料夾視窗；沒給就當作取消（測試用）。 */
  pickFolder?: (purpose: 'save' | 'open') => Promise<string | undefined>
  /** 最近開過的專案（首頁與專案選單）；沒給就只看專案資料夾。 */
  recent?: RecentStore
  /** 畫布「上傳」的選檔視窗；沒給就當作取消（測試用）。 */
  pickFiles?: () => Promise<string[]>
  /** 成品面板「用我自己的音樂…」的選檔視窗（mp3、wav、m4a，一次一個）；沒給或取消就是 undefined（測試用）。 */
  pickMusic?: () => Promise<string | undefined>
  /** 找 FFmpeg；沒給就到系統找。 */
  tools?: () => MediaTools | undefined
  /** 測試用：讓輪詢更快。 */
  pollIntervalMs?: number
  /** 測試用：示範模式的 LLM 回應。 */
  mockLlm?: ProjectRuntimeDeps['mockLlm']
  /** 測試用：示範模式每次生成回報的花費。 */
  mockCostUsd?: ProjectRuntimeDeps['mockCostUsd']
  /** 測試用：示範模式的延遲。 */
  mockLatencyMs?: number
  /** 測試用：示範供應商遇到含這段文字的請求就拒絕。 */
  mockRejectText?: string
  /** 示範圖的畫法。 */
  mockFrame?: ProjectRuntimeDeps['mockFrame']
  /** 測試用：OpenRouter 的位址（本機假伺服器）。 */
  openrouterBaseUrl?: string
  /** 把片尾字卡畫成圖（Electron 離屏視窗）；沒給就匯出時不加字卡。 */
  renderCreditsCard?: CardRenderer
  /** 畫字卡最多等幾毫秒；沒給用預設（20 秒）。測試縮短用。 */
  creditsTimeoutMs?: number
  /** 把一段 HTML 畫成 PNG（文字卡、片名卡；Electron 離屏視窗）；沒給就沒有字卡服務。 */
  renderCardHtml?: HtmlRenderer
  /** 內建字型（Noto Sans TC Bold）的 file:// 網址；沒給或檔案不見就用系統字型。 */
  cardFontUrl?: string
}

export interface StudioApp {
  models: ModelRegistry
  /** 開專案時對帳：任務上有金額、帳本沒記的補記，提示等畫面取走。 */
  costReconciler: CostReconciler
  settingsService: SettingsService
  runtime: ProjectRuntime
  shots: ShotService
  characters: CharacterService
  concepts: ConceptService
  sound: SoundService
  turnarounds: TurnaroundService
  locations: LocationService
  outline: OutlineService
  storyboard: StoryboardService
  trailer: TrailerService
  history: HistoryService
  quickstart: QuickStartService
  upgrade: UpgradeService
  graph: GraphService
  canvas: CanvasService
  records: RecordsService
  files: FilesService
  library: ProjectLibrary
  /** 效能自測的示範專案。 */
  demo: DemoSeeder
  /** 某個專案的字卡服務（文字卡、片名卡畫成 PNG 素材）；沒有畫圖的一方（測試、沒給 renderCardHtml）就是 undefined。 */
  cardsFor: (handle: ProjectHandle) => CardService | undefined
}

/**
 * 把主行程的服務組起來：模型、設定、任務佇列、鏡頭、快速開始。
 * App 本體、E2E、單元測試與真實 API 冒煙腳本都用同一份組法，所以測到的就是實際會跑的。
 */
export function createStudioApp(options: StudioAppOptions): StudioApp {
  const { projects, keys, settings, broadcast, log } = options
  const appLedger = options.appLedger ?? createAppLedger({})
  const models = options.models ?? new ModelRegistry(loadBuiltinModelCards())
  const settingsService = createSettingsService({
    store: settings,
    registry: models,
    keys,
    // 選的模型下架、自動換掉了：叫畫面來取通知
    onNotice: () => {
      broadcast('models.noticed', {})
    },
    project: {
      current: () => {
        const project = projects.current()?.repos.projects.get()
        return project ? { name: project.name, models: project.models } : undefined
      },
      set: (models) => {
        projects.current()?.repos.projects.update({ models })
      },
    },
  })
  const toolsOption = options.tools ? { tools: options.tools } : {}
  const runtime = createProjectRuntime({
    projects,
    keys,
    models,
    broadcast,
    log,
    ...toolsOption,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.mockLlm ? { mockLlm: options.mockLlm } : {}),
    ...(options.mockCostUsd ? { mockCostUsd: options.mockCostUsd } : {}),
    ...(options.mockLatencyMs === undefined ? {} : { mockLatencyMs: options.mockLatencyMs }),
    ...(options.mockRejectText === undefined ? {} : { mockRejectText: options.mockRejectText }),
    ...(options.mockFrame ? { mockFrame: options.mockFrame } : {}),
    ...(options.openrouterBaseUrl === undefined
      ? {}
      : { openrouterBaseUrl: options.openrouterBaseUrl }),
  })
  // 聲音服務在鏡頭服務之後才建（它需要鏡頭服務推送快照），接片時再用 soundRef 呼叫它
  const soundRef: { current?: SoundService } = {}
  // 歷史服務在聲音服務之後才建：旁白被改短的那一步復原要記進去
  const historyRef: { current?: HistoryService } = {}
  // 字卡服務：每個專案一個（同樣的字卡不重畫的記憶跟著專案走）
  const cardServices = new WeakMap<ProjectHandle, CardService>()
  const cardsFor = (handle: ProjectHandle): CardService | undefined => {
    const render = options.renderCardHtml
    if (render === undefined) return undefined
    const existing = cardServices.get(handle)
    if (existing) return existing
    const created = createCardService({
      render,
      assets: handle.assets,
      ...(options.cardFontUrl === undefined ? {} : { fontUrl: options.cardFontUrl }),
      log: (message) => {
        log.info(message)
      },
    })
    cardServices.set(handle, created)
    return created
  }
  const shots = createShotService({
    cardsFor,
    projectsDir: options.projectsDir,
    projects,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
    mixSound: (handle, joined, signal) =>
      soundRef.current?.mixInto(handle, joined, signal) ?? Promise.resolve(undefined),
    soundKeyNow: (handle) => soundRef.current?.soundKey(handle),
    ...toolsOption,
  })
  const quickstart = createQuickStartService({
    projects,
    runtime,
    settings,
    settingsService,
    models,
    shots,
    broadcast,
    log,
    projectsDir: options.projectsDir,
    sound: () => soundRef.current,
    ...(options.renderCreditsCard ? { renderCreditsCard: options.renderCreditsCard } : {}),
    ...(options.creditsTimeoutMs ? { creditsTimeoutMs: options.creditsTimeoutMs } : {}),
    ...toolsOption,
  })
  const upgrade = createUpgradeService({
    projects,
    shots,
    quickstartState: () => quickstart.state(),
  })
  const characters = createCharacterService({
    projects,
    projectsDir: options.projectsDir,
    suggestAnchor: createAnchorSuggester({
      projects,
      appLedger,
      runtime,
      settingsService,
      models,
      ...toolsOption,
    }),
  })
  const concepts = createConceptService({
    projects,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
    ...toolsOption,
  })
  const costReconciler = createCostReconciler({
    projects,
    appLedger,
    subscribeJobs: (listener) => runtime.queue()?.subscribe(listener),
    onNotice: () => {
      broadcast('costs.reconciled', {})
    },
  })
  const sound = createSoundService({
    projects,
    appLedger,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
    shots,
    beginHistory: (label) => historyRef.current?.begin(label) ?? (() => undefined),
    ...(options.pickMusic ? { pickMusic: options.pickMusic } : {}),
    ...toolsOption,
  })
  soundRef.current = sound
  const turnarounds = createTurnaroundService({
    projects,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
    ...toolsOption,
  })
  const locations = createLocationService({
    projects,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
    ...toolsOption,
  })
  const outline = createOutlineService({
    projects,
    appLedger,
    projectsDir: options.projectsDir,
    runtime,
    settings,
    settingsService,
    models,
    log,
    ...toolsOption,
  })
  const storyboard = createStoryboardService({
    projects,
    appLedger,
    runtime,
    settings,
    settingsService,
    models,
    shots,
    log,
    ...toolsOption,
  })
  const history = createHistoryService({ projects, broadcast })
  historyRef.current = history
  const trailer = createTrailerService({
    projects,
    projectsDir: options.projectsDir,
    appLedger,
    runtime,
    settings,
    settingsService,
    models,
    shots,
    record: history.record,
    broadcast,
    log,
    ...toolsOption,
  })
  const library = createProjectLibrary({
    projects,
    projectsDir: options.projectsDir,
    reveal: options.reveal ?? (() => undefined),
    ...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
    ...(options.recent ? { recent: options.recent } : {}),
  })
  return {
    models,
    costReconciler,
    settingsService,
    runtime,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    locations,
    outline,
    storyboard,
    trailer,
    history,
    quickstart,
    upgrade,
    graph: createGraphService({ projects, shots, models }),
    cardsFor,
    canvas: createCanvasService({
      projects,
      broadcast,
      shots,
      outline,
      characters,
      models,
      projectsDir: options.projectsDir,
      log,
      sound: () => soundRef.current,
      ...(options.pickFiles ? { pickFiles: options.pickFiles } : {}),
    }),
    records: createRecordsService({ projects, shots, models }),
    files: createFilesService({ projects, shots, reveal: options.reveal ?? (() => undefined) }),
    library,
    demo: createDemoSeeder({
      library,
      projects,
      ...toolsOption,
      ...(options.mockFrame ? { mockFrame: options.mockFrame } : {}),
    }),
  }
}
