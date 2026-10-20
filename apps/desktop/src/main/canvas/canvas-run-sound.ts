import {
  DEFAULT_QUICK_START_SOUND,
  QuickStartSoundSchema,
  isAppError,
  type CanvasRunSoundPlan,
  type QuickStartSound,
} from '@svs/schema'

import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import type { SoundService } from '../sound/sound-service'
import { sceneKey } from './projection'

export interface RunSoundDeps {
  projects: Pick<ProjectManager, 'current'>
  /** 聲音服務在畫布之後才可能用到，所以用函式取；沒給就不自動加。 */
  sound?: () => Pick<SoundService, 'plan' | 'addAll' | 'state'> | undefined
  log: Pick<Logger, 'warn'>
}

export type RunSoundWant = Pick<QuickStartSound, 'narration' | 'music'>

export interface RunSound {
  /**
   * 「全部生成」要不要順便加旁白與配樂：這次生成的鏡頭所在的場，連著哪些一句話節點，就看那些節點記住的聲音勾選
   * （「先產生分鏡」時卡片上勾的；舊的節點沒記就當全開），有一個要就要。沒有一句話節點連著（自己一步一步做的）就不加。
   */
  wanted: (
    shots: readonly { id: string; sceneId?: string | undefined }[],
  ) => RunSoundWant | undefined
  /** 預估要多花多少、加得成加不成（沒有可用的模型、超過預算上限）；沒東西要加是 undefined。 */
  plan: (want: RunSoundWant) => CanvasRunSoundPlan | undefined
  /** 加旁白與配樂並混進成品；已經有配樂的不再生一首、已經有旁白的鏡頭不再念。回傳失敗原因（成功是 undefined）。 */
  add: (want: RunSoundWant) => Promise<string | undefined>
}

export function createRunSound(deps: RunSoundDeps): RunSound {
  const { projects, log } = deps

  /** 這一輪還要加的：配樂已經有了就不再生。 */
  const remaining = (want: RunSoundWant): RunSoundWant | undefined => {
    const sound = deps.sound?.()
    if (!sound) return undefined
    const next = {
      narration: want.narration,
      music: want.music && sound.state().music === undefined,
    }
    return next.narration || next.music ? next : undefined
  }

  return {
    wanted(shots) {
      const handle = projects.current()
      if (!handle || handle.closed) return undefined
      const scenes = new Set(
        shots.flatMap((shot) => (shot.sceneId === undefined ? [] : [sceneKey(shot.sceneId)])),
      )
      if (scenes.size === 0) return undefined
      const { canvas } = handle.repos
      const linked = new Set(
        canvas
          .listEdges()
          .filter((edge) => scenes.has(edge.targetKey))
          .map((edge) => edge.sourceKey),
      )
      let want: RunSoundWant | undefined
      for (const node of canvas.listNodes()) {
        if (node.type !== 'oneliner' || !linked.has(`node:${node.id}`)) continue
        const parsed = QuickStartSoundSchema.safeParse(node.params.sound)
        const sound = parsed.success ? parsed.data : DEFAULT_QUICK_START_SOUND
        want = {
          narration: (want?.narration ?? false) || sound.narration,
          music: (want?.music ?? false) || sound.music,
        }
      }
      return want && (want.narration || want.music) ? want : undefined
    },

    plan(want) {
      const todo = remaining(want)
      const sound = deps.sound?.()
      if (!todo || !sound) return undefined
      const plan = sound.plan({
        ...(todo.narration ? { narration: {} } : {}),
        ...(todo.music ? { music: {} } : {}),
      })
      return {
        ...todo,
        usd: plan.ok ? plan.totalUsd : 0,
        ...(plan.ok || plan.issue === undefined ? {} : { issue: plan.issue }),
      }
    },

    async add(want) {
      const todo = remaining(want)
      const sound = deps.sound?.()
      if (!todo || !sound) return undefined
      try {
        await sound.addAll(todo)
        return undefined
      } catch (error) {
        log.warn(`全部生成之後加聲音失敗：${String(error)}`)
        return isAppError(error) ? error.userMessage : '加聲音失敗了'
      }
    },
  }
}
