import { budgetExceededError, checkBudget } from '@svs/engine'
import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  CAMERA_MOVES,
  CAMERA_MOVE_IDS,
  StoryboardShotSchema,
  resolveStoryboardGuide,
  storyboardGuidePrompt,
  type ShotsSnapshot,
  type StoryboardSplitCheck,
} from '@svs/schema'
import {
  QUICK_STYLES,
  QUICK_STYLE_IDS,
  generateStructured,
  type QuickStyleId,
} from '@svs/workflows'
import { z } from 'zod'

import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { findTools, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import type { ShotService } from '../shots/shot-service'
import { createStudioServices } from '../studio-services'

export interface StoryboardServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  shots: ShotService
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
}

export interface StoryboardService {
  splitCheck: (sceneId: string) => StoryboardSplitCheck
  /** 讓 AI 把某個場拆成鏡頭，這個場原本的鏡頭會被換掉。 */
  splitScene: (sceneId: string) => Promise<ShotsSnapshot>
}

/** 請 AI 輸出的格式：運鏡只能從預設清單挑。 */
const LlmStoryboardSchema = z.object({
  shots: z
    .array(
      StoryboardShotSchema.omit({ cameraMove: true }).extend({
        cameraMove: z.enum(CAMERA_MOVE_IDS).nullable().default(null),
      }),
    )
    .min(1)
    .max(12),
})

const SIZE_HINTS =
  '景別 size 只能是：extreme_wide（大遠景）、wide（遠景）、full（全景）、medium（中景）、close_up（近景）、extreme_close_up（特寫）'
const ANGLE_HINTS =
  '拍攝角度 angle 只能是：eye_level（平視）、high（俯拍）、low（仰拍）、overhead（正上方）、over_shoulder（過肩）、side（側面）、back（背面）、dutch（傾斜）'

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

const toStyle = (id: string | undefined): QuickStyleId =>
  QUICK_STYLE_IDS.find((s) => s === id) ?? 'realistic'

/** 分鏡：讓 AI 把大綱裡的某個場，依劇情拆成幾個鏡頭（景別、角度、運鏡、台詞、光線）。 */
export function createStoryboardService(deps: StoryboardServiceDeps): StoryboardService {
  const { projects, settings, settingsService, models, runtime, shots, log } = deps
  const tools = deps.tools ?? findTools

  const sceneOf = (sceneId: string) => {
    const handle = projects.current()
    const scene = handle?.repos.outline.listScenes().find((s) => s.id === sceneId)
    if (!handle || !scene) throw invalid('找不到這個場，請先到「大綱」新增。')
    return { handle, scene }
  }

  const splitCheck = (sceneId: string): StoryboardSplitCheck => {
    const { demoMode, budget } = settings.get()
    const model = settingsService.resolveModel('llm')
    const handle = projects.current()
    const found = handle?.repos.outline.listScenes().find((s) => s.id === sceneId)
    const counts = found ? shots.sceneShotCounts(sceneId) : { existing: 0, generated: 0 }
    const base = {
      demoMode,
      existingShots: counts.existing,
      generatedShots: counts.generated,
    }
    if (!handle || !found) {
      return { ...base, ok: false, issue: '找不到這個場。', estimatedUsd: 0 }
    }
    if (!model) {
      return {
        ...base,
        ok: false,
        issue: '還沒有可用的文字模型：請到設定填入 OpenRouter 的服務金鑰（或打開示範模式）。',
        estimatedUsd: 0,
      }
    }
    const estimatedUsd = models.estimate(model, { inputTokens: 1200, outputTokens: 1200 })
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

  return {
    splitCheck,

    async splitScene(sceneId) {
      const checked = splitCheck(sceneId)
      const model = settingsService.resolveModel('llm')
      if (!checked.ok || !model) throw invalid(checked.issue ?? '現在不能讓 AI 分畫面。')
      const { handle, scene } = sceneOf(sceneId)
      const queue = runtime.queue()
      const tool = tools()
      if (!queue || !tool) {
        throw new AppError({
          code: 'internal_error',
          userMessage: '生成服務還沒準備好，請重新啟動 App。',
        })
      }

      const { outline, characters, projects: projectRepo } = handle.repos
      const allScenes = outline.listScenes()
      const index = allScenes.findIndex((s) => s.id === sceneId)
      const act = outline.listActs().find((a) => a.id === scene.actId)
      const place = outline.listLocations().find((l) => l.id === scene.locationId)
      const names = characters.list().map((c) => c.name)
      const style = QUICK_STYLES[toStyle(projectRepo.get().defaultStyleId)]
      const around = [
        allScenes[index - 1] ? `前一場：${allScenes[index - 1]?.title ?? ''}` : '',
        allScenes[index + 1] ? `下一場：${allScenes[index + 1]?.title ?? ''}` : '',
      ].filter((line) => line !== '')
      const brief = [
        act ? `這一幕：${act.title}${act.summary ? `（${act.summary}）` : ''}` : '',
        `這個場：${scene.title}`,
        scene.summary ? `發生的事：${scene.summary}` : '',
        place ? `地點：${place.name}${place.description ? `（${place.description}）` : ''}` : '',
        scene.timeOfDay ? `時間：${scene.timeOfDay}` : '',
        scene.mood ? `氣氛：${scene.mood}` : '',
        names.length > 0 ? `可以出場的角色：${names.join('、')}` : '',
        ...around,
      ].filter((line) => line !== '')

      const system =
        '你是短片的分鏡助手。把使用者給的「一個場」依劇情拆成 2 到 6 個連續的鏡頭，每個鏡頭是約幾秒的畫面。' +
        '用白話描述畫面裡看得到的人事物與動作；對白放在 dialogue（沒有就留空字串）；不要寫抽象的感受。' +
        `${SIZE_HINTS}。${ANGLE_HINTS}。平常用 eye_level，只有明顯是從側面或背後拍才用 side 或 back。` +
        `cameraMove 只能是 null（固定鏡頭）或：${CAMERA_MOVES.map((c) => `${c.id}（${c.label}）`).join('、')}。` +
        'durationSec 一般 2 到 6 秒。lighting 用一句話寫光線（例如「昏黃路燈、潮濕反光」），不確定就 null。' +
        '出場的角色請用「可以出場的角色」裡一模一樣的名字；沒列出的角色用故事裡的名字。' +
        `畫風是「${style.label}」。只輸出 JSON。` +
        storyboardGuidePrompt(resolveStoryboardGuide(settings.get().storyboardGuide))

      const studio = createStudioServices({ queue, handle, tools: tool, models })
      const result = await generateStructured(
        studio,
        { modelId: model, system, messages: [{ role: 'user', content: brief.join('\n') }] },
        LlmStoryboardSchema,
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
      if (handle.closed) throw invalid('專案已經關閉，沒有套用拆好的鏡頭。')

      const snapshot = shots.replaceSceneShots(sceneId, result.data.shots)
      log.info(`「${scene.title}」已拆成 ${String(result.data.shots.length)} 個鏡頭`)
      return snapshot
    },
  }
}
