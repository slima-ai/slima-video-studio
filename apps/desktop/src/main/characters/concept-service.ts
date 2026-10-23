import { outfitOf, type ProjectHandle } from '@svs/db'
import { budgetExceededError, checkBudget, createRegistry } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  AssetRefSchema,
  CONCEPTS_PER_ROUND,
  isAppError,
  resolveCharacterPrompt,
  CHARACTER_REFERENCE_PURPOSES,
  CHARACTER_REFERENCE_PURPOSE_LABELS,
  type AssetRef,
  type CharacterReferencePurpose,
  type ConceptCheck,
  type ConceptsState,
  type ReferenceView,
  type ReferencesState,
  t,
  cardNameOf,
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
import { UPLOAD_MODEL } from '../shots/shot-service'
import { createStudioServices } from '../studio-services'
import { assetRefOf, pickEditModel } from './anchors'

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
  /** 這個角色的參考圖清單（有用途標記；含在畫布上接到「參考圖」的圖）。 */
  references: (characterId: string) => ReferencesState
  /** 把專案裡已有的一張圖片加成參考圖並標上用途；之後的概念圖照它們畫。同一張圖同一個用途只有一筆。 */
  addReference: (input: {
    characterId: string
    assetHash: string
    purpose: CharacterReferencePurpose
    label?: string
  }) => ReferencesState
  /** 移除一張用 addReference 存的參考圖（圖留在專案裡）。 */
  removeReference: (characterId: string, referenceId: string) => ReferencesState
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

  /**
   * 這個角色所有的參考圖：用「加參考圖」存的（有用途標記），加上以前在畫布上把圖接到「參考圖」接點的
   * （存成模型是 upload 的概念圖，用途視為 general）。同一張圖只算一次。
   */
  const listReferences = (handle: ProjectHandle, characterId: string): ReferenceView[] => {
    const { characters } = handle.repos
    const added = characters.listReferences(characterId)
    const seen = new Set(added.map((r) => r.assetHash))
    const fromCanvas = characters
      .listConcepts(characterId)
      .filter((concept) => concept.modelId === UPLOAD_MODEL)
      .flatMap((concept): ReferenceView[] => {
        if (seen.has(concept.assetHash)) return []
        seen.add(concept.assetHash)
        return [
          {
            id: concept.id,
            assetHash: concept.assetHash,
            purpose: 'general',
            label: '',
            createdAt: concept.createdAt,
            source: 'canvas',
          },
        ]
      })
    return [...added, ...fromCanvas]
  }

  /**
   * 這次生成實際會用的參考圖：臉、身體、三視圖排在前面（模型收得下的張數有限，先留最重要的），
   * 同一張圖只送一次（用第一個用途），專案裡找不到檔案的略過，最多 `limit` 張。
   */
  const usableReferences = (
    handle: ProjectHandle,
    characterId: string,
    limit: number,
  ): { ref: AssetRef; purpose: CharacterReferencePurpose }[] => {
    const rank = (purpose: CharacterReferencePurpose): number =>
      CHARACTER_REFERENCE_PURPOSES.indexOf(purpose)
    const seen = new Set<string>()
    const usable: { ref: AssetRef; purpose: CharacterReferencePurpose }[] = []
    const ordered = listReferences(handle, characterId)
      .map((reference, index) => ({ reference, index }))
      .sort((a, b) => rank(a.reference.purpose) - rank(b.reference.purpose) || a.index - b.index)
    for (const { reference } of ordered) {
      if (seen.has(reference.assetHash)) continue
      const ref = assetRefOf(handle, reference.assetHash)
      if (!ref) continue
      seen.add(reference.assetHash)
      usable.push({ ref, purpose: reference.purpose })
    }
    return usable.slice(0, Math.max(limit, 0))
  }

  /** 有參考圖就要用做得到「參考圖再生成」的模型，沒有就是平常的文字生圖模型。 */
  const modelFor = (
    handle: ProjectHandle,
    characterId: string,
  ): { id?: string; referenceLimit: number; withReferences: boolean } => {
    if (usableReferences(handle, characterId, Number.MAX_SAFE_INTEGER).length === 0) {
      const id = settingsService.resolveModel('t2i')
      return { ...(id ? { id } : {}), referenceLimit: 0, withReferences: false }
    }
    const edit = pickEditModel(settingsService, models)
    return {
      ...(edit ? { id: edit.id } : {}),
      referenceLimit: edit?.referenceLimit ?? 0,
      withReferences: true,
    }
  }

  const check = (characterId: string): ConceptCheck => {
    const { demoMode, budget } = settings.get()
    const handle = projects.current()
    const base = { count: CONCEPTS_PER_ROUND, demoMode }
    if (!handle?.repos.characters.get(characterId)) {
      return { ...base, ok: false, issue: t('chat.couldnTFindThisCharacter2'), estimatedUsd: 0 }
    }
    const { id: model, referenceLimit, withReferences } = modelFor(handle, characterId)
    const references = withReferences
      ? usableReferences(handle, characterId, referenceLimit).length
      : 0
    if (!model) {
      return {
        ...base,
        references,
        ok: false,
        issue: withReferences
          ? t('chat.thisCharacterHasReferencePictures')
          : t('chat.noImageModelIsAvailable'),
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, { images: 1 }) * CONCEPTS_PER_ROUND
    const modelName = cardNameOf(models.get(model))
    const exceeded = checkBudget({
      budget,
      runProjectedUsd: estimatedUsd,
      projectBaseUsd: handle.repos.costs.totalUsd(handle.projectId),
    })
    return {
      ...base,
      references,
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
    if (active.has(characterId)) throw invalid(t('chat.thisCharacterSConceptPictures'))
    const checked = check(characterId)
    const { id: model, referenceLimit, withReferences } = modelFor(handle, characterId)
    if (!checked.ok || !model) throw invalid(checked.issue ?? t('chat.conceptPicturesCanTBe'))
    const used = withReferences ? usableReferences(handle, characterId, referenceLimit) : []
    const references = used.map((u) => u.ref)
    const queue = runtime.queue()
    const tool = tools()
    if (!queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: t('chat.theGenerationServiceIsnT'),
      })
    }

    const { characters } = handle.repos
    const subject = {
      ...(references.length > 0
        ? {
            references,
            referencePurposes: used.map((u) => CHARACTER_REFERENCE_PURPOSE_LABELS[u.purpose]),
          }
        : {}),
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
        buildConceptWorkflow({
          model,
          style,
          variation: round * CONCEPTS_PER_ROUND + slot,
          withReferences: references.length > 0,
          template: resolveCharacterPrompt(
            settings.get().characterPrompts[references.length > 0 ? 'conceptRef' : 'concept'],
            references.length > 0 ? 'conceptRef' : 'concept',
          ),
        }),
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
          userMessage: failed?.error?.userMessage ?? t('chat.onePictureDidnTGenerate'),
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
        const reason = isAppError(first)
          ? first.userMessage
          : t('chat.conceptPicturesFailedToGenerate')
        if (!isAppError(first))
          log.error(`Unexpected error generating concept pictures: ${String(first)}`)
        lastErrors.set(
          characterId,
          run.done > 0
            ? t('chat.picturesDidnTGenerate', { value: String(failures.length), reason })
            : reason,
        )
      })
      .finally(() => {
        // 專案被換掉（active 已清空）就不用再通知
        if (active.get(characterId) === run) {
          active.delete(characterId)
          changed(handle, characterId)
        }
      })
    log.info(
      `開始生成「${character.name}」的概念圖（第 ${String(round)} 輪${
        references.length > 0 ? `，照 ${String(references.length)} 張參考圖` : ''
      }）`,
    )
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
    references(characterId) {
      const handle = projects.current()
      return handle
        ? { characterId, references: listReferences(handle, characterId) }
        : { characterId, references: [] }
    },
    addReference({ characterId, assetHash, purpose, label }) {
      const handle = projects.current()
      if (!handle || handle.closed || !handle.repos.characters.get(characterId)) {
        throw invalid(t('chat.couldnTFindThisCharacter2'))
      }
      if (!assetRefOf(handle, assetHash)) {
        throw invalid(t('chat.couldnTFindThisPicture'))
      }
      handle.repos.characters.addReference({
        characterId,
        assetHash,
        purpose,
        ...(label === undefined ? {} : { label }),
      })
      return { characterId, references: listReferences(handle, characterId) }
    },
    removeReference(characterId, referenceId) {
      const handle = projects.current()
      if (!handle || handle.closed || !handle.repos.characters.get(characterId)) {
        throw invalid(t('chat.couldnTFindThisCharacter2'))
      }
      const found = listReferences(handle, characterId).find((r) => r.id === referenceId)
      if (found?.source === 'canvas') {
        throw invalid(t('chat.thisPictureIsConnectedTo'))
      }
      if (!handle.repos.characters.removeReference(characterId, referenceId)) {
        throw invalid(t('chat.couldnTFindThisReference'))
      }
      return { characterId, references: listReferences(handle, characterId) }
    },
  }
}
