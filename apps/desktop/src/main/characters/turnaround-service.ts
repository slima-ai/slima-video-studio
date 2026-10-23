import { outfitOf, type ProjectHandle } from '@svs/db'
import { budgetExceededError, checkBudget, createRegistry } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  DEFAULT_TURNAROUND_CUTS,
  TURNAROUNDS_PER_ROUND,
  TurnaroundCutsSchema,
  isAppError,
  resolveCharacterPrompt,
  type AssetRef,
  type ConceptCheck,
  type TurnaroundCuts,
  type TurnaroundView,
  type TurnaroundsState,
  t,
} from '@svs/schema'
import {
  QUICK_STYLE_IDS,
  STUDIO_SERVICE_KEY,
  buildTurnaroundWorkflow,
  registerQuickStartNodes,
  type QuickStyleId,
} from '@svs/workflows'
import { z } from 'zod'

import type { Logger } from '../logger'
import { createProjectEngine } from '../project-engine'
import type { ProjectManager } from '../project-manager'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import { createStudioServices } from '../studio-services'
import { assetRefOf, pickEditModel } from './anchors'
import { sliceSheet } from './slice-sheet'

export interface TurnaroundServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
}

export interface TurnaroundService {
  state: (characterId: string) => TurnaroundsState
  check: (characterId: string) => ConceptCheck
  /** 開始生成新的一輪（背景執行）；進度與結果用 characters.turnaroundsChanged 推送。 */
  generate: (characterId: string) => void
  cancel: (characterId: string) => void
  /** 調整切線位置，用同一張設定稿重新切。 */
  reslice: (
    characterId: string,
    turnaroundId: string,
    cuts: TurnaroundCuts,
  ) => Promise<TurnaroundView>
}

const ImageOutputSchema = z.object({ image: AssetRefSchema })

const toStyle = (id: string | undefined): QuickStyleId =>
  QUICK_STYLE_IDS.find((s) => s === id) ?? 'realistic'

interface Active {
  controller: AbortController
  done: number
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 角色三視圖：以主圖當參考，用「帶參考圖的圖片編輯」模型生成橫式設定稿（正面／側面／背面並排），
 * 切成三張；一輪 4 組候選讓使用者挑。每張設定稿都是一次完整的引擎執行，花費入帳、預算上限、取消都一樣。
 */
export function createTurnaroundService(deps: TurnaroundServiceDeps): TurnaroundService {
  const { projects, runtime, settings, settingsService, models, broadcast, log } = deps
  const tools = deps.tools ?? findTools
  const registry = createRegistry()
  registerQuickStartNodes(registry)
  const active = new Map<string, Active>()
  const lastErrors = new Map<string, string>()

  projects.onChange(() => {
    for (const run of active.values()) run.controller.abort()
    active.clear()
    lastErrors.clear()
  })

  const stateOf = (handle: ProjectHandle, characterId: string): TurnaroundsState => {
    const running = active.get(characterId)
    const error = lastErrors.get(characterId)
    return {
      characterId,
      turnarounds: handle.repos.characters.listTurnarounds(characterId),
      ...(running ? { generating: { done: running.done, total: TURNAROUNDS_PER_ROUND } } : {}),
      ...(error ? { error } : {}),
    }
  }

  const changed = (handle: ProjectHandle, characterId: string): void => {
    if (!handle.closed && projects.current() === handle) {
      broadcast('characters.turnaroundsChanged', stateOf(handle, characterId))
    }
  }

  const editModel = (): string | undefined => pickEditModel(settingsService, models)?.id

  const heroRef = (handle: ProjectHandle, characterId: string): AssetRef | undefined =>
    assetRefOf(handle, handle.repos.characters.pack(characterId)?.heroAssetHash)

  const check = (characterId: string): ConceptCheck => {
    const { demoMode, budget } = settings.get()
    const model = editModel()
    const handle = projects.current()
    const base = { count: TURNAROUNDS_PER_ROUND, demoMode }
    if (!handle?.repos.characters.get(characterId)) {
      return { ...base, ok: false, issue: t('chat.couldnTFindThisCharacter2'), estimatedUsd: 0 }
    }
    if (!heroRef(handle, characterId)) {
      return {
        ...base,
        ok: false,
        issue: t('chat.pickAMainPictureFrom'),
        estimatedUsd: 0,
      }
    }
    if (!model) {
      return {
        ...base,
        ok: false,
        issue: t('chat.thereSNoImageModel'),
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, { images: 1 }) * TURNAROUNDS_PER_ROUND
    const modelName = models.get(model)?.displayName
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

  const generate = (characterId: string): void => {
    const handle = projects.current()
    const character = handle?.repos.characters.get(characterId)
    if (!handle || !character) throw invalid(t('chat.couldnTFindThisCharacter2'))
    if (active.has(characterId)) throw invalid(t('chat.thisCharacterSTurnaroundIs'))
    const checked = check(characterId)
    const model = editModel()
    const hero = heroRef(handle, characterId)
    if (!checked.ok || !model || !hero) throw invalid(checked.issue ?? t('chat.aTurnaroundCanTBe'))
    const queue = runtime.queue()
    const tool = tools()
    if (!queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: t('chat.theGenerationServiceIsnT'),
      })
    }

    const { characters } = handle.repos
    const anchor = characters.pack(characterId)?.anchorText
    const subject = {
      name: character.name,
      appearance: character.appearance,
      outfit: outfitOf(character),
      ...(anchor ? { anchor } : {}),
      hero,
    }
    const style = toStyle(handle.repos.projects.get().defaultStyleId)
    const round = characters.nextTurnaroundRound(characterId)
    const run: Active = { controller: new AbortController(), done: 0 }
    active.set(characterId, run)
    lastErrors.delete(characterId)
    changed(handle, characterId)

    const engine = createProjectEngine(handle, {
      registry,
      services: {
        [STUDIO_SERVICE_KEY]: createStudioServices({ queue, handle, tools: tool, models }),
      },
      priceLookup: (id, usage) => models.estimate(id, usage),
    })

    const one = async (slot: number): Promise<void> => {
      const result = await engine.run(
        buildTurnaroundWorkflow({
          model,
          style,
          variation: round * TURNAROUNDS_PER_ROUND + slot,
          template: resolveCharacterPrompt(
            settings.get().characterPrompts.turnaround,
            'turnaround',
          ),
        }),
        {
          projectId: handle.projectId,
          signal: run.controller.signal,
          inputs: { item: subject },
          budget: settings.get().budget,
        },
      )
      const parsed = ImageOutputSchema.safeParse(result.outputs.get('sheet'))
      if (!parsed.success) {
        const failed = result.nodeRuns.find((n) => n.status === 'failed')
        throw new AppError({
          code: failed?.error?.code ?? 'internal_error',
          retryable: failed?.error?.retryable ?? false,
          userMessage: failed?.error?.userMessage ?? t('chat.oneTurnaroundDidnTGenerate'),
        })
      }
      const sheetHash = parsed.data.image.hash
      const slices = await sliceSheet(
        handle,
        tool,
        sheetHash,
        DEFAULT_TURNAROUND_CUTS,
        run.controller.signal,
      )
      if (handle.closed) return
      characters.addTurnaround({
        characterId,
        round,
        slot,
        sheetHash,
        ...slices,
        cuts: DEFAULT_TURNAROUND_CUTS,
        heroHash: hero.hash,
        modelId: model,
      })
      run.done++
      changed(handle, characterId)
    }

    void Promise.allSettled(Array.from({ length: TURNAROUNDS_PER_ROUND }, (_, slot) => one(slot)))
      .then((results) => {
        const failures = results.flatMap((r) =>
          r.status === 'rejected' ? [r.reason as unknown] : [],
        )
        const [first] = failures
        if (failures.length === 0 || run.controller.signal.aborted) return
        const reason = isAppError(first)
          ? first.userMessage
          : t('chat.theTurnaroundFailedToGenerate')
        if (!isAppError(first)) log.error(`三視圖生成發生未預期錯誤：${String(first)}`)
        lastErrors.set(
          characterId,
          run.done > 0
            ? t('chat.turnaroundsDidnTGenerate', { value: String(failures.length), reason })
            : reason,
        )
      })
      .finally(() => {
        if (active.get(characterId) === run) {
          active.delete(characterId)
          changed(handle, characterId)
        }
      })
    log.info(`開始生成「${character.name}」的三視圖（第 ${String(round)} 輪）`)
  }

  return {
    state(characterId) {
      const handle = projects.current()
      return handle ? stateOf(handle, characterId) : { characterId, turnarounds: [] }
    },
    check,
    generate,
    cancel(characterId) {
      active.get(characterId)?.controller.abort()
    },

    async reslice(characterId, turnaroundId, cutsInput) {
      const handle = projects.current()
      const tool = tools()
      if (!handle || !tool) throw invalid(t('chat.openAProjectFirst'))
      const cuts = TurnaroundCutsSchema.parse(cutsInput)
      const current = handle.repos.characters.getTurnaround(characterId, turnaroundId)
      if (!current) throw invalid(t('chat.couldnTFindThisTurnaround'))
      const slices = await sliceSheet(handle, tool, current.sheetHash, cuts)
      const updated = handle.repos.characters.updateTurnaroundSlices(characterId, turnaroundId, {
        ...slices,
        cuts,
      })
      changed(handle, characterId)
      return updated
    },
  }
}
