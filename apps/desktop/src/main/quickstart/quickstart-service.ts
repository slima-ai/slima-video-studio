import {
  budgetExceededError,
  checkBudget,
  createRegistry,
  estimateWorkflowCost,
  type NodeRegistry,
} from '@svs/engine'
import { appendEndCard, probe, type MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  DEFAULT_SOUND_SETTINGS,
  billableChars,
  isAppError,
  resolveStoryboardGuide,
  type QuickStartCheck,
  type QuickStartProgress,
  type QuickStartRequest,
} from '@svs/schema'
import {
  STUDIO_SERVICE_KEY,
  buildQuickStart,
  quickStartItemCounts,
  registerQuickStartNodes,
} from '@svs/workflows'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { lockedAnchors, referenceEditModel } from '../characters/anchors'
import { ensureProject, safeFileName, stamp } from '../ensure-project'
import { createProjectEngine } from '../project-engine'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import type { ShotService } from '../shots/shot-service'
import { collectAttributions, creditLines, type CardRenderer } from '../credits/credits'
import type { SoundService } from '../sound/sound-service'
import { createStudioServices } from '../studio-services'
import { ProgressTracker } from './progress-tracker'

export interface QuickStartDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  shots: ShotService
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 沒有開啟專案時，自動建立的專案放在這個資料夾裡。 */
  projectsDir: string
  /** 找 FFmpeg（接片用）。預設到系統找。 */
  tools?: () => MediaTools | undefined
  /** 聲音服務（完成後自動加旁白與配樂用）；沒給就不加。聲音服務在快速開始之後才建，所以用函式取。 */
  sound?: () => Pick<SoundService, 'addAll'> | undefined
  /** 把片尾字卡畫成圖（Electron 離屏視窗）；沒給就匯出時不加字卡。 */
  renderCreditsCard?: CardRenderer
  now?: () => Date
}

export interface QuickStartService {
  check: (request: QuickStartRequest) => QuickStartCheck
  /** 開始生成，背景執行；`onSettled` 在整次生成結束（成功、失敗或停止，資料都寫好之後）時呼叫。 */
  run: (
    request: QuickStartRequest,
    hooks?: { onSettled?: () => void },
  ) => Promise<{ runId: string }>
  cancel: () => void
  state: () => QuickStartProgress | null
  /** 匯出最新一版成品；credits（預設 true）＝片尾接一張「用了哪些 AI 服務」的字卡，只加在匯出的檔案上。 */
  export: (options?: { credits?: boolean }) => Promise<{ path: string; credits: boolean }>
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 快速開始：檢查設定與預估花費、（必要時自動建立專案後）在背景執行工作流、推送進度、匯出成品。
 * 一次只跑一個；專案被關閉或換掉時會先取消正在跑的。
 */
export function createQuickStartService(deps: QuickStartDeps): QuickStartService {
  const { projects, runtime, settings, settingsService, models, shots, broadcast, log } = deps
  const now = deps.now ?? (() => new Date())
  const tools = deps.tools ?? findTools

  /** 對話框勾了旁白、配樂時，預估要多花的錢：配樂一首；旁白每鏡約 40 個字（鏡頭還沒拆出來，只能估）。 */
  const soundEstimate = (request: QuickStartRequest): number => {
    const want = request.sound
    if (!want) return 0
    let usd = 0
    const music = settingsService.resolveModel('music')
    if (want.music && music) usd += models.estimate(music, { tracks: 1 })
    const tts = settingsService.resolveModel('tts')
    const card = tts === undefined ? undefined : models.get(tts)
    if (want.narration && tts !== undefined && card) {
      usd +=
        request.shotCount * models.estimate(tts, { chars: billableChars(card, '字'.repeat(40)) })
    }
    return usd
  }

  const registry: NodeRegistry = createRegistry()
  registerQuickStartNodes(registry)

  let tracker = new ProgressTracker()
  let active: AbortController | undefined

  projects.onChange(() => {
    active?.abort()
    tracker = new ProgressTracker()
  })
  // 在鏡頭面板重新接片後，預覽與匯出都改用新接好的影片
  shots.onRejoined((videoHash) => {
    const snapshot = tracker.setFinalVideo(videoHash)
    if (snapshot) broadcast('quickstart.progress', snapshot)
  })

  const picked = () => ({
    llm: settingsService.resolveModel('llm'),
    image: settingsService.resolveModel('t2i'),
    video: settingsService.resolveModel('i2v'),
  })
  const nameOf = (id: string | undefined): string | undefined =>
    id ? (models.get(id)?.displayName ?? id) : undefined

  const check = (request: QuickStartRequest): QuickStartCheck => {
    const { budget, demoMode } = settings.get()
    const issues: QuickStartCheck['issues'] = []
    const chosen = picked()
    const problem = (message: string, action?: 'settings'): void => {
      issues.push({ message, ...(action ? { action } : {}) })
    }

    if (request.story.trim() === '') problem('請先輸入你想拍的故事。')
    const handle0 = projects.current()
    if (
      request.sourceKey !== undefined &&
      !handle0?.repos.canvas
        .listNodes()
        .some((n) => n.type === 'oneliner' && `node:${n.id}` === request.sourceKey)
    ) {
      problem('找不到這個「一句話」，可能已經被刪掉了。')
    }
    if (active) problem('已經有一支影片正在生成，等它完成或先取消。')
    const hint = demoMode ? '' : '（或到設定打開示範模式先試玩）'
    if (!chosen.llm)
      problem(`還沒有可用的文字模型：請到設定填入 OpenRouter 的服務金鑰${hint}。`, 'settings')
    if (!chosen.image)
      problem(`還沒有可用的圖片模型：請到設定填入 fal.ai 的服務金鑰${hint}。`, 'settings')
    if (!chosen.video)
      problem(`還沒有可用的影片模型：請到設定填入 fal.ai 的服務金鑰${hint}。`, 'settings')
    if (!tools()) problem('找不到影片處理工具（FFmpeg），沒辦法把鏡頭接成一支影片。')

    let estimatedUsd = 0
    let lowerBound = true
    if (chosen.llm && chosen.image && chosen.video) {
      const flow = buildQuickStart({
        ...request,
        models: { llm: chosen.llm, image: chosen.image, video: chosen.video },
        // 預估要算進原聲的加價（有開才算）
        audio:
          projects.current()?.repos.sound.getSettings().nativeAudio ??
          DEFAULT_SOUND_SETTINGS.nativeAudio,
        storyboardGuide: resolveStoryboardGuide(settings.get().storyboardGuide),
      })
      const estimate = estimateWorkflowCost(flow, registry, {
        priceLookup: (id, usage) => models.estimate(id, usage),
        itemCounts: quickStartItemCounts(request),
      })
      estimatedUsd = estimate.totalUsd + soundEstimate(request)
      lowerBound = estimate.uncertainNodeIds.length > 0 || request.sound?.narration === true
      const handle = projects.current()
      const exceeded = checkBudget({
        budget,
        runProjectedUsd: estimatedUsd,
        projectBaseUsd: handle ? handle.repos.costs.totalUsd(handle.projectId) : 0,
      })
      if (exceeded) problem(budgetExceededError(exceeded).userMessage, 'settings')
    }

    return {
      ok: issues.length === 0,
      issues,
      estimatedUsd,
      estimateIsLowerBound: lowerBound,
      limitUsd: budget.perRunLimitUsd,
      models: {
        ...(nameOf(chosen.llm) ? { llm: nameOf(chosen.llm) } : {}),
        ...(nameOf(chosen.image) ? { image: nameOf(chosen.image) } : {}),
        ...(nameOf(chosen.video) ? { video: nameOf(chosen.video) } : {}),
      },
      demoMode,
    }
  }

  return {
    check,

    async run(request, hooks) {
      const result = check(request)
      const [first] = result.issues
      if (first) throw invalid(first.message)
      const chosen = picked()
      if (!chosen.llm || !chosen.image || !chosen.video) throw invalid('還沒有可用的模型。')

      ensureProject(projects, deps.projectsDir, request.story, now())
      const handle = projects.current()
      const queue = runtime.queue()
      const tool = tools()
      if (!handle || !queue || !tool) {
        throw new AppError({
          code: 'internal_error',
          userMessage: '生成服務還沒準備好，請重新啟動 App。',
        })
      }

      tracker = new ProgressTracker()
      const myTracker = tracker
      const controller = new AbortController()
      active = controller
      const { budget } = settings.get()
      const endShots = shots.beginQuickStart({
        style: request.style,
        aspectRatio: request.aspectRatio,
        variation: request.variation,
        models: { image: chosen.image, video: chosen.video },
        ...(request.mode ? { mode: request.mode } : {}),
        ...(request.sourceKey ? { sourceKey: request.sourceKey } : {}),
      })
      // 對話框的「影片原聲」勾選存進專案的聲音設定（之後單鏡重新生成也沿用）
      if (request.sound) handle.repos.sound.updateSettings({ nativeAudio: request.sound.native })
      const anchors = lockedAnchors(handle)
      const editModel = referenceEditModel(anchors, settingsService, models)
      const flow = buildQuickStart({
        ...request,
        models: { llm: chosen.llm, image: chosen.image, video: chosen.video },
        audio: handle.repos.sound.getSettings().nativeAudio,
        anchors,
        ...(editModel ? { editModel } : {}),
        knownCharacters: handle.repos.characters.list().map((c) => c.name),
        storyboardGuide: resolveStoryboardGuide(settings.get().storyboardGuide),
      })
      const engine = createProjectEngine(handle, {
        registry,
        services: {
          [STUDIO_SERVICE_KEY]: createStudioServices({ queue, handle, tools: tool, models }),
        },
        priceLookup: (id, usage) => models.estimate(id, usage),
        onEvent: (event) => {
          shots.record(event)
          const snapshot = myTracker.handle(event)
          if (snapshot && myTracker === tracker) broadcast('quickstart.progress', snapshot)
        },
      })

      const running = engine
        .run(flow, {
          projectId: handle.projectId,
          signal: controller.signal,
          itemCounts: quickStartItemCounts(request),
          budget,
        })
        .catch((error: unknown) => {
          // 執行前就失敗（預估超過上限、工作流無效…）：回報給畫面，也讓 run() 的呼叫端知道
          const shape = isAppError(error)
            ? error.toShape()
            : new AppError({
                code: 'internal_error',
                userMessage: '生成失敗，請再試一次。',
              }).toShape()
          if (!isAppError(error)) log.error(`快速開始發生未預期錯誤：${String(error)}`)
          const current = myTracker.snapshot()
          const snapshot =
            current?.status === 'running'
              ? myTracker.handle({ type: 'run-finished', runId: current.runId, status: 'failed' })
              : myTracker.fail(`failed-${stamp(now())}`, shape)
          if (snapshot && myTracker === tracker) broadcast('quickstart.progress', snapshot)
          throw error
        })
        .then(async (result) => {
          // 完成後自動加旁白與配樂（對話框勾了才加）；聲音失敗不影響已經生成好的影片，
          // 成品面板的「加上旁白與配樂」還可以再試
          if (result.run.status !== 'succeeded') return
          const want = request.sound
          const sound = deps.sound?.()
          if (!sound || !want || !(want.narration || want.music)) return
          try {
            await sound.addAll({ narration: want.narration, music: want.music })
          } catch (error) {
            log.warn(`快速開始完成後加聲音失敗：${String(error)}`)
          }
        })
        .finally(() => {
          if (active === controller) active = undefined
          endShots()
          hooks?.onSettled?.()
        })

      // run-started 事件在 engine.run() 的同步部分就送出；到這裡還沒有 runId，代表執行前就失敗了
      const runId = myTracker.snapshot()?.runId
      if (!runId) {
        await running // 預估超過上限等：丟出原本的錯誤
        throw new AppError({ code: 'internal_error', userMessage: '生成沒有開始。' })
      }
      // 背景執行：錯誤已經由上面的 catch 回報給畫面，這裡不再往外丟
      running.catch(() => undefined)
      log.info(`快速開始開始：${runId}`)
      return { runId }
    },

    cancel() {
      active?.abort()
    },

    state() {
      return tracker.snapshot() ?? null
    },

    async export(options = {}) {
      const handle = projects.current()
      // 最新一版成品（有聲音時是混好的）；沒有才用這次生成接好的影片
      const hash = shots.finalVideoHash() ?? tracker.snapshot()?.finalVideoHash
      if (!handle || !hash) throw invalid('還沒有可以匯出的影片，請先完成一次生成。')
      const source = handle.assets.find(hash)
      if (!source) throw invalid('找不到成品影片檔，可能已被刪除。')
      const dir = join(handle.dir, 'exports')
      mkdirSync(dir, { recursive: true })
      const title = safeFileName(tracker.snapshot()?.title ?? '', '短片')
      const path = join(dir, `${title}-${stamp(now())}.mp4`)
      // 片尾字卡：列出這個專案用了哪些 AI 服務（預設加；只加在匯出的檔案上，專案裡的成品不變）
      let credits = false
      const tool = tools()
      if ((options.credits ?? true) && deps.renderCreditsCard && tool) {
        try {
          const info = await probe(tool, source.path)
          const png = await deps.renderCreditsCard({
            lines: creditLines(collectAttributions(handle, models)),
            width: info.width ?? 1280,
            height: info.height ?? 720,
          })
          const work = await mkdtemp(join(tmpdir(), 'svs-credits-'))
          try {
            const card = join(work, 'card.png')
            writeFileSync(card, png)
            await appendEndCard(tool, source.path, card, path)
            credits = true
          } finally {
            await rm(work, { recursive: true, force: true })
          }
        } catch (error) {
          // 字卡出問題不能害使用者匯不出影片：改匯出沒有字卡的版本
          log.warn(`片尾字卡沒有加成功，改匯出沒有字卡的版本：${String(error)}`)
        }
      }
      if (!credits) copyFileSync(source.path, path)
      const snapshot = tracker.patch({ exportedPath: path })
      if (snapshot) broadcast('quickstart.progress', snapshot)
      return { path, credits }
    },
  }
}
