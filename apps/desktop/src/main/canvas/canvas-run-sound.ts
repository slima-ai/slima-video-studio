import {
  DEFAULT_QUICK_START_SOUND,
  QuickStartSoundSchema,
  isAppError,
  type CanvasNotice,
  type CanvasRunSoundPlan,
  type QuickStartSound,
  t,
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

type SoundTodo = Pick<QuickStartSound, 'narration' | 'music'>

export type RunSoundWant = SoundTodo & {
  /** 這次的勾選來自哪些一句話節點（加好之後替它們記下「加過了」）。 */
  nodeIds: readonly string[]
}

/** 旁白與配樂加過了：記在一句話節點的設定上（`on` 是 false 就清掉）。 */
export function markSoundAutoAdded(
  handle: NonNullable<ReturnType<ProjectManager['current']>>,
  nodeIds: readonly string[],
  on: boolean,
  now: () => Date = () => new Date(),
): void {
  for (const id of nodeIds) {
    handle.repos.canvas.updateNodeParams(id, {
      soundAutoAddedAt: on ? now().toISOString() : undefined,
    })
  }
}

export interface RunSoundResult {
  problem?: string
  /** 念了幾個鏡頭的旁白。 */
  narrations: number
  /** 這次生了配樂。 */
  music: boolean
  /** 這次要念旁白，可是沒有鏡頭可念：現在有幾個鏡頭有台詞（0 就是沒有台詞）。 */
  noNarrationBecause?: { dialogueShots: number }
}

/** 開始加聲音時的通知：只寫真的會做的（沒有台詞就不說旁白）；沒有東西要加就不通知。 */
export function soundStartNotice(plan: CanvasRunSoundPlan | undefined): CanvasNotice | undefined {
  // 名詞放在句子中間：英文用小寫（中文沒有大小寫，不受影響）
  const parts = [
    plan && plan.narrationShots > 0 ? t('canvas.narration').toLowerCase() : '',
    plan?.music ? t('canvas.music').toLowerCase() : '',
  ].filter(Boolean)
  if (parts.length === 0) return undefined
  return {
    tone: 'success',
    message: t('canvas.theFilmIsJoinedAdding', { value: parts.join(t('list.and')) }),
  }
}

/** 加完聲音之後的一行通知：說實話做了哪些（沒台詞就不會有旁白，要講出來）。 */
export function soundDoneNotice(result: RunSoundResult): CanvasNotice {
  if (result.problem !== undefined) {
    return {
      tone: 'danger',
      message: t('canvas.theSoundWasnTAdded', { problem: result.problem }),
    }
  }
  const done = [
    ...(result.narrations > 0 ? [t('canvas.narration')] : []),
    ...(result.music ? [t('canvas.music')] : []),
  ].map((noun, index) => (index === 0 ? noun : noun.toLowerCase()))
  const why = result.noNarrationBecause
    ? result.noNarrationBecause.dialogueShots === 0
      ? t('canvas.noShotHasLinesSo')
      : t('canvas.everyShotWithLinesAlready')
    : undefined
  const head =
    done.length === 0
      ? t('canvas.theFilmIsJoined')
      : done.length > 1
        ? t('canvas.added', { value: done.join(t('list.and')) })
        : t('canvas.added2', { value: done.join(t('list.and')) })
  return {
    tone: 'success',
    message: why === undefined || done.length > 1 ? head : `${head}；${why}`,
  }
}

export interface RunSound {
  /**
   * 「全部生成」要不要順便加旁白與配樂：這次生成的鏡頭所在的場，連著哪些一句話節點，就看那些節點記住的聲音勾選
   * （「先產生分鏡」時卡片上勾的；舊的節點沒記就當全開），有一個要就要。沒有一句話節點連著（自己一步一步做的）就不加；
   * 節點已經自動加過（`soundAutoAddedAt`）就不再補，使用者刪掉的配樂不會又冒出來。
   */
  wanted: (
    shots: readonly { id: string; sceneId?: string | undefined }[],
  ) => RunSoundWant | undefined
  /** 預估要多花多少、加得成加不成（沒有可用的模型、超過預算上限）；沒東西要加是 undefined。 */
  plan: (want: RunSoundWant) => CanvasRunSoundPlan | undefined
  /**
   * 加旁白與配樂並混進成品；已經有配樂的不再生一首、已經有旁白的鏡頭不再念。
   * 回傳做了什麼：念了幾個鏡頭、有沒有生配樂，加不成時多一個白話原因 `problem`。
   */
  add: (want: RunSoundWant) => Promise<RunSoundResult>
}

/** 現在有台詞的鏡頭數。 */
const dialogueShotsOf = (sound: Pick<SoundService, 'state'>): number =>
  sound.state().shots.filter((shot) => shot.dialogue.trim() !== '').length

export function createRunSound(deps: RunSoundDeps): RunSound {
  const { projects, log } = deps

  /** 這一輪還要加的：配樂已經有了就不再生。 */
  const remaining = (want: RunSoundWant): SoundTodo | undefined => {
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
        if (typeof node.params.soundAutoAddedAt === 'string') continue
        const parsed = QuickStartSoundSchema.safeParse(node.params.sound)
        const sound = parsed.success ? parsed.data : DEFAULT_QUICK_START_SOUND
        want = {
          narration: (want?.narration ?? false) || sound.narration,
          music: (want?.music ?? false) || sound.music,
          nodeIds: [...(want?.nodeIds ?? []), node.id],
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
        narrationShots: plan.items.filter((item) => item.kind === 'narration').length,
        dialogueShots: dialogueShotsOf(sound),
        usd: plan.ok ? plan.totalUsd : 0,
        ...(plan.ok || plan.issue === undefined ? {} : { issue: plan.issue }),
      }
    },

    async add(want) {
      const todo = remaining(want)
      const sound = deps.sound?.()
      if (!sound) return { narrations: 0, music: false }
      try {
        const done = todo ? await sound.addAll(todo) : { narrations: 0, music: false }
        // 加成功（或本來就都有了）才記下加過了；失敗的話之後的全部生成還會再試
        const handle = projects.current()
        if (handle && !handle.closed) markSoundAutoAdded(handle, want.nodeIds, true)
        return {
          ...done,
          ...(todo?.narration === true && done.narrations === 0
            ? { noNarrationBecause: { dialogueShots: dialogueShotsOf(sound) } }
            : {}),
        }
      } catch (error) {
        log.warn(`全部生成之後加聲音失敗：${String(error)}`)
        return {
          narrations: 0,
          music: false,
          problem: isAppError(error) ? error.userMessage : t('canvas.addingSoundFailed'),
        }
      }
    },
  }
}
