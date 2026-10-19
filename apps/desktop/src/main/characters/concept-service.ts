import { outfitOf, type ProjectHandle } from '@svs/db'
import { budgetExceededError, checkBudget, createRegistry } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  CONCEPTS_PER_ROUND,
  isAppError,
  type ConceptCheck,
  type ConceptsState,
} from '@svs/schema'
import {
  QUICK_STYLE_IDS,
  STUDIO_SERVICE_KEY,
  buildConceptWorkflow,
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

export interface ConceptServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
}

export interface ConceptService {
  state: (characterId: string) => ConceptsState
  check: (characterId: string) => ConceptCheck
  /** 開始生成新的一輪（背景執行）；進度與結果用 characters.conceptsChanged 推送。 */
  generate: (characterId: string) => void
  cancel: (characterId: string) => void
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
 * 角色概念圖：一輪生成 4 張候選（各用不同的變化編號），存進專案，讓使用者挑一張當主圖。
 * 每張圖都是一次完整的引擎執行，所以花費入帳、預算上限、快取都跟其他生成一樣。
 */
export function createConceptService(deps: ConceptServiceDeps): ConceptService {
  const { projects, runtime, settings, settingsService, models, broadcast, log } = deps
  const tools = deps.tools ?? findTools
  const registry = createRegistry()
  registerQuickStartNodes(registry)
  /** 正在生成的角色。 */
  const active = new Map<string, Active>()
  /** 最近一次生成沒有完全成功的原因（下一次生成時清掉）。 */
  const lastErrors = new Map<string, string>()

  projects.onChange(() => {
    for (const run of active.values()) run.controller.abort()
    active.clear()
    lastErrors.clear()
  })

  const stateOf = (handle: ProjectHandle, characterId: string): ConceptsState => {
    const running = active.get(characterId)
    const error = lastErrors.get(characterId)
    return {
      characterId,
      concepts: handle.repos.characters.listConcepts(characterId),
      ...(running ? { generating: { done: running.done, total: CONCEPTS_PER_ROUND } } : {}),
      ...(error ? { error } : {}),
    }
  }

  const changed = (handle: ProjectHandle, characterId: string): void => {
    if (!handle.closed && projects.current() === handle) {
      broadcast('characters.conceptsChanged', stateOf(handle, characterId))
    }
  }

  const imageModel = (): string | undefined => settingsService.resolveModel('t2i')

  const check = (characterId: string): ConceptCheck => {
    const { demoMode, budget } = settings.get()
    const model = imageModel()
    const handle = projects.current()
    const base = { count: CONCEPTS_PER_ROUND, demoMode }
    if (!handle?.repos.characters.get(characterId)) {
      return { ...base, ok: false, issue: '找不到這個角色。', estimatedUsd: 0 }
    }
    if (!model) {
      return {
        ...base,
        ok: false,
        issue: '還沒有可用的圖片模型：請到設定填入 fal.ai 的服務金鑰（或打開示範模式）。',
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, { images: 1 }) * CONCEPTS_PER_ROUND
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
    if (!handle || !character) throw invalid('找不到這個角色。')
    if (active.has(characterId)) throw invalid('這個角色的概念圖正在生成中。')
    const checked = check(characterId)
    const model = imageModel()
    if (!checked.ok || !model) throw invalid(checked.issue ?? '現在不能生成概念圖。')
    const queue = runtime.queue()
    const tool = tools()
    if (!queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '生成服務還沒準備好，請重新啟動 App。',
      })
    }

    const { characters } = handle.repos
    const subject = {
      name: character.name,
      ...(character.age ? { age: character.age } : {}),
      appearance: character.appearance,
      outfit: outfitOf(character),
      ...(characters.pack(characterId)?.anchorText
        ? { anchor: characters.pack(characterId)?.anchorText }
        : {}),
    }
    const style = toStyle(handle.repos.projects.get().defaultStyleId)
    const round = characters.nextConceptRound(characterId)
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
        buildConceptWorkflow({ model, style, variation: round * CONCEPTS_PER_ROUND + slot }),
        {
          projectId: handle.projectId,
          signal: run.controller.signal,
          inputs: { item: subject },
          budget: settings.get().budget,
        },
      )
      const parsed = ImageOutputSchema.safeParse(result.outputs.get('image'))
      if (!parsed.success) {
        const failed = result.nodeRuns.find((n) => n.status === 'failed')
        throw new AppError({
          code: failed?.error?.code ?? 'internal_error',
          retryable: failed?.error?.retryable ?? false,
          userMessage: failed?.error?.userMessage ?? '有一張圖沒有生成成功。',
        })
      }
      if (handle.closed) return
      characters.addConcept({
        characterId,
        round,
        slot,
        assetHash: parsed.data.image.hash,
        modelId: model,
      })
      run.done++
      changed(handle, characterId)
    }

    void Promise.allSettled(Array.from({ length: CONCEPTS_PER_ROUND }, (_, slot) => one(slot)))
      .then((results) => {
        const failures = results.flatMap((r) =>
          r.status === 'rejected' ? [r.reason as unknown] : [],
        )
        const [first] = failures
        if (failures.length === 0 || run.controller.signal.aborted) return
        const reason = isAppError(first) ? first.userMessage : '概念圖生成失敗，請再試一次。'
        if (!isAppError(first)) log.error(`概念圖生成發生未預期錯誤：${String(first)}`)
        lastErrors.set(
          characterId,
          run.done > 0 ? `有 ${String(failures.length)} 張沒有成功：${reason}` : reason,
        )
      })
      .finally(() => {
        // 專案被換掉（active 已清空）就不用再通知
        if (active.get(characterId) === run) {
          active.delete(characterId)
          changed(handle, characterId)
        }
      })
    log.info(`開始生成「${character.name}」的概念圖（第 ${String(round)} 輪）`)
  }

  return {
    state(characterId) {
      const handle = projects.current()
      return handle ? stateOf(handle, characterId) : { characterId, concepts: [] }
    },
    check,
    generate,
    cancel(characterId) {
      active.get(characterId)?.controller.abort()
    },
  }
}
