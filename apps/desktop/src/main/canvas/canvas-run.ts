import {
  isAppError,
  type CanvasNotice,
  type CanvasRunPlan,
  type CanvasRunRequest,
  type CanvasRunResult,
  type CanvasRunStep,
} from '@svs/schema'

import type { Logger } from '../logger'
import type { ShotRunItem, ShotService } from '../shots/shot-service'
import { soundDoneNotice, soundStartNotice, type RunSound } from './canvas-run-sound'
import { sceneKey, shotKey } from './projection'

export interface CanvasRunnerDeps {
  shots: Pick<ShotService, 'list' | 'planRun' | 'run' | 'whenIdle' | 'rejoin' | 'finalCut'>
  /** 背景做完事（例如自動接片）時通知畫面。 */
  notify: (notice: CanvasNotice) => void
  log: Pick<Logger, 'info' | 'warn'>
  /** 「全部生成」之後照一句話卡片記住的聲音勾選自動加旁白與配樂；沒給就不加。 */
  runSound?: RunSound
}

export interface CanvasRunner {
  plan: (request: CanvasRunRequest) => CanvasRunPlan
  run: (request: CanvasRunRequest) => Promise<CanvasRunResult>
}

interface Target {
  items: ShotRunItem[]
  /** 按在剪輯節點上：生成完再接片。 */
  rejoin: boolean
  /** 「全部生成」：成品還沒接、對不上，或這次會換掉放進成品的影片，就順便接片。 */
  all: boolean
  /** ▶ 旁選了「這個和後面的」或「整條」：跟「全部生成」一樣，需要時順便接片。 */
  joinAfter: boolean
}

/**
 * 畫布上的「執行」：把按了 ▶ 或選取的節點對應到鏡頭，交給鏡頭服務補跑缺的步驟。
 * 圖與影片在同一條鏡頭流程裡，所以對圖或影片按 ▶ 都是「補跑到影片為止」：
 * 已經有結果的不重跑，只有直接按在單一個已完成的圖或影片上才會重做那個節點。
 */
export function createCanvasRunner(deps: CanvasRunnerDeps): CanvasRunner {
  const { shots, notify, log, runSound } = deps

  const resolve = (request: CanvasRunRequest): Target => {
    const views = shots.list().shots
    const items = new Map<string, ShotRunItem>()
    const add = (
      shotId: string,
      redo?: 'video' | 'all',
      exact?: 'frame' | 'video' | 'all',
    ): void => {
      // 同一個鏡頭被好幾個節點選到：只要有一個是「重做」就重做
      const merged = redo ?? items.get(shotId)?.redo
      items.set(shotId, {
        shotId,
        ...(merged ? { redo: merged } : {}),
        ...(exact ? { exact } : {}),
      })
    }
    let rejoin = false
    const single = !request.all && request.keys.length === 1
    const scope = single ? request.scope : undefined
    if (request.all) for (const view of views) add(view.id)
    for (const key of request.keys) {
      const [kind, id, part] = key.split(':')
      if (key === 'cut') {
        rejoin = true
        for (const view of views) add(view.id)
      } else if (kind === 'scene' && id !== undefined) {
        for (const view of views) if (view.sceneId === id) add(view.id)
      } else if (kind === 'shot' && id !== undefined) {
        const view = views.find((v) => v.id === id)
        if (!view) continue
        const done = (takes: readonly { adopted: boolean }[]): boolean =>
          takes.some((t) => t.adopted)
        if (scope && part === 'image') add(id, undefined, scope === 'this' ? 'frame' : 'all')
        else if (scope && part === 'video') add(id, undefined, scope === 'chain' ? 'all' : 'video')
        else if (scope) add(id, undefined, 'all')
        else if (single && part === 'video' && done(view.videos)) add(id, 'video')
        else if (single && part === 'image' && done(view.firstFrames)) add(id, 'all')
        else add(id)
      }
    }
    return {
      items: [...items.values()],
      rejoin,
      all: request.all === true,
      joinAfter: scope === 'from-here' || scope === 'chain',
    }
  }

  /**
   * 「全部生成」要不要順便接成品：有放進成品的鏡頭，而且成品還沒接過、跟現在的影片對不上
   * （換了版本、開關改了、多了鏡頭），或這次會生成放進成品的鏡頭的新影片。
   */
  const joinAfterAll = (videoShotIds: readonly string[]): boolean => {
    const views = shots.list().shots
    const inCut = new Set(views.filter((v) => v.inCut !== false).map((v) => v.id))
    if (inCut.size === 0) return false
    const final = shots.finalCut()
    return final === undefined || final.stale || videoShotIds.some((id) => inCut.has(id))
  }

  /**
   * 放進成品、而且這次跑完仍然沒有影片的鏡頭數。有的話接不成（接片要每一段都有影片），
   * 這時不排接片、確認視窗也不列這一步，免得使用者以為做完會有成品。
   */
  const segmentsWithoutVideo = (videoShotIds: readonly string[]): number => {
    const willMake = new Set(videoShotIds)
    return shots
      .list()
      .shots.filter(
        (v) => v.inCut !== false && !willMake.has(v.id) && !v.videos.some((t) => t.adopted),
      ).length
  }

  /** 這批要生成影片的鏡頭，要不要在接好片之後加旁白與配樂。 */
  const soundWanted = (videoShotIds: readonly string[]) => {
    if (!runSound || videoShotIds.length === 0) return undefined
    const ids = new Set(videoShotIds)
    return runSound.wanted(shots.list().shots.filter((view) => ids.has(view.id)))
  }

  return {
    plan(request) {
      const target = resolve(request)
      const { items } = target
      const views = shots.list().shots
      if (items.length === 0 && !target.rejoin) {
        return { ...emptyPlan(), ok: false, issue: '這裡沒有可以執行的鏡頭。' }
      }
      if (target.rejoin && views.length === 0) {
        return { ...emptyPlan(), ok: false, issue: '還沒有鏡頭可以接。', rejoin: true }
      }
      const check = shots.planRun(items, request.quality)
      const videoIds = check.entries.filter((entry) => entry.video).map((entry) => entry.shot.id)
      const wantsJoin = !target.rejoin && (target.all || target.joinAfter) && joinAfterAll(videoIds)
      const missing = wantsJoin ? segmentsWithoutVideo(videoIds) : 0
      const rejoin = target.rejoin || (wantsJoin && missing === 0)
      // 全部生成而且會接片：生成完照一句話卡片記住的聲音勾選加旁白與配樂，花費也算進這一次
      const soundWant =
        check.ok && rejoin && target.all
          ? soundWanted(check.entries.filter((entry) => entry.video).map((entry) => entry.shot.id))
          : undefined
      const soundPlan = soundWant && runSound?.plan(soundWant)
      const steps: CanvasRunStep[] = []
      const highlight = new Set<string>()
      /** 重做時：現在用第幾版、這次產生第幾版。 */
      const versionsOf = (
        takes: readonly { version: number; adopted: boolean }[],
      ): CanvasRunStep['versions'] => {
        const current = takes.find((t) => t.adopted)?.version
        if (current === undefined) return undefined
        return { current, next: Math.max(...takes.map((t) => t.version)) + 1 }
      }
      for (const entry of check.entries) {
        const id = entry.shot.id
        const no = `第 ${String(entry.shot.number)} 鏡`
        const view = views.find((v) => v.id === id)
        const redoVersions = (kind: 'firstFrames' | 'videos') => {
          const versions = entry.redo && view ? versionsOf(view[kind]) : undefined
          return versions ? { versions } : {}
        }
        highlight.add(shotKey(id))
        if (entry.image) {
          steps.push({
            key: `${shotKey(id)}:image`,
            kind: 'image',
            label: `${no}：第一張畫面`,
            redo: entry.redo,
            ...redoVersions('firstFrames'),
          })
          highlight.add(`${shotKey(id)}:image`)
        }
        if (entry.video) {
          steps.push({
            key: `${shotKey(id)}:video`,
            kind: 'video',
            label: `${no}：影片`,
            redo: entry.redo,
            ...redoVersions('videos'),
          })
          highlight.add(`${shotKey(id)}:video`)
        }
      }
      const segments = views.filter((v) => v.inCut !== false).length
      if (rejoin) {
        steps.push({
          key: 'cut',
          kind: 'cut',
          label: `接成成品（${String(segments)} 段，在本機處理、免費）`,
          redo: false,
        })
        highlight.add('cut')
        for (const view of views) {
          highlight.add(shotKey(view.id))
          highlight.add(`${shotKey(view.id)}:image`)
          highlight.add(`${shotKey(view.id)}:video`)
          if (view.sceneId) highlight.add(sceneKey(view.sceneId))
        }
      }
      const { entries, ...rest } = check
      return {
        ...rest,
        estimatedUsd: rest.estimatedUsd + (soundPlan?.usd ?? 0),
        ...(soundPlan ? { sound: soundPlan } : {}),
        steps: check.ok ? steps : [],
        highlightKeys: [...highlight],
        shotCount: entries.length,
        rejoin,
        segments,
        ...(missing > 0 ? { joinSkipped: missing } : {}),
      }
    },

    async run(request) {
      const target = resolve(request)
      const { items } = target
      const videoShotIds = shots
        .planRun(items, request.quality)
        .entries.filter((entry) => entry.video)
        .map((entry) => entry.shot.id)
      const wantsJoin =
        !target.rejoin && (target.all || target.joinAfter) && joinAfterAll(videoShotIds)
      // 還有鏡頭沒有影片就不接（跟確認視窗說的一致），不會在背景吐出「第 N 鏡還沒有影片」的錯
      const rejoin = target.rejoin || (wantsJoin && segmentsWithoutVideo(videoShotIds) === 0)
      // 旁白與配樂只跟著「全部生成」，其他範圍的執行不自動加
      const soundWant = rejoin && target.all ? soundWanted(videoShotIds) : undefined
      const result =
        items.length > 0
          ? await shots.run(items, request.quality)
          : { started: 0, failed: [] as never[] }
      if (rejoin) {
        // 背景等所有鏡頭做完再接片；有鏡頭沒有影片時 rejoin 會說是第幾鏡
        void shots
          .whenIdle()
          .then(() => shots.rejoin())
          .then(async () => {
            if (!soundWant || !runSound) {
              notify({ tone: 'success', message: '成品接好了' })
              return
            }
            const started = soundStartNotice(runSound.plan(soundWant))
            if (started) notify(started)
            notify(soundDoneNotice(await runSound.add(soundWant)))
          })
          .catch((error: unknown) => {
            log.warn(`畫布接片失敗：${String(error)}`)
            notify({
              tone: 'danger',
              message: isAppError(error) ? error.userMessage : '接成成品失敗了，請再試一次。',
            })
          })
      }
      return {
        started: result.started,
        failed: result.failed.map((f) => ({ number: f.number, error: f.error })),
      }
    },
  }
}

const emptyPlan = (): CanvasRunPlan => ({
  ok: true,
  steps: [],
  highlightKeys: [],
  shotCount: 0,
  skippedBusy: 0,
  estimatedUsd: 0,
  estimateIsLowerBound: false,
  demoMode: false,
  models: {},
  rejoin: false,
  segments: 0,
})
