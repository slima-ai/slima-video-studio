import { rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'

import { budgetExceededError, checkBudget } from '@svs/engine'
import type { ProjectHandle } from '@svs/db'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  isAppError,
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
import { QUICK_STYLE_IDS, writeTrailerScript, type StudioServices } from '@svs/workflows'

import { ensureProject } from '../ensure-project'
import type { AppSpendLedger } from '../costs/app-ledger'
import { createDraftCharacters } from '../quickstart/draft-characters'
import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import type { ShotService, TrailerBeatInput } from '../shots/shot-service'
import { createStudioServices } from '../studio-services'

/** 一次真的花了錢的文字模型呼叫。 */
interface SpentCall {
  amountUsd: number
  provider: string
  modelId: string
  jobId: string
}

export interface TrailerServiceDeps {
  projects: ProjectManager
  /** 還沒有專案時，寫腳本會自動建一個放在這裡。 */
  projectsDir: string
  /** App 層的花費帳本：寫腳本失敗、剛建的空專案被刪掉時，花掉的錢記在這裡（不跟專案走）。 */
  appLedger: AppSpendLedger
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

/** 文本超過這麼多字，腳本沒過檢查時才建議縮短文本。 */
const LONG_TEXT_CHARS = 12_000

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
        // 段落存在鏡頭上：跟寫腳本當下用同一套檢查（「懸念」那一格不算進節奏）
        ...(shot.segment === undefined ? {} : { segment: shot.segment }),
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

  /**
   * 寫腳本沒成功，而且這個專案是這次寫腳本自己建的（空的）：關掉並刪掉，專案清單不會多一個空專案。
   * 只刪「這次建的那一個」：中途使用者換開了別的專案、或裡面已經有東西，都不動。回傳有沒有刪掉。
   */
  const discardNewProject = (handle: ProjectHandle): boolean => {
    if (projects.current() !== handle || handle.closed) return false
    if (handle.repos.shots.list().length > 0 || handle.repos.trailer.get() !== undefined) {
      return false
    }
    const { dir } = handle
    const inside = resolve(dir).startsWith(`${resolve(deps.projectsDir)}${sep}`)
    if (!inside) return false
    projects.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      log.warn(`Could not remove the empty project ${dir}: ${String(error)}`)
    }
    return true
  }

  /**
   * 把真的花了錢的呼叫記進帳：專案還開著就記在專案的花費帳本上；專案已經不在了（空專案被刪掉、
   * 或中途關掉）就記在 App 層的帳本上，錢不會跟著專案消失。
   */
  const settleSpent = (handle: ProjectHandle, calls: readonly SpentCall[], gone: boolean): void => {
    for (const call of calls) {
      if (!gone && !handle.closed) {
        handle.repos.costs.record({
          projectId: handle.projectId,
          provider: call.provider,
          modelId: call.modelId,
          amountUsd: call.amountUsd,
          estimated: false,
          jobId: call.jobId,
        })
      } else {
        deps.appLedger.record({
          provider: call.provider,
          modelId: call.modelId,
          amountUsd: call.amountUsd,
          jobId: call.jobId,
          reason: 'trailer.plan: the project was removed or closed before the cost could be booked',
        })
      }
    }
  }

  /** 寫腳本的主體：專案已經開好（沒給的話外面先建）。 */
  const planOnto = async (
    handle: ProjectHandle,
    parsed: ReturnType<typeof TrailerPlanRequestSchema.parse>,
    spent: SpentCall[],
  ): Promise<TrailerPlanResult> => {
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
    // 每次文字模型呼叫回來的金額都先記下來（寫腳本中途失敗，錢也已經花了）
    const metered: StudioServices = {
      ...studio,
      generate: async (request, ctx) => {
        const result = await studio.generate(request, ctx)
        if (result.costUsd !== undefined && result.costUsd > 0) {
          spent.push({
            amountUsd: result.costUsd,
            provider: result.provider,
            modelId: request.modelId,
            jobId: result.jobId,
          })
        }
        return result
      },
    }
    const written = await writeTrailerScript(
      metered,
      {
        modelId: model,
        text: parsed.text,
        settings: merged,
        guide: defaultTrailerGuide(),
        knownCharacters: handle.repos.characters.list().map((c) => c.name),
        knownLocations: handle.repos.outline.listLocations().map((l) => l.name),
        style: toStyle(handle.repos.projects.get().defaultStyleId),
      },
      { signal: new AbortController().signal },
    ).catch((error: unknown) => {
      // 腳本沒過檢查：文字很長才建議縮短（第一格是字卡這種錯，縮短文本沒有用）
      if (
        isAppError(error) &&
        error.code === 'invalid_response' &&
        parsed.text.length > LONG_TEXT_CHARS
      ) {
        throw new AppError({
          code: error.code,
          retryable: error.retryable,
          userMessage: `${error.userMessage} ${t('trailer.shortenHint')}`,
        })
      }
      throw error
    })
    // 單獨呼叫不會經過引擎，自己記到花費帳本（寫腳本的每一次呼叫；專案這時若已關掉就記到 App 層的帳）
    settleSpent(handle, spent, handle.closed)
    spent.length = 0
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
      // 地點：名字跟既有的場景卡一樣（不分大小寫、頭尾空白）就用既有的那張，沒有才建草稿卡。
      // 草稿卡的說明只用腳本另外寫的「地點外觀」（只寫地方本身）；沒有就留空，不拿某一格的畫面描述來填
      // （那句寫的是人在做什麼，鎖定場景卡後會被帶進發生在這裡的每一鏡）。外觀裡出現角色名字、或跟某一格的畫面描述
      // 一樣，就當沒寫。
      const peopleNames = new Set([
        ...handle.repos.characters.list().map((c) => c.name),
        ...written.script.beats.flatMap((b) => b.characters),
      ])
      const pictureTexts = new Set(written.script.beats.map((b) => b.description.trim()))
      const lookOf = (name: string): string => {
        const key = name.trim().toLowerCase()
        const look =
          written.script.places.find((p) => p.name.trim().toLowerCase() === key)?.look.trim() ?? ''
        if (look === '' || pictureTexts.has(look)) return ''
        return [...peopleNames].some((person) => person !== '' && look.includes(person)) ? '' : look
      }
      const placeIds = new Map<string, string>()
      const placeOf = (name: string): string | undefined => {
        const key = name.trim().toLowerCase()
        if (key === '') return undefined
        const known = placeIds.get(key)
        if (known !== undefined) return known
        const existing = outline.listLocations().find((l) => l.name.trim().toLowerCase() === key)
        const id =
          existing?.id ?? outline.addLocation({ name: name.trim(), description: lookOf(name) }).id
        placeIds.set(key, id)
        return id
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
        ...(beat.beatKind === 'video' || beat.beatKind === 'still'
          ? { locationId: placeOf(beat.location) }
          : {}),
        dialogue:
          merged.narration && (beat.beatKind === 'video' || beat.beatKind === 'still')
            ? beat.dialogue.trim()
            : '',
        ...(beat.beatKind === 'card'
          ? { card: { text: beat.cardText.trim(), subtext: beat.cardSubtext.trim() } }
          : {}),
        ...(beat.segment.trim() === '' ? {} : { segment: beat.segment.trim() }),
      }))
      handle.repos.trailer.update({
        ...given,
        sourceText: parsed.text,
        // 重新寫腳本：鏡頭換了，旁白與配樂要再加一次
        soundAutoAddedAt: null,
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
  }
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
      // 還沒有專案（直接貼文本）就先建一個，專案名取書名；這次自己建的專案，腳本沒寫成就不留下
      const created = projects.current() === undefined
      ensureProject(projects, deps.projectsDir, parsed.title ?? t('trailer.sceneTitle'))
      const handle = need()
      // 這次真的花了錢的呼叫（不管最後成不成功都要記帳：被檢查器擋下、回亂碼、重寫那一次也一樣）
      const spent: SpentCall[] = []
      try {
        return await planOnto(handle, parsed, spent)
      } catch (error) {
        const removed = created && discardNewProject(handle)
        settleSpent(handle, spent, removed)
        throw error
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
