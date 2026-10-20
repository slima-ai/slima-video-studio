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
import { sceneKey, shotKey } from './projection'

export interface CanvasRunnerDeps {
  shots: Pick<ShotService, 'list' | 'planRun' | 'run' | 'whenIdle' | 'rejoin' | 'finalCut'>
  /** 背景做完事（例如自動接片）時通知畫面。 */
  notify: (notice: CanvasNotice) => void
  log: Pick<Logger, 'info' | 'warn'>
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
  const { shots, notify, log } = deps

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
      const rejoin =
        target.rejoin ||
        ((target.all || target.joinAfter) &&
          joinAfterAll(check.entries.filter((entry) => entry.video).map((entry) => entry.shot.id)))
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
        steps: check.ok ? steps : [],
        highlightKeys: [...highlight],
        shotCount: entries.length,
        rejoin,
        segments,
      }
    },

    async run(request) {
      const target = resolve(request)
      const { items } = target
      const rejoin =
        target.rejoin ||
        ((target.all || target.joinAfter) &&
          joinAfterAll(
            shots
              .planRun(items, request.quality)
              .entries.filter((entry) => entry.video)
              .map((entry) => entry.shot.id),
          ))
      const result =
        items.length > 0
          ? await shots.run(items, request.quality)
          : { started: 0, failed: [] as never[] }
      if (rejoin) {
        // 背景等所有鏡頭做完再接片；有鏡頭沒有影片時 rejoin 會說是第幾鏡
        void shots
          .whenIdle()
          .then(() => shots.rejoin())
          .then(() => {
            notify({ tone: 'success', message: '成品接好了' })
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
