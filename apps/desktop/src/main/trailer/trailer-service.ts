import { budgetExceededError, checkBudget } from '@svs/engine'
import type { ProjectHandle } from '@svs/db'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  TrailerSettingsSchema,
  checkTrailerScript,
  defaultTrailerGuide,
  fitToTarget,
  LENGTH_TOLERANCE_SEC,
  cardNameOf,
  t,
  type Shot,
  type TrailerPlanCheck,
  type TrailerPlanRequest,
  type TrailerPlanResult,
  type TrailerSettings,
  type TrailerSettingsPatch,
  type TrailerStatus,
  type TrailerUpdateRequest,
  TrailerPlanRequestSchema,
  TrailerSettingsPatchSchema,
} from '@svs/schema'
import { QUICK_STYLE_IDS, writeTrailerScript } from '@svs/workflows'

import { ensureProject } from '../ensure-project'
import { createDraftCharacters } from '../quickstart/draft-characters'
import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import type { ShotService, TrailerBeatInput } from '../shots/shot-service'
import { createStudioServices } from '../studio-services'

export interface TrailerServiceDeps {
  projects: ProjectManager
  /** 還沒有專案時，寫腳本會自動建一個放在這裡。 */
  projectsDir: string
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  shots: ShotService
  /** 把一件事記成一步復原（歷史服務的 record）。 */
  record: <T>(label: string, run: () => T) => T
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
}

export interface TrailerService {
  get: () => { exists: boolean; settings: TrailerSettings }
  check: (text?: string) => TrailerPlanCheck
  plan: (request: TrailerPlanRequest) => Promise<TrailerPlanResult>
  update: (request: TrailerUpdateRequest) => TrailerStatus
  status: () => TrailerStatus
}

/** 檢查器與腳本都用 24 格（本機格子的幀率，也是成品的預設幀率）。 */
const FPS = 24

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

const toStyle = (id: string | undefined) => QUICK_STYLE_IDS.find((s) => s === id) ?? 'realistic'

/** 預告片：寫腳本（文字模型一次）、改設定、照新長度重排、現在的狀態。 */
export function createTrailerService(deps: TrailerServiceDeps): TrailerService {
  const { projects, settings, settingsService, models, runtime, shots, record, broadcast, log } =
    deps
  const tools = deps.tools ?? findTools

  const need = (): ProjectHandle => {
    const handle = projects.current()
    if (!handle || handle.closed) throw invalid(t('services.openOrCreateAProject'))
    return handle
  }

  /** 預告片腳本所在的場裡的鏡頭（照順序）；還沒寫過腳本就是空的。 */
  const scriptShots = (handle: ProjectHandle, trailer: TrailerSettings | undefined): Shot[] => {
    const sceneId = trailer?.sceneId
    if (sceneId === undefined) return []
    return handle.repos.shots.list().filter((shot) => shot.sceneId === sceneId)
  }

  const checkOf = (list: readonly Shot[], trailer: TrailerSettings) =>
    checkTrailerScript(
      list.map((shot) => ({
        beatKind: shot.beatKind,
        durationSec: shot.durationSec,
        ...(shot.dialogue.trim() !== '' && (shot.beatKind === 'video' || shot.beatKind === 'still')
          ? { dialogue: shot.dialogue }
          : {}),
        ...(shot.beatKind === 'card' && shot.card ? { card: shot.card } : {}),
      })),
      trailer,
      FPS,
    )

  const statusOf = (handle: ProjectHandle): TrailerStatus => {
    const stored = handle.repos.trailer.get()
    const trailer = stored ?? TrailerSettingsSchema.parse({})
    const list = scriptShots(handle, stored)
    const check = checkOf(list, trailer)
    const finalHash = shots.list().finalVideoHash
    const filmSec =
      finalHash === undefined ? undefined : handle.assets.getMeta(finalHash)?.durationSec
    const view = (issue: { code: string; index?: number; message: string }) => ({
      code: issue.code,
      ...(issue.index === undefined ? {} : { index: issue.index }),
      message: issue.message,
    })
    return {
      exists: stored !== undefined,
      settings: trailer,
      targetSec: trailer.targetSec,
      scriptSec: check.totalSec,
      beatCount: list.length,
      matches:
        list.length > 0 && Math.abs(check.totalSec - trailer.targetSec) <= LENGTH_TOLERANCE_SEC,
      errors: check.errors.map(view),
      warnings: check.warnings.map(view),
      ...(filmSec === undefined ? {} : { filmSec }),
    }
  }

  const checkPlan = (text?: string): TrailerPlanCheck => {
    const { demoMode, budget } = settings.get()
    const handle = projects.current()
    const model = settingsService.resolveModel('llm')
    const list = handle ? scriptShots(handle, handle.repos.trailer.get()) : []
    const views = handle ? shots.list().shots : []
    const existing = new Set(list.map((shot) => shot.id))
    const base = {
      demoMode,
      existingBeats: list.length,
      generatedBeats: views.filter(
        (v) => existing.has(v.id) && (v.videos.length > 0 || v.firstFrames.length > 0),
      ).length,
    }
    if (!model) return { ...base, ok: false, issue: t('trailer.noTextModel'), estimatedUsd: 0 }
    const chars = (text?.length ?? 6000) + 2500
    const estimatedUsd = models.estimate(model, {
      inputTokens: Math.ceil(chars * 1.5) + 1500,
      // 寫一次最多再重寫一次
      outputTokens: 2 * 1800,
    })
    const modelName = cardNameOf(models.get(model))
    const exceeded = checkBudget({
      budget,
      runProjectedUsd: estimatedUsd,
      projectBaseUsd: handle ? handle.repos.costs.totalUsd(handle.projectId) : 0,
    })
    return {
      ...base,
      estimatedUsd,
      ...(modelName ? { modelName } : {}),
      ...(exceeded
        ? { ok: false, issue: budgetExceededError(exceeded).userMessage }
        : { ok: true }),
    }
  }

  /** 請求裡的預告片設定欄位（拿掉文本、沒給的不帶）。 */
  const patchOf = (request: TrailerPlanRequest): TrailerSettingsPatch =>
    TrailerSettingsPatchSchema.parse(
      Object.fromEntries(
        Object.entries(TrailerPlanRequestSchema.parse(request)).filter(
          ([key, value]) => key !== 'text' && value !== undefined,
        ),
      ),
    )

  return {
    get() {
      const handle = need()
      const stored = handle.repos.trailer.get()
      return { exists: stored !== undefined, settings: stored ?? TrailerSettingsSchema.parse({}) }
    },

    check: checkPlan,

    status() {
      return statusOf(need())
    },

    async plan(request) {
      const parsed = TrailerPlanRequestSchema.parse(request)
      // 還沒有專案（直接貼文本）就先建一個，專案名取書名
      ensureProject(projects, deps.projectsDir, parsed.title ?? t('trailer.sceneTitle'))
      const handle = need()
      const checked = checkPlan(parsed.text)
      const model = settingsService.resolveModel('llm')
      if (!checked.ok || !model) throw invalid(checked.issue ?? t('trailer.noTextModel'))
      const queue = runtime.queue()
      const tool = tools()
      if (!queue || !tool) {
        throw new AppError({
          code: 'internal_error',
          userMessage: t('services.theGenerationServiceIsnT'),
        })
      }
      const given = patchOf(parsed)
      const base = handle.repos.trailer.get() ?? TrailerSettingsSchema.parse({})
      const merged = TrailerSettingsSchema.parse({ ...base, ...given })
      const studio = createStudioServices({ queue, handle, tools: tool, models })
      const written = await writeTrailerScript(
        studio,
        {
          modelId: model,
          text: parsed.text,
          settings: merged,
          guide: defaultTrailerGuide(),
          knownCharacters: handle.repos.characters.list().map((c) => c.name),
          style: toStyle(handle.repos.projects.get().defaultStyleId),
        },
        { signal: new AbortController().signal },
      )
      // 單獨呼叫不會經過引擎，自己記到花費帳本
      if (written.costUsd !== undefined && !handle.closed) {
        handle.repos.costs.record({
          projectId: handle.projectId,
          provider: written.provider,
          modelId: model,
          amountUsd: written.costUsd,
          estimated: false,
          jobId: written.jobId,
        })
      }
      if (handle.closed) throw invalid(t('services.theProjectWasClosedSo4'))

      // 腳本通過檢查了，才一次寫進專案（整個動作算一步復原）
      record(t('history.writeTrailerScript'), () => {
        const { outline } = handle.repos
        let sceneId = base.sceneId
        if (sceneId === undefined || !outline.listScenes().some((s) => s.id === sceneId)) {
          const act =
            outline.listActs().at(-1) ??
            outline.addAct({ title: t('services.act', { value: String(1) }) })
          sceneId = outline.addScene(act.id, { title: t('trailer.sceneTitle') }).id
        }
        const beats: TrailerBeatInput[] = written.script.beats.map((beat) => ({
          beatKind: beat.beatKind,
          durationSec: beat.durationSec,
          // 鏡頭的描述不能是空的：字卡寫字卡的字，片名卡寫書名
          description:
            beat.beatKind === 'card'
              ? beat.cardText.trim()
              : beat.beatKind === 'title'
                ? (merged.title === '' ? written.script.title.trim() : merged.title) ||
                  t('trailer.beatTitle')
                : beat.description.trim() === ''
                  ? t('shots.newShot')
                  : beat.description.trim(),
          action: beat.action.trim(),
          size: beat.size,
          angle: beat.angle,
          cameraMove: beat.cameraMove,
          characters: beat.characters,
          dialogue:
            merged.narration && (beat.beatKind === 'video' || beat.beatKind === 'still')
              ? beat.dialogue.trim()
              : '',
          ...(beat.beatKind === 'card'
            ? { card: { text: beat.cardText.trim(), subtext: beat.cardSubtext.trim() } }
            : {}),
        }))
        handle.repos.trailer.update({
          ...given,
          title: merged.title === '' ? written.script.title.trim() : merged.title,
          musicBrief: written.script.music.trim(),
          sceneId,
        })
        shots.placeTrailerBeats(sceneId, beats)
        createDraftCharacters(handle)
      })
      log.info(
        `Wrote a ${merged.kind} trailer script: ${String(written.script.beats.length)} beats, ${String(merged.targetSec)}s`,
      )
      broadcast('trailer.changed', {})
      return {
        ...statusOf(handle),
        retried: written.retried,
        fixes: written.fixes,
        ...(written.costUsd === undefined ? {} : { costUsd: written.costUsd }),
      }
    },

    update(request) {
      const handle = need()
      const { patch, refit } = request
      const before = handle.repos.trailer.get()
      const next = TrailerSettingsSchema.parse({ ...(before ?? {}), ...stripUndefined(patch) })
      let durations: { id: string; sec: number }[] = []
      if (refit === true) {
        const list = scriptShots(handle, before)
        if (list.length === 0) throw invalid(t('trailer.noScript'))
        const fit = fitToTarget(
          list.map((shot) => ({
            beatKind: shot.beatKind,
            durationSec: shot.durationSec,
            ...(shot.beatKind === 'card' && shot.card ? { card: shot.card } : {}),
          })),
          next.targetSec,
          FPS,
        )
        if (!fit.ok) throw invalid(t('trailer.refitImpossible'))
        durations = list.map((shot, i) => ({
          id: shot.id,
          sec: fit.durations[i] ?? shot.durationSec,
        }))
      }
      record(refit === true ? t('history.refitTrailer') : t('history.editTrailerSettings'), () => {
        handle.repos.trailer.update(patch)
        for (const { id, sec } of durations) shots.update(id, { durationSec: sec })
      })
      broadcast('trailer.changed', {})
      return statusOf(handle)
    },
  }
}

const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
