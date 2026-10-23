import type { ProjectHandle } from '@svs/db'
import { budgetExceededError, checkBudget } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  OutlineOpSchema,
  OutlineTextSchema,
  storyLanguageNote,
  type OutlineOp,
  type OutlineSplitCheck,
  type OutlineSplitResult,
  type OutlineView,
  messageVariants,
  t,
  cardNameOf,
} from '@svs/schema'
import { generateStructured } from '@svs/workflows'
import { z } from 'zod'

import { ensureProject } from '../ensure-project'
import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { findTools, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import { createStudioServices } from '../studio-services'

export interface OutlineServiceDeps {
  projects: ProjectManager
  /** 還沒有開啟專案時，新增內容會自動建一個，放在這個資料夾。 */
  projectsDir: string
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
  now?: () => Date
}

export interface OutlineService {
  get: () => OutlineView
  edit: (op: OutlineOp) => OutlineView
  splitCheck: (text: string) => OutlineSplitCheck
  split: (text: string) => Promise<OutlineSplitResult>
}

/** 請 AI 輸出的格式：幕 → 場，加上故事裡出現的角色與地點。 */
const LlmOutlineSchema = z.object({
  acts: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().default(''),
        scenes: z
          .array(
            z.object({
              title: z.string().min(1),
              summary: z.string().default(''),
              /** 發生在哪個地點（用 locations 裡的名字）；不確定就 null。 */
              location: z.string().nullable().default(null),
              timeOfDay: z.string().nullable().default(null),
              mood: z.string().nullable().default(null),
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .max(8),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        age: z.string().nullable().default(null),
        appearance: z.string().default(''),
        outfit: z.string().default(''),
        personality: z.string().default(''),
        /** 精簡的固定外觀描述（只寫看得到的特徵）；文字裡沒寫到就留空。 */
        anchor: z.string().default(''),
      }),
    )
    .default([]),
  locations: z
    .array(z.object({ name: z.string().min(1), description: z.string().default('') }))
    .default([]),
})

const SYSTEM =
  '你是短片的編劇助手。把使用者貼上的故事或劇本，整理成「幕 → 場」的大綱：' +
  '分成 1 到 8 幕，每幕有幾個場；一個場是在同一個地點、同一段時間連續發生的事。' +
  '場的標題要短，摘要用白話寫這個場裡看得到的事，不要寫抽象的感受。' +
  '另外列出故事裡出現的角色（只寫文字裡有提到的特徵，沒寫到的不要編造）和地點。' +
  '場的 location 必須是 locations 裡的名字，不確定就填 null。只輸出 JSON。'

/** App 自己加的預設名字（新增幕、場、地點時給的）；判斷故事語言時不算使用者寫的內容 */
export function isPlaceholderName(text: string): boolean {
  const trimmed = text.trim()
  return (
    /^(第 \d+ 幕|Act \d+|New location \d+|新的地點 \d+)$/u.test(trimmed) ||
    messageVariants('outline.newScene').includes(trimmed)
  )
}

/**
 * 拆大綱給文字模型的 system prompt：SYSTEM ＋ 已經建好的角色；故事不是中文時多一句「用故事的語言寫、名字照原文」
 * （沒有這一句，英文故事會得到中文的大綱，連角色名都被翻掉）。中文故事的內容一字不變。
 */
export function outlineSystemPrompt(text: string, knownCharacters: readonly string[]): string {
  const known =
    knownCharacters.length > 0
      ? `已經建好的角色有：${knownCharacters.join('、')}。故事裡出現他們時請沿用一模一樣的名字，也不用再列在 characters 裡。`
      : ''
  return (
    SYSTEM +
    known +
    storyLanguageNote(
      text,
      '故事不是中文：幕與場的標題和摘要、角色與地點的名字和描述，請用故事使用的語言寫；角色與地點的名字照故事原文，不要翻成中文。',
    )
  )
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 大綱：幕 → 場的編輯，以及讓 AI 把貼上的文字拆成分場、順便抽出角色（草稿）與地點。 */
export function createOutlineService(deps: OutlineServiceDeps): OutlineService {
  const { projects, settings, settingsService, models, runtime, log } = deps
  const tools = deps.tools ?? findTools
  const now = deps.now ?? (() => new Date())

  const viewOf = (handle: ProjectHandle): OutlineView => {
    const { outline } = handle.repos
    const scenes = outline.listScenes()
    return {
      acts: outline.listActs().map((act) => ({
        id: act.id,
        title: act.title,
        summary: act.summary,
        scenes: scenes
          .filter((scene) => scene.actId === act.id)
          .map((scene) => ({
            id: scene.id,
            title: scene.title,
            summary: scene.summary,
            ...(scene.locationId ? { locationId: scene.locationId } : {}),
            ...(scene.timeOfDay ? { timeOfDay: scene.timeOfDay } : {}),
            ...(scene.mood ? { mood: scene.mood } : {}),
          })),
      })),
      locations: outline.listLocations().map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
      })),
    }
  }

  const needProject = (): ProjectHandle => {
    const handle = projects.current()
    if (!handle) throw invalid(t('services.noProjectIsOpenAdd'))
    return handle
  }

  const applyOp = (handle: ProjectHandle, op: OutlineOp): void => {
    const { outline } = handle.repos
    switch (op.op) {
      case 'addAct': {
        const act = outline.addAct({
          title: t('outline.actNumber', { value: String(outline.listActs().length + 1) }),
        })
        outline.addScene(act.id, { title: t('outline.newScene') })
        return
      }
      case 'updateAct':
        outline.updateAct(op.actId, op.patch)
        return
      case 'deleteAct':
        outline.deleteAct(op.actId)
        return
      case 'moveAct':
        outline.moveAct(op.actId, op.direction)
        return
      case 'addScene':
        outline.addScene(op.actId, { title: t('outline.newScene') })
        return
      case 'updateScene':
        outline.updateScene(op.sceneId, op.patch)
        return
      case 'deleteScene':
        outline.deleteScene(op.sceneId)
        return
      case 'moveScene':
        outline.moveScene(op.sceneId, op.direction)
        return
      case 'addLocation':
        outline.addLocation({
          name: t('outline.newLocationNumber', {
            value: String(outline.listLocations().length + 1),
          }),
        })
        return
      case 'updateLocation':
        outline.updateLocation(op.locationId, op.patch)
        return
      case 'deleteLocation':
        outline.deleteLocation(op.locationId)
        return
    }
  }

  const splitCheck = (text: string): OutlineSplitCheck => {
    const { demoMode, budget } = settings.get()
    const model = settingsService.resolveModel('llm')
    const handle = projects.current()
    const base = {
      demoMode,
      replacesExisting: (handle?.repos.outline.listActs().length ?? 0) > 0,
    }
    if (!model) {
      return {
        ...base,
        ok: false,
        issue: t('services.noTextModelIsAvailable'),
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, {
      inputTokens: Math.ceil(text.length * 1.5) + 800,
      outputTokens: 3000,
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

  return {
    get() {
      const handle = projects.current()
      return handle ? viewOf(handle) : { acts: [], locations: [] }
    },

    edit(rawOp) {
      const op = OutlineOpSchema.parse(rawOp)
      if (op.op === 'addAct' || op.op === 'addLocation') {
        ensureProject(projects, deps.projectsDir, t('services.myShortFilm'), now())
      }
      const handle = needProject()
      applyOp(handle, op)
      return viewOf(handle)
    },

    splitCheck,

    async split(rawText) {
      const text = OutlineTextSchema.parse(rawText)
      const checked = splitCheck(text)
      const model = settingsService.resolveModel('llm')
      if (!checked.ok || !model) throw invalid(checked.issue ?? t('services.canTSplitIntoScenes'))
      ensureProject(projects, deps.projectsDir, text, now())
      const handle = needProject()
      const queue = runtime.queue()
      const tool = tools()
      if (!queue || !tool) {
        throw new AppError({
          code: 'internal_error',
          userMessage: t('services.theGenerationServiceIsnT'),
        })
      }

      const { outline, characters } = handle.repos
      const knownCharacters = characters.list().map((c) => c.name)
      const studio = createStudioServices({ queue, handle, tools: tool, models })
      const result = await generateStructured(
        studio,
        {
          modelId: model,
          system: outlineSystemPrompt(text, knownCharacters),
          messages: [{ role: 'user', content: text }],
        },
        LlmOutlineSchema,
        { signal: new AbortController().signal },
      )
      // 單獨呼叫不會經過引擎，自己記到花費帳本
      if (result.costUsd !== undefined && !handle.closed) {
        handle.repos.costs.record({
          projectId: handle.projectId,
          provider: result.provider,
          modelId: model,
          amountUsd: result.costUsd,
          estimated: false,
          jobId: result.jobId,
        })
      }
      if (handle.closed) throw invalid(t('services.theProjectWasClosedSo'))

      // 地點：名字一樣的沿用，沒有的才新增
      const locationIds = new Map(outline.listLocations().map((l) => [l.name, l.id]))
      const newLocations: string[] = []
      for (const place of result.data.locations) {
        if (locationIds.has(place.name)) continue
        locationIds.set(
          place.name,
          outline.addLocation({ name: place.name, description: place.description }).id,
        )
        newLocations.push(place.name)
      }

      outline.clear()
      for (const act of result.data.acts) {
        const created = outline.addAct({ title: act.title, summary: act.summary })
        for (const scene of act.scenes) {
          const locationId = scene.location ? locationIds.get(scene.location) : undefined
          outline.addScene(created.id, {
            title: scene.title,
            summary: scene.summary,
            ...(locationId ? { locationId } : {}),
            ...(scene.timeOfDay ? { timeOfDay: scene.timeOfDay } : {}),
            ...(scene.mood ? { mood: scene.mood } : {}),
          })
        }
      }

      // 角色：名字沒出現過的才建立；固定外觀描述存成草稿（要使用者確認後自己鎖定）
      const newCharacters: string[] = []
      for (const person of result.data.characters) {
        if (characters.list().some((c) => c.name === person.name)) continue
        const created = characters.create(person.name)
        characters.update(created.id, {
          ...(person.age ? { age: person.age } : {}),
          appearance: person.appearance,
          outfit: person.outfit,
          personality: person.personality,
        })
        if (person.anchor.trim() !== '') characters.setAnchor(created.id, person.anchor)
        newCharacters.push(person.name)
      }

      log.info(
        `大綱已拆好：${String(result.data.acts.length)} 幕，新增 ${String(newCharacters.length)} 個角色、${String(newLocations.length)} 個地點`,
      )
      return { outline: viewOf(handle), newCharacters, newLocations }
    },
  }
}
