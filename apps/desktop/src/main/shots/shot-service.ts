import type { AssetUsage, ProjectHandle } from '@svs/db'
import {
  budgetExceededError,
  checkBudget,
  createRegistry,
  estimateWorkflowCost,
  hashValue,
  type EngineEvent,
  type NodeRegistry,
} from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  QUICK_STYLE_IDS,
  isAppError,
  type AssetRef,
  type CanvasFinalCut,
  type ModelTier,
  type NodeRun,
  type QuickStyleId,
  type RegenerateMode,
  type Shot,
  type ShotBatchCheck,
  type ShotBatchRequest,
  type ShotBatchStage,
  type ShotBatchResult,
  type ShotEdit,
  type ShotView,
  type StoryboardShot,
  type ShotsSnapshot,
  type Take,
  type TakeKind,
  type TakeView,
  type Workflow,
} from '@svs/schema'
import {
  STUDIO_SERVICE_KEY,
  ShotItemSchema,
  buildShotWorkflow,
  composeShotPrompts,
  registerQuickStartNodes,
  type ShotItem,
} from '@svs/workflows'
import { z } from 'zod'

import { ensureProject } from '../ensure-project'
import type { Logger } from '../logger'
import { assetRefOf, lockedAnchors, referenceEditModel } from '../characters/anchors'
import { lockedScenes } from '../locations/scene-anchors'
import { createProjectEngine } from '../project-engine'
import type { ProjectManager } from '../project-manager'
import { SHOT_NODE } from '../quickstart/progress-tracker'
import { createDraftCharacters } from '../quickstart/draft-characters'
import { sceneKey, shotKey } from '../canvas/projection'
import { currentFinal } from './current-final'
import { isAiCall } from '../history/ai-origin'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import { createStudioServices } from '../studio-services'

export interface ShotServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 找 FFmpeg（接片用）。預設到系統找。 */
  tools?: () => MediaTools | undefined
  /** 還沒有開啟專案時，新增鏡頭會自動建一個，放在這個資料夾（沒給就不自動建）。 */
  projectsDir?: string
  /**
   * 接片之後的聲音混音：有旁白、配樂或原聲設定就把它們混進接好的影片，回傳混好的成品與聲音指紋；
   * 沒有聲音要處理就回傳 undefined（成品就是接片的結果）。
   */
  mixSound?: (
    handle: ProjectHandle,
    joined: AssetRef,
    signal: AbortSignal,
  ) => Promise<{ asset: AssetRef; soundKey: string } | undefined>
  /** 現在的聲音指紋（沒有聲音要處理是 undefined）；跟成品記的不一樣，成品就是過期的。 */
  soundKeyNow?: (handle: ProjectHandle) => string | undefined
  now?: () => Date
}

/** 快速開始開始時告訴鏡頭服務的事：之後重新生成單一鏡頭要沿用同樣的畫風與比例。 */
export interface QuickStartContext {
  style: QuickStyleId
  aspectRatio: '16:9' | '9:16'
  /** 這次的「變化編號」，存在每個版本上，重新生成時從它往上加。 */
  variation: number
  models: { image: string; video: string }
  /** 拆出來的鏡頭怎麼放：replace＝整批換掉現有的鏡頭；append＝新增一個場放在最後面。 */
  mode?: 'replace' | 'append'
  /** 從哪個一句話節點生成的（節點鍵）：長出來的場連一條線到它。 */
  sourceKey?: string | undefined
}

/** 一個鏡頭現在的生成狀況（畫布用）。 */
export interface ShotLiveState {
  step?: 'prompt' | 'image' | 'video' | undefined
  error?: string | undefined
  /** 失敗在哪一步（第一張畫面或影片）：失敗要掛在那一格，即使它已經有舊的結果。 */
  failedStep?: 'image' | 'video' | undefined
}

/** 失敗的原因與失敗在哪一步。 */
interface ShotError {
  message: string
  step: 'image' | 'video'
}

/** 畫布要執行的一個鏡頭；redo 是直接按在已完成的影片（video）或圖（all）上，要重做的意思。 */
export interface ShotRunItem {
  shotId: string
  redo?: 'video' | 'all' | undefined
  /**
   * 明確要做哪一段（畫布 ▶ 旁的選單）：frame 只做第一張畫面、video 只做影片（要先有第一張畫面）、
   * all 圖和影片都做。明確指定的不看「需要重跑」、有結果的就是重做。
   */
  exact?: 'frame' | 'video' | 'all' | undefined
}

/** 一個鏡頭這次要做什麼：只補沒有的（apply），或重做影片、整個鏡頭。 */
export interface ShotRunEntry {
  shot: Shot
  mode: RegenerateMode
  /** 這次會重新做首幀圖／影片。 */
  image: boolean
  video: boolean
  redo: boolean
}

export interface ShotRunPlan {
  ok: boolean
  issue?: string
  /** 真的要做的鏡頭（已經都有結果的不在裡面）。 */
  entries: ShotRunEntry[]
  skippedBusy: number
  estimatedUsd: number
  estimateIsLowerBound: boolean
  demoMode: boolean
  models: { image?: string; video?: string }
}

export interface ShotService {
  list: () => ShotsSnapshot
  /** 每個鏡頭正在做哪一步、最近一次的失敗原因（只存在記憶體，畫布顯示執行中與失敗用）。 */
  live: () => ReadonlyMap<string, ShotLiveState>
  update: (shotId: string, edit: ShotEdit) => ShotView
  /** 新增一個空的鏡頭；有指定 afterShotId 就放在它後面，否則放最後。 */
  create: (input: { sceneId?: string | undefined; afterShotId?: string | undefined }) => ShotView
  /**
   * 複製一個鏡頭：描述、台詞、出場角色、地點、景別等欄位都帶過去，**不帶**版本（圖和影片是空的）。
   * 沒指定場就放在原鏡頭後面；指定了（整場複製）就放在那一場的最後。
   */
  duplicate: (shotId: string, options?: { sceneId?: string }) => ShotView
  /** 畫布上刪掉鏡頭的圖或影片：不再採用任何版本（版本還在生成紀錄裡，可以再採用）。 */
  clearAdopted: (shotId: string, kind: 'image' | 'video') => void
  /** 刪除鏡頭（連同它們的版本），剩下的重新編號。 */
  remove: (shotIds: readonly string[]) => ShotsSnapshot
  /** 依傳入的順序重新排列所有鏡頭，並重新編號。 */
  reorder: (orderedIds: readonly string[]) => ShotsSnapshot
  /** 把一批鏡頭放進同一個場（只廣播一次）。 */
  assignScene: (shotIds: readonly string[], sceneId?: string) => ShotsSnapshot
  /** 把一個鏡頭移到另一個場的最後面，鏡號依場的順序重排。 */
  moveToScene: (shotId: string, sceneId: string) => ShotsSnapshot
  /** 某個場目前有幾個鏡頭、其中幾個已經生成過畫面或影片。 */
  sceneShotCounts: (sceneId: string) => { existing: number; generated: number }
  /** 把某個場的鏡頭整批換成新的（AI 拆鏡頭用），放在合適的位置。 */
  replaceSceneShots: (sceneId: string, items: readonly StoryboardShot[]) => ShotsSnapshot
  /** 開始重新生成；預估超過上限、沒有模型等問題會直接丟出白話錯誤。 */
  regenerate: (shotId: string, mode: RegenerateMode) => Promise<void>
  cancel: (shotId: string) => void
  /** 批次生成前的檢查：略過哪些、整批預估花費。 */
  batchCheck: (request: ShotBatchRequest) => ShotBatchCheck
  /** 批次生成：每個鏡頭各自開始，某一鏡沒辦法開始（或失敗）不影響其他鏡。 */
  generateBatch: (request: ShotBatchRequest) => Promise<ShotBatchResult>
  /** 畫布執行前的檢查：每個鏡頭缺什麼、這次要做哪些步驟、整批預估花費。 */
  planRun: (items: readonly ShotRunItem[], quality?: ModelTier) => ShotRunPlan
  /** 畫布執行：照 planRun 算出來的做，某一鏡沒辦法開始不影響其他鏡。quality 是這次用哪一組模型。 */
  run: (
    items: readonly ShotRunItem[],
    quality?: ModelTier,
  ) => Promise<{ started: number; failed: { shotId: string; number: number; error: string }[] }>
  /**
   * 每個鏡頭的圖與影片是不是「需要重跑」：生成之後鏡頭的描述、Prompt、角色、已鎖定的角色卡或
   * 場景卡、畫風、比例（影片還有秒數與運鏡）改過了。沒記錄過輸入指紋的舊版本不算。
   */
  staleness: () => ReadonlyMap<string, { image: boolean; video: boolean }>
  /** 沒有任何鏡頭在重新生成時完成（已經閒置就馬上完成）。 */
  whenIdle: () => Promise<void>
  adopt: (takeId: string) => ShotView
  /**
   * 用一張上傳的圖當這一鏡的第一張畫面（畫布上把獨立圖片接到鏡頭）：記成一個「上傳」版本並採用，
   * 之後生成就不再生圖，直接用它生影片。傳 undefined 就拿掉接上來的圖，回到原本的版本（或自己生）。
   */
  setUploadedFrame: (shotId: string, assetHash: string | undefined) => void
  /** 這個鏡頭現在會用的生成流程（節點圖顯示用；沒選模型時模型欄位是空的占位）。 */
  flowOf: (shotId: string) => Workflow
  /** 用各鏡頭採用中的影片重新接成一支。 */
  rejoin: () => Promise<{ videoHash: string }>

  // ── 給快速開始用 ──
  /** 回傳「結束」函式：只會結束這一次（換專案後舊的收尾不會影響新專案）。 */
  beginQuickStart: (context: QuickStartContext) => () => void
  /** 快速開始的引擎事件：把拆出來的鏡頭、首幀圖、影片存進專案。 */
  record: (event: EngineEvent) => void
  finalVideoHash: () => string | undefined
  /** 最新接好的成品（存在專案裡），以及它跟現在要接進成品的影片對不對得上。 */
  finalCut: () => CanvasFinalCut | undefined
  /** 重新接片完成時通知（快速開始用它更新預覽）。 */
  onRejoined: (listener: (videoHash: string) => void) => () => void
}

/** 這次生成會更新的畫布格子：只生首幀圖是圖那一格，只生影片是影片那一格，整支鏡頭兩格都是。 */
export function generatedNodeKeys(shotId: string, mode: RegenerateMode): string[] {
  const image = `${shotKey(shotId)}:image`
  const video = `${shotKey(shotId)}:video`
  return mode === 'frame' ? [image] : mode === 'video' ? [video] : [image, video]
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

const BreakdownOutputSchema = z.object({
  title: z.string().optional(),
  shots: z.array(ShotItemSchema),
})
const ImageOutputSchema = z.object({ image: AssetRefSchema })
const VideoOutputSchema = z.object({ video: AssetRefSchema })

const isDone = (run: NodeRun): boolean => run.status === 'succeeded' || run.status === 'cached'

/** 接上來的圖（上傳的）當第一張畫面時，版本記的「模型」。 */
export const UPLOAD_MODEL = 'upload'
/** 接上來的圖的輸入指紋：就是那張圖。 */
const uploadFingerprint = (assetHash: string): string => hashValue({ upload: assetHash })
/** 這一鏡採用中的第一張畫面是不是接上來的圖。 */
const uploadedFrameOf = (handle: ProjectHandle, shotId: string): Take | undefined =>
  handle.repos.shots
    .listTakes(shotId, 'first_frame')
    .find((t) => t.adopted && t.modelId === UPLOAD_MODEL)

const toStyle = (id: string | undefined): QuickStyleId =>
  QUICK_STYLE_IDS.find((s) => s === id) ?? 'realistic'

/** 鏡頭 → 單鏡頭工作流的輸入。withOverride=false 用來算「自動組出的 Prompt」。 */
function toShotItem(shot: Shot, withOverride = true): ShotItem {
  return ShotItemSchema.parse({
    number: shot.number,
    description: shot.description,
    size: shot.size,
    angle: shot.angle,
    cameraMove: shot.cameraMove,
    durationSec: shot.durationSec,
    characters: shot.characters.flatMap((c) => (c.name ? [c.name] : [])),
    mood: shot.mood ?? '',
    ...(shot.locationId ? { locationId: shot.locationId } : {}),
    ...(withOverride && shot.prompt ? { promptOverride: shot.prompt } : {}),
  })
}

const toTakeView = (take: Take, usage?: AssetUsage): TakeView => ({
  id: take.id,
  kind: take.kind,
  version: take.version,
  assetHash: take.assetHash,
  adopted: take.adopted,
  modelId: take.modelId,
  ...(take.seed === undefined ? {} : { seed: take.seed }),
  createdAt: take.createdAt,
  ...(usage
    ? {
        durationMs: usage.durationMs,
        ...(usage.costUsd === undefined
          ? {}
          : { costUsd: usage.costUsd, costEstimated: usage.costEstimated ?? false }),
        ...(usage.letterboxTrimmed === true ? { letterboxTrimmed: true } : {}),
      }
    : {}),
})

/** 一次重新生成要用的「變化編號」：沒要換的部分沿用目前採用的版本，要換的就取最大值加一。 */
export function nextVariations(
  mode: RegenerateMode,
  frames: readonly Take[],
  videos: readonly Take[],
): { imageVariation: number; videoVariation: number } {
  const seedOf = (take: Take | undefined): number => take?.seed ?? 0
  const adopted = (takes: readonly Take[]): Take | undefined => takes.find((t) => t.adopted)
  const next = (takes: readonly Take[]): number => Math.max(-1, ...takes.map(seedOf)) + 1
  switch (mode) {
    case 'apply':
      return {
        imageVariation: seedOf(adopted(frames)),
        videoVariation: seedOf(adopted(videos)),
      }
    case 'video':
      return { imageVariation: seedOf(adopted(frames)), videoVariation: next(videos) }
    case 'all':
      return { imageVariation: next(frames), videoVariation: next(videos) }
    case 'frame':
      return { imageVariation: next(frames), videoVariation: seedOf(adopted(videos)) }
  }
}

interface Session {
  handle: ProjectHandle
  /** 正在重新生成的鏡頭。 */
  regens: Map<string, AbortController>
  /** 鏡頭目前進行的步驟（只存在記憶體）。 */
  activity: Map<string, 'prompt' | 'image' | 'video'>
  /** 最近一次失敗的原因。 */
  errors: Map<string, ShotError>
  /** 快速開始進行中（這段期間鏡頭會被整批取代，不能重新生成單一鏡頭）。 */
  quick?: QuickStartContext | undefined
  /** 快速開始的第幾個鏡頭 → 鏡頭 id。 */
  quickShotIds: string[]
}

/**
 * 鏡頭與版本：把快速開始的結果存進專案資料庫，讓使用者逐鏡修改、重新生成、
 * 切換版本，最後重新接片。每個專案各有一份狀態；換專案時取消進行中的重新生成。
 */
/** 專案裡一個場都沒有時，替新增的鏡頭先建一個場（沒有幕就連幕一起建），回傳場的 id。 */
function newScene(outline: ProjectHandle['repos']['outline']): string {
  const act = outline.listActs().at(-1) ?? outline.addAct({ title: `第 ${String(1)} 幕` })
  return outline.addScene(act.id, { title: '新的場' }).id
}

export function createShotService(deps: ShotServiceDeps): ShotService {
  const { projects, runtime, settings, settingsService, models, broadcast, log } = deps
  const tools = deps.tools ?? findTools
  const registry: NodeRegistry = createRegistry()
  registerQuickStartNodes(registry)
  const rejoinListeners = new Set<(videoHash: string) => void>()
  /** 等所有重新生成結束的人（畫布「剪輯 ▶」生成完要接片）。 */
  let idleWaiters: (() => void)[] = []
  const releaseIdle = (s: Session): void => {
    if (s.regens.size > 0) return
    const waiting = idleWaiters
    idleWaiters = []
    for (const resolve of waiting) resolve()
  }

  let session: Session | undefined

  const open = (handle: ProjectHandle | undefined): void => {
    if (session && session.handle === handle) return
    for (const controller of session?.regens.values() ?? []) controller.abort()
    session = handle
      ? { handle, regens: new Map(), activity: new Map(), errors: new Map(), quickShotIds: [] }
      : undefined
  }
  open(projects.current())

  const need = (): Session => {
    const current = session
    if (!current || current.handle.closed) throw invalid('請先開啟或建立一個專案。')
    return current
  }

  const styleOf = (handle: ProjectHandle): QuickStyleId =>
    toStyle(handle.repos.projects.get().defaultStyleId)

  const view = (s: Session, shot: Shot): ShotView => {
    const { shots } = s.handle.repos
    const takes = shots.listTakes(shot.id)
    const step = s.activity.get(shot.id)
    const error = s.errors.get(shot.id)?.message
    const anchors = lockedAnchors(s.handle)
    const auto = composeShotPrompts(
      toShotItem(shot, false),
      styleOf(s.handle),
      anchors,
      lockedScenes(s.handle),
    ).videoPrompt
    const usage = s.handle.repos.jobs.usageByAsset(takes.map((t) => t.assetHash))
    const withUsage = (take: Take): TakeView => toTakeView(take, usage.get(take.assetHash))
    const names = shot.characters.flatMap((c) => (c.name ? [c.name] : []))
    const lockedCharacters = anchors.flatMap((a) =>
      a.version !== undefined && names.includes(a.name)
        ? [{ name: a.name, version: a.version }]
        : [],
    )
    return {
      id: shot.id,
      number: shot.number,
      description: shot.description,
      cameraMove: shot.cameraMove,
      durationSec: shot.durationSec,
      characters: names,
      size: shot.size,
      angle: shot.angle,
      dialogue: shot.dialogue,
      ...(shot.sceneId ? { sceneId: shot.sceneId } : {}),
      ...(shot.locationId ? { locationId: shot.locationId } : {}),
      ...(shot.lighting ? { lighting: shot.lighting } : {}),
      ...(shot.timeOfDay ? { timeOfDay: shot.timeOfDay } : {}),
      ...(shot.mood ? { mood: shot.mood } : {}),
      ...(lockedCharacters.length > 0 ? { lockedCharacters } : {}),
      ...(shot.prompt ? { prompt: shot.prompt } : {}),
      ...(shot.inCut ? {} : { inCut: false }),
      autoPrompt: auto,
      status: step ? 'generating' : shot.status,
      ...(step ? { activity: { step } } : {}),
      ...(error ? { error } : {}),
      firstFrames: takes.filter((t) => t.kind === 'first_frame').map(withUsage),
      videos: takes.filter((t) => t.kind === 'video').map(withUsage),
    }
  }

  /** 會接進成品的鏡頭（放進成品的，照鏡號）與它們目前採用的影片版本；還沒有影片的是 undefined。 */
  const cutTakes = (handle: ProjectHandle) =>
    handle.repos.shots
      .list()
      .filter((shot) => shot.inCut)
      .map((shot) => ({
        shot,
        take: handle.repos.shots.listTakes(shot.id, 'video').find((t) => t.adopted),
      }))

  /** 存下一個新的成品版本，記住用了哪些影片版本（之後判斷成品是不是對不上）。 */
  const recordFinal = (
    handle: ProjectHandle,
    hash: string,
    takeIds: readonly string[],
    sound?: { baseAssetHash: string; soundKey: string },
  ): void => {
    handle.repos.finalCuts.record({
      assetHash: hash,
      durationSec: handle.assets.getMeta(hash)?.durationSec,
      takeIds,
      baseAssetHash: sound?.baseAssetHash,
      soundKey: sound?.soundKey,
    })
  }

  const finalCutOf = (handle: ProjectHandle): CanvasFinalCut | undefined => {
    const current = currentFinal(handle, deps.soundKeyNow?.(handle))
    if (!current) return undefined
    const { cut, stale } = current
    return {
      version: cut.version,
      assetHash: cut.assetHash,
      ...(cut.durationSec === undefined ? {} : { durationSec: cut.durationSec }),
      createdAt: cut.createdAt,
      stale: stale !== false,
      ...(stale === false ? {} : { staleReason: stale }),
    }
  }
  const finalOf = (handle: ProjectHandle): { finalVideoHash?: string } => {
    const hash = currentFinal(handle, deps.soundKeyNow?.(handle))?.cut.assetHash
    return hash === undefined ? {} : { finalVideoHash: hash }
  }

  const snapshot = (): ShotsSnapshot => {
    if (!session || session.handle.closed) return { shots: [] }
    const s = session
    return {
      shots: s.handle.repos.shots.list().map((shot) => view(s, shot)),
      ...finalOf(s.handle),
    }
  }

  const changed = (s: Session): void => {
    if (s === session && !s.handle.closed) broadcast('shots.changed', snapshot())
  }

  // 開了、關了或換了專案：畫面上的鏡頭清單要跟著換
  projects.onChange((handle) => {
    open(handle)
    broadcast('shots.changed', snapshot())
  })

  /**
   * 鏡頭目前的「輸入指紋」：會影響生出來的圖與影片的東西（描述、Prompt、角色、已鎖定的卡、畫風、比例…）。
   * 影片的指紋多了秒數與運鏡。鏡號、放不放進成品這類不影響畫面的不算。
   */
  /** 算指紋要查的專案資料（畫風、比例、已鎖定的角色卡與場景卡）；一次查好，每個鏡頭共用。 */
  const fingerprintContext = (handle: ProjectHandle) => {
    const project = handle.repos.projects.get()
    return {
      style: toStyle(project.defaultStyleId),
      aspectRatio: project.aspectRatio,
      anchors: lockedAnchors(handle),
      scenes: lockedScenes(handle),
    }
  }

  const fingerprintsOf = (
    handle: ProjectHandle,
    shot: Shot,
    context: ReturnType<typeof fingerprintContext> = fingerprintContext(handle),
  ): { image: string; video: string } => {
    const full = toShotItem(shot)
    // 鏡號、地點 id 不影響畫面（地點的影響看已鎖定的場景卡）；秒數與運鏡只影響影片
    const item = {
      description: full.description,
      size: full.size,
      angle: full.angle,
      characters: full.characters,
      mood: full.mood,
      promptOverride: full.promptOverride,
    }
    const { cameraMove, durationSec } = full
    // 接了上傳的圖：第一張畫面就是那張圖（換一張，影片就要重跑）
    const uploaded = uploadedFrameOf(handle, shot.id)
    const image = uploaded
      ? uploadFingerprint(uploaded.assetHash)
      : hashValue({
          item,
          style: context.style,
          aspectRatio: context.aspectRatio,
          anchors: context.anchors.filter((a) => item.characters.includes(a.name)),
          scenes: context.scenes.filter((x) => x.id === shot.locationId),
        })
    return { image, video: hashValue({ image, cameraMove, durationSec }) }
  }

  /** 存一個版本；同一鏡頭同一種類已經有相同檔案就沿用，不會重複建立。 */
  const saveTake = (
    s: Session,
    shotId: string,
    kind: TakeKind,
    asset: AssetRef,
    meta: { modelId: string; seed: number; nodeRun: NodeRun; inputHash: string },
  ): Take => {
    const { shots } = s.handle.repos
    const existing = shots.listTakes(shotId, kind).find((t) => t.assetHash === asset.hash)
    if (existing) {
      // 輸入改了但生出一樣的檔案：這個版本現在對得上目前的輸入了
      if (existing.inputHash !== meta.inputHash) shots.setTakeInputHash(existing.id, meta.inputHash)
      return existing
    }
    return shots.addTake({
      shotId,
      kind,
      assetHash: asset.hash,
      modelId: meta.modelId,
      seed: meta.seed,
      runId: meta.nodeRun.runId,
      nodeRunId: meta.nodeRun.id,
      inputHash: meta.inputHash,
    })
  }

  /** 現在做到哪一步就是失敗在哪一步（整理 Prompt 算第一張畫面那一步）。 */
  const failedStepOf = (s: Session, shotId: string): 'image' | 'video' =>
    s.activity.get(shotId) === 'video' ? 'video' : 'image'

  const failShot = (s: Session, shotId: string, run: NodeRun): void => {
    const shot = s.handle.repos.shots.get(shotId)
    if (!shot) return
    s.errors.set(shotId, {
      message: run.error?.userMessage ?? '這個步驟沒有成功。',
      step: failedStepOf(s, shotId),
    })
    s.handle.repos.shots.update(shotId, { status: shot.activeTakeId ? 'done' : 'failed' })
  }

  // ── 重新生成單一鏡頭 ──

  /** 單鏡頭工作流的引擎事件（節點編號是 prompt / image / video，沒有 each[n]/ 前綴）。 */
  const recordRegen = (
    s: Session,
    shotId: string,
    ctx: {
      models: { image: string; video: string }
      imageVariation: number
      videoVariation: number
      /** 開始生成當下鏡頭的輸入指紋（生成中使用者又改了，結果就算過期）。 */
      fingerprint: { image: string; video: string }
      /** 第一張畫面是接上來的圖：「image」節點只是把它交出去，不是新的版本。 */
      fixedFrame?: boolean
    },
    event: EngineEvent,
  ): void => {
    if (s.handle.closed) return
    if (event.type === 'node-started') {
      if (event.nodeId === 'prompt' || event.nodeId === 'image' || event.nodeId === 'video') {
        s.activity.set(shotId, event.nodeId)
        s.errors.delete(shotId)
        changed(s)
      }
      return
    }
    if (event.type !== 'node-finished') return
    const { shots } = s.handle.repos
    if (event.nodeId === 'image' && isDone(event.nodeRun) && ctx.fixedFrame !== true) {
      const out = ImageOutputSchema.safeParse(event.nodeRun.output)
      if (out.success) {
        const take = saveTake(s, shotId, 'first_frame', out.data.image, {
          modelId: ctx.models.image,
          seed: ctx.imageVariation,
          nodeRun: event.nodeRun,
          inputHash: ctx.fingerprint.image,
        })
        shots.adoptTake(take.id)
        changed(s)
      }
    } else if (event.nodeId === 'video' && isDone(event.nodeRun)) {
      const out = VideoOutputSchema.safeParse(event.nodeRun.output)
      if (out.success) {
        const take = saveTake(s, shotId, 'video', out.data.video, {
          modelId: ctx.models.video,
          seed: ctx.videoVariation,
          nodeRun: event.nodeRun,
          inputHash: ctx.fingerprint.video,
        })
        shots.adoptTake(take.id)
        shots.update(shotId, { status: 'done' })
        s.errors.delete(shotId)
        changed(s)
      }
    } else if (
      (event.nodeId === 'image' || event.nodeId === 'video') &&
      event.nodeRun.status === 'failed'
    ) {
      failShot(s, shotId, event.nodeRun)
      changed(s)
    }
  }

  // ── 快速開始的引擎事件 ──

  /** 拆出來的一個鏡頭 → 建立鏡頭用的欄位。 */
  const toNewShot = (item: ShotItem) => ({
    description: item.description,
    size: item.size,
    angle: item.angle,
    cameraMove: item.cameraMove,
    durationSec: item.durationSec,
    characters: item.characters.map((name) => ({ name })),
    ...(item.mood ? { mood: item.mood } : {}),
    // 一句話勾了旁白時，拆鏡寫的旁白台詞
    ...(item.dialogue ? { dialogue: item.dialogue } : {}),
  })

  /**
   * 畫布的一句話生成：把拆出來的鏡頭放進一個新的場（接在最後一幕，還沒有幕就先建一幕）。
   * mode 是 replace（「取代全部」）時先清掉現有的鏡頭與大綱，也清掉從這個節點出發的舊連線。
   * 最後連一條線從一句話節點到新的場。
   */
  const placeInOutline = (
    s: Session,
    quick: QuickStartContext,
    breakdown: z.infer<typeof BreakdownOutputSchema>,
  ): void => {
    const { shots, outline, canvas } = s.handle.repos
    if (quick.mode !== 'append') {
      for (const old of shots.list()) shots.delete(old.id)
      for (const act of outline.listActs()) outline.deleteAct(act.id)
      if (quick.sourceKey !== undefined) canvas.removeEdgesFrom(quick.sourceKey)
      s.activity.clear()
      s.errors.clear()
    }
    const named = breakdown.title?.trim()
    const title = named === undefined || named === '' ? '新的故事' : named
    const act = outline.listActs().at(-1) ?? outline.addAct({ title })
    const scene = outline.addScene(act.id, { title })
    s.quickShotIds = breakdown.shots.map(
      (item) => shots.create({ ...toNewShot(item), sceneId: scene.id }).id,
    )
    if (quick.sourceKey !== undefined) {
      canvas.addEdge({
        sourceKey: quick.sourceKey,
        sourcePort: 'story-out',
        targetKey: sceneKey(scene.id),
        targetPort: 'scene-story',
        kind: 'data',
      })
    }
  }

  const recordQuick = (s: Session, quick: QuickStartContext, event: EngineEvent): void => {
    const { shots } = s.handle.repos
    // 從畫布的一句話生成：鏡頭放進新的場，不是整批換掉
    const onCanvas = quick.mode === 'append' || quick.sourceKey !== undefined
    switch (event.type) {
      case 'node-started': {
        const match = SHOT_NODE.exec(event.nodeId)
        const shotId = s.quickShotIds[Number(match?.[1])]
        if (match && shotId) {
          s.activity.set(shotId, match[2] as 'prompt' | 'image' | 'video')
          changed(s)
        }
        return
      }
      case 'node-finished': {
        const { nodeId, nodeRun } = event
        if (nodeId === 'breakdown') {
          const out = isDone(nodeRun) ? BreakdownOutputSchema.safeParse(nodeRun.output) : undefined
          if (!out?.success) return
          if (onCanvas) {
            placeInOutline(s, quick, out.data)
            changed(s)
            return
          }
          // 重新拆鏡頭就整批換掉（畫面上的確認視窗已經提醒過）
          for (const old of shots.list()) shots.delete(old.id)
          s.activity.clear()
          s.errors.clear()
          s.quickShotIds = out.data.shots.map(
            (item) =>
              shots.create({
                ...toNewShot(item),
              }).id,
          )
          changed(s)
          return
        }
        if (nodeId === 'join') {
          const out = isDone(nodeRun) ? VideoOutputSchema.safeParse(nodeRun.output) : undefined
          if (out?.success) {
            // 這次生成接的是這一批鏡頭（新增成一場時只有新的那一場）
            const takeIds = s.quickShotIds.flatMap((id) => {
              const take = shots.listTakes(id, 'video').find((t) => t.adopted)
              return take ? [take.id] : []
            })
            recordFinal(s.handle, out.data.video.hash, takeIds)
            changed(s)
          }
          return
        }
        const match = SHOT_NODE.exec(nodeId)
        const shotId = s.quickShotIds[Number(match?.[1])]
        if (!match || !shotId) return
        const kind = match[2]
        if (kind === 'prompt') return
        if (!isDone(nodeRun)) {
          if (nodeRun.status === 'failed') {
            s.activity.delete(shotId)
            failShot(s, shotId, nodeRun)
            changed(s)
          }
          return
        }
        const current = s.handle.repos.shots.get(shotId)
        if (!current) return
        const fingerprint = fingerprintsOf(s.handle, current)
        const meta = (modelId: string, inputHash: string) => ({
          modelId,
          seed: quick.variation,
          nodeRun,
          inputHash,
        })
        if (kind === 'image') {
          const out = ImageOutputSchema.safeParse(nodeRun.output)
          if (out.success) {
            saveTake(
              s,
              shotId,
              'first_frame',
              out.data.image,
              meta(quick.models.image, fingerprint.image),
            )
            changed(s)
          }
        } else {
          const out = VideoOutputSchema.safeParse(nodeRun.output)
          if (out.success) {
            saveTake(
              s,
              shotId,
              'video',
              out.data.video,
              meta(quick.models.video, fingerprint.video),
            )
            shots.update(shotId, { status: 'done' })
            s.activity.delete(shotId)
            changed(s)
          }
        }
        return
      }
      case 'run-finished':
        s.activity.clear()
        // 畫布生成的影片：替新出場的角色建草稿角色卡（跟「升級成專案」做一樣的事）
        if (onCanvas && event.status === 'succeeded') {
          createDraftCharacters(s.handle)
        }
        changed(s)
        return
      case 'run-started':
      case 'budget-exceeded':
      case 'cost-recorded':
        return
    }
  }

  // ── 重新生成／批次生成 ──

  /** 單一鏡頭的標準工作流（寫畫面描述 → 首幀圖 → 影片），連同這次生成要記錄的模型與變化編號。 */
  const flowFor = (
    handle: ProjectHandle,
    shot: Shot,
    mode: RegenerateMode,
    picked: { image: string; video: string },
  ) => {
    const project = handle.repos.projects.get()
    const variations = nextVariations(
      mode,
      handle.repos.shots.listTakes(shot.id, 'first_frame'),
      handle.repos.shots.listTakes(shot.id, 'video'),
    )
    const anchors = lockedAnchors(handle)
    const scenes = lockedScenes(handle)
    const editModel = referenceEditModel(anchors, settingsService, models, scenes)
    const uploaded = uploadedFrameOf(handle, shot.id)
    const firstFrame = uploaded ? assetRefOf(handle, uploaded.assetHash) : undefined
    const full = buildShotWorkflow({
      style: toStyle(project.defaultStyleId),
      durationSec: shot.durationSec,
      aspectRatio: project.aspectRatio,
      // 影片要不要帶原聲：專案的聲音設定（預設開）
      audio: handle.repos.sound.getSettings().nativeAudio,
      models: picked,
      anchors,
      scenes,
      ...(editModel ? { editModel } : {}),
      ...(firstFrame ? { firstFrame } : {}),
      ...variations,
    })
    // 只生成首幀圖：拿掉影片節點，輸出改成首幀圖（花費預估與執行都不含影片）
    const flow =
      mode === 'frame'
        ? {
            ...full,
            nodes: full.nodes.filter((n) => n.id !== 'video'),
            edges: [
              ...full.edges.filter((e) => e.from.nodeId !== 'video' && e.to.nodeId !== 'video'),
              {
                id: 'b5',
                from: { nodeId: 'image', port: 'image' },
                to: { nodeId: 'out', port: 'value' },
              },
            ],
          }
        : full
    return {
      flow,
      ctx: {
        models: picked,
        ...variations,
        fingerprint: fingerprintsOf(handle, shot),
        fixedFrame: firstFrame !== undefined,
      },
    }
  }

  /** 現在會用的圖片、影片模型與名稱（沒設定就是 undefined）。 */
  const modelInfo = (quality?: ModelTier) => {
    const { demoMode, budget } = settings.get()
    const image = settingsService.resolveModel('t2i', quality)
    const video = settingsService.resolveModel('i2v', quality)
    const nameOf = (id: string | undefined): string | undefined =>
      id ? (models.get(id)?.displayName ?? id) : undefined
    const imageName = nameOf(image)
    const videoName = nameOf(video)
    return {
      demoMode,
      budget,
      image,
      video,
      names: {
        ...(imageName ? { image: imageName } : {}),
        ...(videoName ? { video: videoName } : {}),
      },
    }
  }

  /** 哪些鏡頭的圖、影片需要重跑（採用中的版本記的輸入指紋跟鏡頭現在的對不上）。 */
  const staleOf = (s: Session): Map<string, { image: boolean; video: boolean }> => {
    const { shots } = s.handle.repos
    const stale = new Map<string, { image: boolean; video: boolean }>()
    const context = fingerprintContext(s.handle)
    // 一次讀出所有採用中的版本（一鏡一鏡查要好幾百次查詢，250 鏡時畫布要多等一百多毫秒）
    const adoptedOf = new Map<string, Take>()
    for (const take of shots.adoptedTakes()) adoptedOf.set(`${take.shotId}:${take.kind}`, take)
    for (const shot of shots.list()) {
      const frame = adoptedOf.get(`${shot.id}:first_frame`)
      const video = adoptedOf.get(`${shot.id}:video`)
      if (!frame && !video) continue
      const now = fingerprintsOf(s.handle, shot, context)
      const image = frame?.inputHash !== undefined && frame.inputHash !== now.image
      const clip =
        video !== undefined &&
        ((video.inputHash !== undefined && video.inputHash !== now.video) || image)
      if (image || clip) stale.set(shot.id, { image, video: clip })
    }
    return stale
  }

  /**
   * 畫布執行前的檢查：每個鏡頭已經有首幀圖、影片就不重做，缺哪個補哪個；
   * 直接按在已完成的影片或圖上（redo）才會重做。花費只算這次真的會做的步驟。
   */
  const checkRun = (
    s: Session,
    items: readonly ShotRunItem[],
    quality?: ModelTier,
  ): ShotRunPlan => {
    const { handle } = s
    const { shots } = handle.repos
    const wanted = new Map(items.map((item) => [item.shotId, item]))
    const entries: ShotRunEntry[] = []
    /** 明確要「只跑影片」、但還沒有第一張畫面的鏡頭（還不能跑）。 */
    const blocked: number[] = []
    let skippedBusy = 0
    const staleNow = staleOf(s)
    for (const shot of shots.list()) {
      const item = wanted.get(shot.id)
      if (!item) continue
      if (s.regens.has(shot.id)) {
        skippedBusy++
        continue
      }
      const hasFrame = shots.listTakes(shot.id, 'first_frame').some((t) => t.adopted)
      const hasVideo = shots.listTakes(shot.id, 'video').some((t) => t.adopted)
      const stale = staleNow.get(shot.id)
      if (item.exact) {
        if (item.exact === 'frame') {
          entries.push({ shot, mode: 'frame', image: true, video: false, redo: hasFrame })
        } else if (item.exact === 'video') {
          if (!hasFrame) {
            blocked.push(shot.number)
            continue
          }
          entries.push({ shot, mode: 'video', image: false, video: true, redo: hasVideo })
        } else {
          entries.push({
            shot,
            mode: 'all',
            image: true,
            video: true,
            redo: hasFrame || hasVideo,
          })
        }
        continue
      }
      // 按在「需要重跑」的節點上就是補跑它（不用再多做一次重做）
      const redo =
        item.redo === 'all' ? !stale?.image : item.redo === 'video' ? !stale?.video : false
      if (redo && item.redo === 'all') {
        entries.push({ shot, mode: 'all', image: true, video: true, redo: true })
      } else if (redo && item.redo === 'video' && hasFrame) {
        entries.push({ shot, mode: 'video', image: false, video: true, redo: true })
      } else {
        // 缺的要補；生成之後上游改過的（需要重跑）也要重做，它下游的影片跟著重做
        const image = !hasFrame || stale?.image === true
        const video = image || !hasVideo || stale?.video === true
        if (image || video) entries.push({ shot, mode: 'apply', image, video, redo: false })
      }
    }
    const { demoMode, budget, image, video, names } = modelInfo(quality)
    const base = { entries, skippedBusy, demoMode, models: names }
    const fail = (issue: string, estimatedUsd = 0, estimateIsLowerBound = false): ShotRunPlan => ({
      ...base,
      ok: false,
      issue,
      estimatedUsd,
      estimateIsLowerBound,
    })
    if (s.quick) return fail('整支影片正在生成，等它完成再執行。')
    if (blocked.length > 0) {
      return fail('還不能跑：先要有第一張畫面。先做第一張畫面，或選「整條」。')
    }
    if (entries.length === 0) {
      return skippedBusy > 0
        ? fail('這些鏡頭都正在生成中。')
        : { ...base, ok: true, estimatedUsd: 0, estimateIsLowerBound: false }
    }
    if (!image || !video) {
      return fail('還沒有可用的圖片或影片模型：請到設定填入 fal.ai 的服務金鑰（或打開示範模式）。')
    }
    let estimatedUsd = 0
    let lowerBound = false
    for (const entry of entries) {
      const { flow } = flowFor(handle, entry.shot, entry.mode, { image, video })
      const estimate = estimateWorkflowCost(flow, registry, {
        priceLookup: (id, usage) => models.estimate(id, usage),
      })
      const steps = [...(entry.image ? ['prompt', 'image'] : []), ...(entry.video ? ['video'] : [])]
      estimatedUsd += steps.reduce((sum, id) => sum + (estimate.byNode[id] ?? 0), 0)
      lowerBound ||= estimate.uncertainNodeIds.some((id) => steps.includes(id))
    }
    const exceeded = checkBudget({
      budget,
      runProjectedUsd: estimatedUsd,
      projectBaseUsd: handle.repos.costs.totalUsd(handle.projectId),
    })
    if (exceeded) return fail(budgetExceededError(exceeded).userMessage, estimatedUsd, lowerBound)
    return { ...base, ok: true, estimatedUsd, estimateIsLowerBound: lowerBound }
  }

  /** 批次生成這一步每個鏡頭要用的重新生成方式：只生首幀→frame；只生影片→已有影片換新的、沒有就補；全做→all。 */
  const batchModeOf = (
    handle: ProjectHandle,
    shot: Shot,
    stage: ShotBatchStage,
  ): RegenerateMode => {
    if (stage === 'frame') return 'frame'
    if (stage === 'video') {
      return handle.repos.shots.listTakes(shot.id, 'video').length > 0 ? 'video' : 'apply'
    }
    return 'all'
  }

  /** 批次生成：分出「真的要做」「已經生成過」「正在生成」，並加總預估花費。 */
  const checkBatch = (
    s: Session,
    request: ShotBatchRequest,
  ): { check: ShotBatchCheck; toRun: Shot[] } => {
    const { handle } = s
    const { shots } = handle.repos
    const stage = request.stage ?? 'full'
    const wanted = new Set(request.shotIds)
    const picked = shots.list().filter((shot) => wanted.has(shot.id))
    const hasFrame = (shot: Shot): boolean =>
      shots.listTakes(shot.id, 'first_frame').some((t) => t.adopted)
    const hasVideo = (shot: Shot): boolean => shots.listTakes(shot.id, 'video').length > 0
    let skippedBusy = 0
    let skippedGenerated = 0
    let skippedNoFrame = 0
    const toRun: Shot[] = []
    for (const shot of picked) {
      if (s.regens.has(shot.id)) skippedBusy++
      else if (request.skipGenerated && (stage === 'frame' ? hasFrame(shot) : hasVideo(shot)))
        skippedGenerated++
      else if (stage === 'video' && !hasFrame(shot)) skippedNoFrame++
      else toRun.push(shot)
    }
    const quality = request.draft === true ? 'budget' : undefined
    const { demoMode, budget, image, video, names } = modelInfo(quality)
    const base = {
      willGenerate: toRun.length,
      skippedGenerated,
      skippedBusy,
      skippedNoFrame,
      demoMode,
      models: names,
    }
    const fail = (issue: string, estimatedUsd = 0, estimateIsLowerBound = false) => ({
      check: { ...base, ok: false, issue, estimatedUsd, estimateIsLowerBound },
      toRun,
    })

    if (picked.length === 0) return fail('找不到選取的鏡頭。')
    if (s.quick) return fail('整支影片正在生成，等它完成再生成鏡頭。')
    // 只生首幀圖不需要影片模型
    if (!image || (stage !== 'frame' && !video)) {
      return fail(
        stage === 'frame'
          ? '還沒有可用的圖片模型：請到設定填入服務金鑰（或打開示範模式）。'
          : '還沒有可用的圖片或影片模型：請到設定填入 fal.ai 的服務金鑰（或打開示範模式）。',
      )
    }
    if (toRun.length === 0) {
      if (skippedNoFrame > 0 && skippedGenerated === 0 && skippedBusy === 0) {
        return fail('選取的鏡頭都還沒有首幀圖：請先生成首幀圖。')
      }
      return fail(
        skippedBusy > 0 && skippedGenerated === 0
          ? '選取的鏡頭都正在生成中。'
          : stage === 'frame'
            ? '選取的鏡頭都已經有首幀圖了。要重做的話，請取消「略過已生成的」。'
            : '選取的鏡頭都已經生成過了。要重做的話，請取消「略過已生成的」。',
      )
    }

    let estimatedUsd = 0
    let lowerBound = false
    for (const shot of toRun) {
      const mode = batchModeOf(handle, shot, stage)
      const { flow } = flowFor(handle, shot, mode, { image, video: video ?? image })
      const estimate = estimateWorkflowCost(flow, registry, {
        priceLookup: (id, usage) => models.estimate(id, usage),
      })
      // 只生影片：首幀與提示會從快取拿，不重複花錢
      const steps =
        stage === 'full' ? undefined : stage === 'frame' ? ['prompt', 'image'] : ['video']
      estimatedUsd +=
        steps === undefined
          ? estimate.totalUsd
          : steps.reduce((sum, id) => sum + (estimate.byNode[id] ?? 0), 0)
      lowerBound ||= estimate.uncertainNodeIds.some(
        (id) => steps === undefined || steps.includes(id),
      )
    }
    // 整批是使用者一次按下去的，合起來不能超過單次花費上限
    const exceeded = checkBudget({
      budget,
      runProjectedUsd: estimatedUsd,
      projectBaseUsd: handle.repos.costs.totalUsd(handle.projectId),
    })
    if (exceeded) return fail(budgetExceededError(exceeded).userMessage, estimatedUsd, lowerBound)
    return {
      check: { ...base, ok: true, estimatedUsd, estimateIsLowerBound: lowerBound },
      toRun,
    }
  }

  async function launch(
    s: Session,
    shot: Shot,
    mode: RegenerateMode,
    quality?: ModelTier,
  ): Promise<void> {
    const { handle } = s
    const shotId = shot.id
    // 誰叫的：AI 工具（MCP）進來的呼叫才標「AI 剛改」；使用者自己按 ▶ 的不標。
    // 這裡還在呼叫的同一串非同步裡，所以現在看得到；等背景做完才問就來不及了
    const fromAi = isAiCall()
    if (s.quick) throw invalid('整支影片正在生成，等它完成再重新生成單一鏡頭。')
    if (s.regens.has(shotId)) throw invalid('這個鏡頭正在重新生成。')

    const image = settingsService.resolveModel('t2i', quality)
    // 只生首幀圖不需要影片模型
    const video = mode === 'frame' ? image : settingsService.resolveModel('i2v', quality)
    if (!image || !video) {
      throw invalid(
        '還沒有可用的圖片或影片模型：請到設定填入 fal.ai 的服務金鑰（或打開示範模式）。',
      )
    }
    const queue = runtime.queue()
    const tool = tools()
    if (!queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '生成服務還沒準備好，請重新啟動 App。',
      })
    }

    const { flow, ctx } = flowFor(handle, shot, mode, { image, video })

    const controller = new AbortController()
    s.regens.set(shotId, controller)
    // 按下去就先顯示「進行中」，不用等第一個節點開始
    s.activity.set(shotId, 'prompt')
    s.errors.delete(shotId)
    changed(s)
    const progress = { started: false }
    const engine = createProjectEngine(
      handle,
      {
        registry,
        services: {
          [STUDIO_SERVICE_KEY]: createStudioServices({ queue, handle, tools: tool, models }),
        },
        priceLookup: (id, usage) => models.estimate(id, usage),
        onEvent: (event) => {
          if (event.type === 'run-started') progress.started = true
          recordRegen(s, shotId, ctx, event)
        },
      },
      // 生成佇列裡這一鏡的任務標「第 N 鏡」
      { stepLabel: `第 ${String(shot.number)} 鏡` },
    )
    const running = engine
      .run(flow, {
        projectId: handle.projectId,
        signal: controller.signal,
        inputs: { item: toShotItem(shot) },
        budget: settings.get().budget,
      })
      .catch((error: unknown) => {
        if (!handle.closed && !controller.signal.aborted) {
          s.errors.set(shotId, {
            message: isAppError(error) ? error.userMessage : '重新生成失敗，請再試一次。',
            step: failedStepOf(s, shotId),
          })
          if (!isAppError(error)) log.error(`重新生成發生未預期錯誤：${String(error)}`)
        }
        throw error
      })
      .finally(() => {
        s.regens.delete(shotId)
        s.activity.delete(shotId)
        changed(s)
        releaseIdle(s)
      })
      .then((result) => {
        // AI 叫的生成在背景做完了（成功才通知）：告訴畫面哪些格子有新結果。
        // 節點失敗時 engine.run 不會丟錯，是正常回傳、run.status 是 'failed'，所以要看狀態：
        // 失敗的那一格畫面本來就顯示錯誤，不能再標「AI 剛改」
        if (!fromAi || handle.closed || controller.signal.aborted) return
        if (result.run.status !== 'succeeded') return
        broadcast('canvas.aiChanged', {
          at: (deps.now?.() ?? new Date()).toISOString(),
          channel: 'generation.done',
          changed: generatedNodeKeys(shotId, mode),
          added: [],
          removed: [],
        })
      })

    if (!progress.started) {
      // 預估超過上限等：執行前就失敗，直接把原本的錯誤交給呼叫端
      await running
    }
    // 背景執行：錯誤已經記在鏡頭上（畫面會顯示），這裡不再往外丟
    running.catch(() => undefined)
    log.info(`重新生成鏡頭 ${String(shot.number)}（${mode}）`)
  }

  return {
    list: snapshot,

    live() {
      const s = session
      const live = new Map<string, ShotLiveState>()
      if (!s || s.handle.closed) return live
      for (const [shotId, step] of s.activity) live.set(shotId, { step })
      for (const [shotId, error] of s.errors) {
        live.set(shotId, { ...live.get(shotId), error: error.message, failedStep: error.step })
      }
      return live
    },

    update(shotId, edit) {
      const s = need()
      const { shots, outline } = s.handle.repos
      const shot = shots.get(shotId)
      if (!shot) throw invalid('找不到這個鏡頭。')
      if (edit.sceneId && !outline.listScenes().some((x) => x.id === edit.sceneId)) {
        throw invalid('找不到這個場。')
      }
      if (edit.locationId && !outline.listLocations().some((x) => x.id === edit.locationId)) {
        throw invalid('找不到這個地點。')
      }
      const prompt = edit.prompt?.trim()
      const text = (value: string | null | undefined): string | undefined =>
        value?.trim() ? value.trim() : undefined
      const updated = shots.update(shotId, {
        ...(edit.description === undefined ? {} : { description: edit.description.trim() }),
        ...(edit.cameraMove === undefined
          ? {}
          : { cameraMove: edit.cameraMove?.trim() ? edit.cameraMove.trim() : null }),
        ...(edit.durationSec === undefined ? {} : { durationSec: edit.durationSec }),
        // null 或空白 = 清掉手動修改，回到自動組出的內容
        ...(edit.prompt === undefined ? {} : { prompt: prompt === '' ? undefined : prompt }),
        ...(edit.size === undefined ? {} : { size: edit.size }),
        ...(edit.angle === undefined ? {} : { angle: edit.angle }),
        ...(edit.dialogue === undefined ? {} : { dialogue: edit.dialogue.trim() }),
        ...(edit.characters === undefined
          ? {}
          : {
              // 名字沒變的角色保留原本的連結資料
              characters: edit.characters.map(
                (name) => shot.characters.find((c) => c.name === name) ?? { name },
              ),
            }),
        ...(edit.sceneId === undefined ? {} : { sceneId: edit.sceneId ?? undefined }),
        ...(edit.locationId === undefined ? {} : { locationId: edit.locationId ?? undefined }),
        ...(edit.lighting === undefined ? {} : { lighting: text(edit.lighting) }),
        ...(edit.timeOfDay === undefined ? {} : { timeOfDay: text(edit.timeOfDay) }),
        ...(edit.mood === undefined ? {} : { mood: text(edit.mood) }),
        ...(edit.inCut === undefined ? {} : { inCut: edit.inCut }),
      })
      changed(s)
      return view(s, updated)
    },

    create({ sceneId, afterShotId }) {
      if (deps.projectsDir !== undefined) {
        ensureProject(projects, deps.projectsDir, '我的短片', deps.now?.() ?? new Date())
      }
      const s = need()
      const { shots, outline } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再新增鏡頭。')
      if (sceneId && !outline.listScenes().some((x) => x.id === sceneId)) {
        throw invalid('找不到這個場。')
      }
      const before = shots.list()
      if (afterShotId && !before.some((x) => x.id === afterShotId)) {
        throw invalid('找不到這個鏡頭。')
      }
      // 每個鏡頭都要有場（沒有場的鏡頭畫布上沒有框、不會接進成品）：沒指定就放在前一個鏡頭的場，
      // 再沒有就放最後一個場，專案裡一個場都沒有就先建一個。畫布、分鏡表、MCP 的新增鏡頭都走這裡
      const afterScene = before.find((x) => x.id === afterShotId)?.sceneId
      const inScene = sceneId ?? afterScene ?? outline.listScenes().at(-1)?.id ?? newScene(outline)
      const created = shots.create({
        description: '新的鏡頭',
        sceneId: inScene,
      })
      if (afterShotId) {
        const ids = before.map((x) => x.id)
        ids.splice(ids.indexOf(afterShotId) + 1, 0, created.id)
        shots.reorder(ids)
      }
      changed(s)
      return view(s, shots.get(created.id) ?? created)
    },

    duplicate(shotId, options) {
      const s = need()
      const { shots } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再複製鏡頭。')
      const source = shots.get(shotId)
      if (!source) throw invalid('找不到這個鏡頭，可能已經被刪掉了。')
      const before = shots.list()
      // 只帶內容欄位：鏡號、順序、狀態、採用中的影片都是新的
      const fields = {
        size: source.size,
        angle: source.angle,
        cameraMove: source.cameraMove,
        durationSec: source.durationSec,
        description: source.description,
        dialogue: source.dialogue,
        characters: source.characters,
        inCut: source.inCut,
        ...(source.prompt === undefined ? {} : { prompt: source.prompt }),
        ...(source.locationId === undefined ? {} : { locationId: source.locationId }),
        ...(source.lighting === undefined ? {} : { lighting: source.lighting }),
        ...(source.timeOfDay === undefined ? {} : { timeOfDay: source.timeOfDay }),
        ...(source.mood === undefined ? {} : { mood: source.mood }),
      }
      const sceneId = options?.sceneId ?? source.sceneId
      const created = shots.create({ ...fields, ...(sceneId === undefined ? {} : { sceneId }) })
      if (options?.sceneId === undefined) {
        const ids = before.map((x) => x.id)
        ids.splice(ids.indexOf(shotId) + 1, 0, created.id)
        shots.reorder(ids)
      }
      changed(s)
      return view(s, shots.get(created.id) ?? created)
    },

    clearAdopted(shotId, kind) {
      const s = need()
      const { shots } = s.handle.repos
      if (!shots.get(shotId)) throw invalid('找不到這個鏡頭，可能已經被刪掉了。')
      if (s.regens.has(shotId)) throw invalid('這一鏡正在生成，等它完成再刪。')
      shots.unadopt(shotId, kind === 'image' ? 'first_frame' : 'video')
      changed(s)
    },

    remove(shotIds) {
      const s = need()
      const { shots } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再刪除鏡頭。')
      const doomed = new Set(shotIds)
      for (const id of doomed) {
        s.regens.get(id)?.abort()
        s.regens.delete(id)
        s.activity.delete(id)
        s.errors.delete(id)
        shots.delete(id)
      }
      shots.reorder(shots.list().map((x) => x.id))
      changed(s)
      return snapshot()
    },

    reorder(orderedIds) {
      const s = need()
      if (s.quick) throw invalid('整支影片正在生成，等它完成再調整順序。')
      s.handle.repos.shots.reorder(orderedIds)
      changed(s)
      return snapshot()
    },

    assignScene(shotIds, sceneId) {
      const s = need()
      const { shots, outline } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再調整。')
      // 沒指定場：放最後一個場，一個場都沒有就先建一個（畫布上「沒歸場的鏡頭」一鍵歸進場用）
      const target = sceneId ?? outline.listScenes().at(-1)?.id ?? newScene(outline)
      if (!outline.listScenes().some((x) => x.id === target)) throw invalid('找不到這個場。')
      for (const id of shotIds) {
        if (!shots.get(id)) throw invalid('找不到這個鏡頭。')
      }
      for (const id of shotIds) shots.update(id, { sceneId: target })
      changed(s)
      return snapshot()
    },

    moveToScene(shotId, sceneId) {
      const s = need()
      const { shots, outline } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再移動鏡頭。')
      const shot = shots.get(shotId)
      if (!shot) throw invalid('找不到這個鏡頭。')
      const scenes = outline.listScenes()
      const mine = scenes.findIndex((x) => x.id === sceneId)
      if (mine < 0) throw invalid('找不到這個場。')
      if (shot.sceneId === sceneId) return snapshot()
      const sceneIndex = new Map(scenes.map((x, i) => [x.id, i]))
      shots.update(shotId, { sceneId })
      const rest = shots.list().filter((x) => x.id !== shotId)
      // 放在這個場最後一個鏡頭的後面；這個場還沒有鏡頭，就放在前面各場的鏡頭後面
      const last = rest.findLastIndex((x) => x.sceneId === sceneId)
      const at =
        last >= 0
          ? last + 1
          : rest.findLastIndex((x) => {
              const index = x.sceneId === undefined ? undefined : sceneIndex.get(x.sceneId)
              return index !== undefined && index < mine
            }) + 1
      const ids = rest.map((x) => x.id)
      ids.splice(at, 0, shotId)
      shots.reorder(ids)
      changed(s)
      return snapshot()
    },

    flowOf(shotId) {
      const { handle } = need()
      const shot = handle.repos.shots.get(shotId)
      if (!shot) throw invalid('找不到這個鏡頭。')
      const image = settingsService.resolveModel('t2i') ?? ''
      const video = settingsService.resolveModel('i2v') ?? ''
      return flowFor(handle, shot, 'all', { image, video }).flow
    },

    sceneShotCounts(sceneId) {
      const { shots } = need().handle.repos
      const inScene = shots.list().filter((x) => x.sceneId === sceneId)
      return {
        existing: inScene.length,
        generated: inScene.filter((x) => shots.listTakes(x.id).length > 0).length,
      }
    },

    replaceSceneShots(sceneId, items) {
      const s = need()
      const { shots, outline } = s.handle.repos
      if (s.quick) throw invalid('整支影片正在生成，等它完成再讓 AI 分畫面。')
      const sceneOrder = new Map(outline.listScenes().map((x, i) => [x.id, i]))
      const mine = sceneOrder.get(sceneId)
      const scene = outline.listScenes().find((x) => x.id === sceneId)
      if (mine === undefined || !scene) throw invalid('找不到這個場。')

      const current = shots.list()
      const old = current.filter((x) => x.sceneId === sceneId)
      const rest = current.filter((x) => x.sceneId !== sceneId)
      const first = old[0]
      // 原本就有鏡頭：換在同一個位置；沒有：放在前面各場的鏡頭後面
      const at = first
        ? current.indexOf(first)
        : rest.findLastIndex((x) => {
            const index = x.sceneId ? sceneOrder.get(x.sceneId) : undefined
            return index !== undefined && index < mine
          }) + 1
      for (const shot of old) {
        s.regens.get(shot.id)?.abort()
        s.regens.delete(shot.id)
        s.activity.delete(shot.id)
        s.errors.delete(shot.id)
        shots.delete(shot.id)
      }
      const created = items.map((item) =>
        shots.create({
          sceneId,
          description: item.description,
          size: item.size,
          angle: item.angle,
          cameraMove: item.cameraMove,
          durationSec: item.durationSec,
          characters: item.characters.map((name) => ({ name })),
          dialogue: item.dialogue,
          ...(item.lighting ? { lighting: item.lighting } : {}),
          // 地點與時段沿用場的設定；氣氛 AI 沒特別寫就用場的
          ...(scene.locationId ? { locationId: scene.locationId } : {}),
          ...(scene.timeOfDay ? { timeOfDay: scene.timeOfDay } : {}),
          ...((item.mood ?? scene.mood) ? { mood: item.mood ?? scene.mood } : {}),
        }),
      )
      const ids = rest.map((x) => x.id)
      ids.splice(at, 0, ...created.map((x) => x.id))
      shots.reorder(ids)
      changed(s)
      return snapshot()
    },

    async regenerate(shotId, mode) {
      const s = need()
      const shot = s.handle.repos.shots.get(shotId)
      if (!shot) throw invalid('找不到這個鏡頭。')
      return launch(s, shot, mode)
    },

    batchCheck: (request) => checkBatch(need(), request).check,

    async generateBatch(request) {
      const s = need()
      const { check, toRun } = checkBatch(s, request)
      if (!check.ok) throw invalid(check.issue ?? '現在不能批次生成。')
      const failed: ShotBatchResult['failed'] = []
      let started = 0
      // 一個一個開始（各自在背景跑，供應商的並行數由佇列控制）；開始不了的記下來，繼續下一個
      for (const shot of toRun) {
        try {
          await launch(
            s,
            shot,
            batchModeOf(s.handle, shot, request.stage ?? 'full'),
            request.draft === true ? 'budget' : undefined,
          )
          started++
        } catch (error) {
          failed.push({
            shotId: shot.id,
            number: shot.number,
            error: isAppError(error) ? error.userMessage : '這個鏡頭沒辦法開始生成。',
          })
          if (!isAppError(error)) log.error(`批次生成發生未預期錯誤：${String(error)}`)
        }
      }
      log.info(`批次生成：開始 ${String(started)} 個，沒辦法開始 ${String(failed.length)} 個`)
      return {
        started,
        skippedGenerated: check.skippedGenerated,
        skippedBusy: check.skippedBusy,
        failed,
      }
    },

    staleness() {
      const s = session
      return s && !s.handle.closed ? staleOf(s) : new Map()
    },

    planRun: (items, quality) => checkRun(need(), items, quality),

    async run(items, quality) {
      const s = need()
      const plan = checkRun(s, items, quality)
      if (!plan.ok) throw invalid(plan.issue ?? '現在不能執行。')
      const failed: { shotId: string; number: number; error: string }[] = []
      let started = 0
      for (const entry of plan.entries) {
        try {
          await launch(s, entry.shot, entry.mode, quality)
          started++
        } catch (error) {
          failed.push({
            shotId: entry.shot.id,
            number: entry.shot.number,
            error: isAppError(error) ? error.userMessage : '這個鏡頭沒辦法開始生成。',
          })
          if (!isAppError(error)) log.error(`畫布執行發生未預期錯誤：${String(error)}`)
        }
      }
      log.info(`畫布執行：開始 ${String(started)} 個，沒辦法開始 ${String(failed.length)} 個`)
      return { started, failed }
    },

    whenIdle() {
      const s = session
      if (!s || s.regens.size === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
      })
    },

    cancel(shotId) {
      session?.regens.get(shotId)?.abort()
    },

    setUploadedFrame(shotId, assetHash) {
      const s = need()
      const { shots } = s.handle.repos
      if (!shots.get(shotId)) throw invalid('找不到這個鏡頭，可能已經被刪掉了。')
      // 先拿掉之前接上來的（同一鏡只會有一張接上來的圖）
      for (const take of shots.listTakes(shotId, 'first_frame')) {
        if (take.modelId === UPLOAD_MODEL) shots.deleteTake(take.id)
      }
      if (assetHash !== undefined) {
        const take = shots.addTake({
          shotId,
          kind: 'first_frame',
          assetHash,
          modelId: UPLOAD_MODEL,
          inputHash: uploadFingerprint(assetHash),
        })
        shots.adoptTake(take.id)
      }
      changed(s)
    },

    adopt(takeId) {
      const s = need()
      const { shots } = s.handle.repos
      const take = shots.adoptTake(takeId)
      const shot = shots.get(take.shotId)
      if (!shot) throw invalid('找不到這個版本所屬的鏡頭。')
      changed(s)
      return view(s, shot)
    },

    async rejoin() {
      const s = need()
      if (s.quick) throw invalid('整支影片正在生成，等它完成再接成成品。')
      const { handle } = s
      if (handle.repos.shots.list().length === 0) throw invalid('還沒有鏡頭可以接。')
      // 只接「放進成品」的鏡頭
      const list = cutTakes(handle)
      if (list.length === 0) throw invalid('沒有放進成品的鏡頭，先打開幾個鏡頭的「放進成品」。')
      const refs = list.map(({ shot, take }): AssetRef => {
        const meta = take ? handle.assets.getMeta(take.assetHash) : undefined
        if (!meta) {
          throw invalid(`第 ${String(shot.number)} 鏡還沒有可用的影片，先生成或重新生成它。`)
        }
        return {
          hash: meta.hash,
          kind: 'video',
          mime: meta.mime,
          bytes: meta.bytes,
          ...(meta.width ? { width: meta.width } : {}),
          ...(meta.height ? { height: meta.height } : {}),
          ...(meta.durationSec === undefined ? {} : { durationSec: meta.durationSec }),
        }
      })
      const queue = runtime.queue()
      const tool = tools()
      if (!queue || !tool) {
        throw new AppError({
          code: 'internal_error',
          userMessage: '找不到影片處理工具（FFmpeg），沒辦法接成成品。',
        })
      }
      const joined = await createStudioServices({
        queue,
        handle,
        tools: tool,
        models,
      }).concatVideos(refs, {
        signal: new AbortController().signal,
      })
      const takeIds = list.flatMap(({ take }) => (take ? [take.id] : []))
      // 有聲音要處理就混進去：成品是混好的，接片的結果另外記著（之後只改聲音時不用重新接片）
      const mixed = await deps.mixSound?.(handle, joined, new AbortController().signal)
      const finalHash = mixed?.asset.hash ?? joined.hash
      recordFinal(
        handle,
        finalHash,
        takeIds,
        mixed ? { baseAssetHash: joined.hash, soundKey: mixed.soundKey } : undefined,
      )
      changed(s)
      for (const listener of rejoinListeners) listener(finalHash)
      return { videoHash: finalHash }
    },

    beginQuickStart(context) {
      const s = need()
      for (const controller of s.regens.values()) controller.abort()
      s.regens.clear()
      s.quick = context
      s.quickShotIds = []
      s.handle.repos.projects.update({
        aspectRatio: context.aspectRatio,
        defaultStyleId: context.style,
      })
      return () => {
        if (s.quick === context) s.quick = undefined
      }
    },

    record(event) {
      const s = session
      if (!s || s.handle.closed || !s.quick) return
      recordQuick(s, s.quick, event)
    },

    finalVideoHash: () =>
      session && !session.handle.closed ? finalOf(session.handle).finalVideoHash : undefined,

    finalCut: () => (session && !session.handle.closed ? finalCutOf(session.handle) : undefined),

    onRejoined(listener) {
      rejoinListeners.add(listener)
      return () => rejoinListeners.delete(listener)
    },
  }
}
