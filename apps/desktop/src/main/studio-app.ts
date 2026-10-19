import { createDemoSeeder, type DemoSeeder } from './perf/demo-seed'
import { createProjectLibrary, type ProjectLibrary } from './project-library'
import { ModelRegistry, loadBuiltinModelCards } from '@svs/providers'
import type { MediaTools } from '@svs/media'

import { createAnchorSuggester } from './characters/anchor-suggester'
import { createLocationService, type LocationService } from './locations/location-service'
import { createTurnaroundService, type TurnaroundService } from './characters/turnaround-service'
import { createConceptService, type ConceptService } from './characters/concept-service'
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

export interface StudioAppOptions {
  projects: ProjectManager
  keys: KeyVault
  settings: SettingsStore
  /** 沒給就載入內建的 ModelCard。 */
  models?: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 沒有開啟專案時，快速開始自動建立的專案放在這個資料夾裡。 */
  projectsDir: string
  /** 在檔案總管（Finder）裡顯示檔案；沒給就什麼都不做（測試用）。 */
  reveal?: (path: string) => void
  /** 畫布「上傳」的選檔視窗；沒給就當作取消（測試用）。 */
  pickFiles?: () => Promise<string[]>
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
}

export interface StudioApp {
  models: ModelRegistry
  settingsService: SettingsService
  runtime: ProjectRuntime
  shots: ShotService
  characters: CharacterService
  concepts: ConceptService
  turnarounds: TurnaroundService
  locations: LocationService
  outline: OutlineService
  storyboard: StoryboardService
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
}

/**
 * 把主行程的服務組起來：模型、設定、任務佇列、鏡頭、快速開始。
 * App 本體、E2E、單元測試與真實 API 冒煙腳本都用同一份組法，所以測到的就是實際會跑的。
 */
export function createStudioApp(options: StudioAppOptions): StudioApp {
  const { projects, keys, settings, broadcast, log } = options
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
  const shots = createShotService({
    projectsDir: options.projectsDir,
    projects,
    runtime,
    settings,
    settingsService,
    models,
    broadcast,
    log,
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
    runtime,
    settings,
    settingsService,
    models,
    shots,
    log,
    ...toolsOption,
  })
  const library = createProjectLibrary({
    projects,
    projectsDir: options.projectsDir,
    reveal: options.reveal ?? (() => undefined),
  })
  return {
    models,
    settingsService,
    runtime,
    shots,
    characters,
    concepts,
    turnarounds,
    locations,
    outline,
    storyboard,
    history: createHistoryService({ projects, broadcast }),
    quickstart,
    upgrade,
    graph: createGraphService({ projects, shots, models }),
    canvas: createCanvasService({
      projects,
      broadcast,
      shots,
      outline,
      characters,
      models,
      projectsDir: options.projectsDir,
      log,
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
