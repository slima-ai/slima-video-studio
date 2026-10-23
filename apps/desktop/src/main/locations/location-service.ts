import type { ProjectHandle } from '@svs/db'
import { budgetExceededError, checkBudget, createRegistry } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  LOCATION_ANCHOR_MAX,
  LOCATION_ANGLES,
  LOCATION_CONCEPTS_PER_ROUND,
  isAppError,
  type ConceptCheck,
  type LocationAngle,
  type LocationCardView,
  type LocationGenerateKind,
  type LocationImagesState,
  type LocationReferencePurpose,
  type LocationReferencesState,
  t,
  cardNameOf,
} from '@svs/schema'
import {
  QUICK_STYLE_IDS,
  STUDIO_SERVICE_KEY,
  buildLocationAngleWorkflow,
  buildLocationConceptWorkflow,
  registerQuickStartNodes,
  type QuickStyleId,
} from '@svs/workflows'
import { z } from 'zod'

import { assetRefOf, pickEditModel } from '../characters/anchors'
import type { Logger } from '../logger'
import { createProjectEngine } from '../project-engine'
import type { ProjectManager } from '../project-manager'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import { createStudioServices } from '../studio-services'

export interface LocationServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
  /** 重新生成角度時用來換「變化編號」；測試要固定時傳入。 */
  now?: () => number
}

export interface LocationService {
  list: () => LocationCardView[]
  setAnchor: (locationId: string, text: string) => LocationCardView
  images: (locationId: string) => LocationImagesState
  check: (locationId: string, kind: LocationGenerateKind) => ConceptCheck
  /** 開始生成（背景執行）；進度與結果用 locations.imagesChanged 推送。 */
  generate: (locationId: string, kind: LocationGenerateKind) => void
  cancel: (locationId: string) => void
  pickMain: (locationId: string, conceptId: string) => LocationCardView
  lock: (locationId: string) => LocationCardView
  unlock: (locationId: string) => LocationCardView
  /** 這張場景卡的參考圖清單（每張有用途標記）。 */
  references: (locationId: string) => LocationReferencesState
  /** 把專案裡已有的一張圖片加成參考圖並標上用途；同一張圖同一個用途只存一筆。 */
  addReference: (request: {
    locationId: string
    assetHash: string
    purpose: LocationReferencePurpose
    label: string
  }) => LocationReferencesState
  /** 移除一張另外加的參考圖（圖檔留在專案裡）。 */
  removeReference: (locationId: string, referenceId: string) => LocationReferencesState
}

const ImageOutputSchema = z.object({ image: AssetRefSchema })

const toStyle = (id: string | undefined): QuickStyleId =>
  QUICK_STYLE_IDS.find((s) => s === id) ?? 'realistic'

interface Active {
  kind: LocationGenerateKind
  controller: AbortController
  done: number
  total: number
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 場景卡：先生 4 張概念圖挑主場景圖，再以主圖當參考生出另外兩個角度（反方向、拉遠全景），
 * 最後寫好固定描述、鎖定。每張圖都是一次完整的引擎執行，花費入帳、預算上限、取消都和角色一樣。
 */
export function createLocationService(deps: LocationServiceDeps): LocationService {
  const { projects, runtime, settings, settingsService, models, broadcast, log } = deps
  const tools = deps.tools ?? findTools
  const now = deps.now ?? Date.now
  const registry = createRegistry()
  registerQuickStartNodes(registry)
  const active = new Map<string, Active>()
  const lastErrors = new Map<string, string>()

  projects.onChange(() => {
    for (const run of active.values()) run.controller.abort()
    active.clear()
    lastErrors.clear()
  })

  const need = (): ProjectHandle => {
    const handle = projects.current()
    if (!handle || handle.closed) throw invalid(t('chat.openOrCreateAProject'))
    return handle
  }

  const stateOf = (handle: ProjectHandle, locationId: string): LocationImagesState => {
    const running = active.get(locationId)
    const error = lastErrors.get(locationId)
    return {
      locationId,
      concepts: handle.repos.locationCards.listConcepts(locationId),
      ...(running
        ? { generating: { kind: running.kind, done: running.done, total: running.total } }
        : {}),
      ...(error ? { error } : {}),
    }
  }

  const changed = (handle: ProjectHandle, locationId: string): void => {
    if (!handle.closed && projects.current() === handle) {
      broadcast('locations.imagesChanged', stateOf(handle, locationId))
    }
  }

  const check = (locationId: string, kind: LocationGenerateKind): ConceptCheck => {
    const { demoMode, budget } = settings.get()
    const count = kind === 'concepts' ? LOCATION_CONCEPTS_PER_ROUND : LOCATION_ANGLES.length
    const base = { count, demoMode }
    const handle = projects.current()
    const card = handle?.repos.locationCards.get(locationId)
    if (!handle || !card)
      return { ...base, ok: false, issue: t('chat.couldnTFindThisLocation'), estimatedUsd: 0 }
    if (card.status === 'locked') {
      return {
        ...base,
        ok: false,
        issue: t('chat.thisLocationIsLockedUnlock'),
        estimatedUsd: 0,
      }
    }
    if (active.has(locationId)) {
      return {
        ...base,
        ok: false,
        issue: t('chat.thisLocationIsGeneratingPictures'),
        estimatedUsd: 0,
      }
    }
    if (kind === 'angles' && !assetRefOf(handle, card.mainAssetHash)) {
      return {
        ...base,
        ok: false,
        issue: t('chat.pickAMainLocationPicture'),
        estimatedUsd: 0,
      }
    }
    const model =
      kind === 'concepts'
        ? settingsService.resolveModel('t2i')
        : pickEditModel(settingsService, models)?.id
    if (!model) {
      return {
        ...base,
        ok: false,
        issue:
          kind === 'concepts' ? t('chat.noImageModelIsAvailable') : t('chat.thereSNoImageModel'),
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, { images: 1 }) * count
    const modelName = cardNameOf(models.get(model))
    const exceeded = checkBudget({
      budget,
      runProjectedUsd: estimatedUsd,
      projectBaseUsd: handle.repos.costs.totalUsd(handle.projectId),
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

  const generate = (locationId: string, kind: LocationGenerateKind): void => {
    const handle = need()
    const card = handle.repos.locationCards.get(locationId)
    if (!card) throw invalid(t('chat.couldnTFindThisLocation'))
    const checked = check(locationId, kind)
    if (!checked.ok) throw invalid(checked.issue ?? t('chat.canTGenerateRightNow'))
    const model =
      kind === 'concepts'
        ? settingsService.resolveModel('t2i')
        : pickEditModel(settingsService, models)?.id
    const main = assetRefOf(handle, card.mainAssetHash)
    if (!model || (kind === 'angles' && !main)) throw invalid(t('chat.canTGenerateRightNow'))
    const queue = runtime.queue()
    const tool = tools()
    if (!queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: t('chat.theGenerationServiceIsnT'),
      })
    }

    const { locationCards } = handle.repos
    const style = toStyle(handle.repos.projects.get().defaultStyleId)
    const subject = {
      name: card.name,
      description: card.description,
      ...(card.anchorText.trim() ? { anchor: card.anchorText } : {}),
    }
    const run: Active = {
      kind,
      controller: new AbortController(),
      done: 0,
      total: kind === 'concepts' ? LOCATION_CONCEPTS_PER_ROUND : LOCATION_ANGLES.length,
    }
    active.set(locationId, run)
    lastErrors.delete(locationId)
    changed(handle, locationId)

    const engine = createProjectEngine(handle, {
      registry,
      services: {
        [STUDIO_SERVICE_KEY]: createStudioServices({ queue, handle, tools: tool, models }),
      },
      priceLookup: (id, usage) => models.estimate(id, usage),
    })

    /** 跑一個工作流、取出圖片；失敗就丟出白話錯誤。 */
    const runImage = async (
      flow: Parameters<typeof engine.run>[0],
      item: unknown,
      outputId: string,
    ) => {
      const result = await engine.run(flow, {
        projectId: handle.projectId,
        signal: run.controller.signal,
        inputs: { item },
        budget: settings.get().budget,
      })
      const parsed = ImageOutputSchema.safeParse(result.outputs.get(outputId))
      if (!parsed.success) {
        const failed = result.nodeRuns.find((n) => n.status === 'failed')
        throw new AppError({
          code: failed?.error?.code ?? 'internal_error',
          retryable: failed?.error?.retryable ?? false,
          userMessage: failed?.error?.userMessage ?? t('chat.onePictureDidnTGenerate'),
        })
      }
      return parsed.data.image
    }

    const round = locationCards.nextConceptRound(locationId)
    const variationBase = Math.floor(now() / 1000) % 1_000_000_000
    const tasks: (() => Promise<void>)[] =
      kind === 'concepts'
        ? Array.from({ length: LOCATION_CONCEPTS_PER_ROUND }, (_, slot) => async () => {
            const image = await runImage(
              buildLocationConceptWorkflow({
                model,
                style,
                variation: round * LOCATION_CONCEPTS_PER_ROUND + slot,
              }),
              subject,
              'image',
            )
            if (handle.closed) return
            locationCards.addConcept({
              locationId,
              round,
              slot,
              assetHash: image.hash,
              modelId: model,
            })
            run.done++
            changed(handle, locationId)
          })
        : LOCATION_ANGLES.map((angle: LocationAngle, index) => async () => {
            if (!main) return
            const image = await runImage(
              buildLocationAngleWorkflow({ model, style, variation: variationBase + index }),
              { ...subject, main, angle },
              'angle',
            )
            if (handle.closed) return
            locationCards.setAngles(locationId, { [angle]: image.hash })
            run.done++
            changed(handle, locationId)
          })

    void Promise.allSettled(tasks.map((task) => task()))
      .then((results) => {
        const failures = results.flatMap((r) =>
          r.status === 'rejected' ? [r.reason as unknown] : [],
        )
        const [first] = failures
        if (failures.length === 0 || run.controller.signal.aborted) return
        const reason = isAppError(first)
          ? first.userMessage
          : t('chat.pictureGenerationFailedPleaseTry')
        if (!isAppError(first))
          log.error(`Unexpected error generating location pictures: ${String(first)}`)
        lastErrors.set(
          locationId,
          run.done > 0
            ? t('chat.picturesDidnTGenerate', { value: String(failures.length), reason })
            : reason,
        )
      })
      .finally(() => {
        // 專案被換掉（active 已清空）就不用再通知
        if (active.get(locationId) === run) {
          active.delete(locationId)
          changed(handle, locationId)
        }
      })
    log.info(
      `Started generating ${kind === 'concepts' ? 'concept pictures' : 'other angles'} for “${card.name}”`,
    )
  }

  return {
    list: () => projects.current()?.repos.locationCards.list() ?? [],

    setAnchor(locationId, text) {
      if (text.length > LOCATION_ANCHOR_MAX) {
        throw invalid(
          t('chat.keepTheLocationDescriptionUnder', { value: String(LOCATION_ANCHOR_MAX) }),
        )
      }
      return need().repos.locationCards.setAnchor(locationId, text)
    },

    images(locationId) {
      const handle = projects.current()
      return handle ? stateOf(handle, locationId) : { locationId, concepts: [] }
    },

    check,
    generate,

    cancel(locationId) {
      active.get(locationId)?.controller.abort()
    },

    pickMain(locationId, conceptId) {
      if (active.has(locationId)) throw invalid(t('chat.picturesAreBeingGeneratedPick'))
      return need().repos.locationCards.pickMain(locationId, conceptId)
    },

    lock(locationId) {
      if (active.has(locationId)) throw invalid(t('chat.picturesAreBeingGeneratedLock'))
      return need().repos.locationCards.lock(locationId)
    },

    unlock: (locationId) => need().repos.locationCards.unlock(locationId),

    references: (locationId) => ({
      locationId,
      references: need().repos.locationCards.listReferences(locationId),
    }),

    addReference({ locationId, assetHash, purpose, label }) {
      const handle = need()
      const meta = handle.assets.getMeta(assetHash)
      if (!meta?.mime.startsWith('image/')) {
        throw invalid(t('chat.couldnTFindThisPicture2'))
      }
      handle.repos.locationCards.addReference({ locationId, assetHash, purpose, label })
      return { locationId, references: handle.repos.locationCards.listReferences(locationId) }
    },

    removeReference(locationId, referenceId) {
      const handle = need()
      handle.repos.locationCards.removeReference(locationId, referenceId)
      return { locationId, references: handle.repos.locationCards.listReferences(locationId) }
    },
  }
}
