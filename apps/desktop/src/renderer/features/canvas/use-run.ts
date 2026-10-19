import type { CanvasRunPlan, CanvasRunRequest, ModelTier } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { call, errorText } from '../../lib/svs'
import type { CanvasNode } from './canvas-model'
import { shiftAnchor, type ConfirmAnchor } from './run-confirm'
import { runSummary } from './run-summary'

export interface RunPending {
  request: CanvasRunRequest
  plan: CanvasRunPlan
  anchor: ConfirmAnchor
}

/** 可以執行的節點：鏡頭、場、圖、影片（都歸到鏡頭）和剪輯。 */
export const isRunnable = (id: string): boolean =>
  id === 'cut' || id.startsWith('shot:') || id.startsWith('scene:')

/** 正在跑的這一次：要做的圖與影片節點、做完幾個。 */
export interface ActiveRun {
  /** 這次要做的圖與影片節點鍵（接成品不算，那一步做完有自己的提示）。 */
  keys: string[]
  /** 停止時要取消的鏡頭。 */
  shotIds: string[]
  /** 「第 4 鏡 第一張畫面、影片（2 步）」，開始與完成的提示都用它。 */
  summary: string
  /** 開始時每個節點的樣子（狀態＋縮圖），用來判斷有沒有做過（很快做完時可能沒看到「生成中」）。 */
  before: ReadonlyMap<string, string>
  /** 看過它在排隊或生成中的節點。 */
  started: ReadonlySet<string>
  /** 做完了（成功、失敗或被停止）的節點。 */
  finished: ReadonlySet<string>
}

const BUSY = new Set(['running', 'queued'])
const shotIdOf = (key: string): string | undefined => /^shot:([^:]+)/.exec(key)?.[1]
const signatureOf = (node: CanvasNode | undefined): string =>
  `${node?.data.status ?? ''}|${node?.data.videoSrc ?? node?.data.thumb ?? ''}`

/**
 * 畫布上的執行：先問後端這次會跑哪些步驟與預估花費，貼在按鈕旁讓使用者確認
 * （確認時把那一串節點標亮），確認後在背景生成。開始與完成的提示都照確認面板的清單寫；
 * 進度（做完幾步）與停止給上方列與節點用。
 */
export function useRun(options: {
  /** 目前畫布上的節點（看這次的節點做到哪了）。 */
  nodes: readonly CanvasNode[]
  /** 面板出現之前先做的事（例如把目標帶進畫面）；畫面平移了就回傳移了多少（螢幕 px）。 */
  beforeConfirm?: (
    plan: CanvasRunPlan,
    anchor: ConfirmAnchor,
  ) => Promise<{ dx: number; dy: number } | undefined>
}) {
  const toast = useToast()
  const [pending, setPending] = useState<RunPending>()
  // 生成鈕旁選的等級（高品質／平衡／經濟）；沒選是設定裡的模型。下一次執行沿用
  const [quality, setQualityState] = useState<ModelTier>()
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const [active, setActive] = useState<ActiveRun>()
  const nodesRef = useRef(options.nodes)
  nodesRef.current = options.nodes
  const beforeConfirm = useRef(options.beforeConfirm)
  beforeConfirm.current = options.beforeConfirm

  const ask = useCallback(
    (asked: CanvasRunRequest, anchor: ConfirmAnchor): void => {
      const chosen = qualityRef.current
      const request = chosen ? { ...asked, quality: chosen } : asked
      call('canvas.runPlan', request)
        .then(async (plan) => {
          if (!plan.ok) {
            toast.show({ message: plan.issue ?? '現在不能執行。', tone: 'danger' })
          } else if (plan.steps.length === 0) {
            toast.show({ message: '都已經生成好了，沒有要補跑的' })
          } else {
            // 平移時格子上的 ▶ 也跟著動：面板貼到它現在的位置
            const moved = await beforeConfirm.current?.(plan, anchor)
            setPending({ request, plan, anchor: moved ? shiftAnchor(anchor, moved) : anchor })
          }
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [toast],
  )

  /** 照算好的計畫開始生成（確認面板按「執行」，或面板的「試跑」直接按「執行」）。 */
  const start = useCallback(
    (current: Pick<RunPending, 'request' | 'plan'>): void => {
      const { plan } = current
      const summary = runSummary(plan.steps)
      call('canvas.run', current.request)
        .then((result) => {
          const [first] = result.failed
          if (first) {
            toast.show({
              message: `第 ${String(first.number)} 鏡沒辦法開始：${first.error}`,
              tone: 'danger',
            })
            return
          }
          const keys = plan.steps.filter((step) => step.kind !== 'cut').map((step) => step.key)
          if (keys.length === 0) return
          const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
          setActive({
            keys,
            shotIds: [...new Set(keys.map(shotIdOf).filter((id) => id !== undefined))],
            summary,
            before: new Map(keys.map((key) => [key, signatureOf(byId.get(key))])),
            started: new Set(),
            finished: new Set(),
          })
          toast.show({ key: 'run', message: `開始生成：${summary}` })
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [toast],
  )

  const confirm = useCallback((): void => {
    const current = pending
    setPending(undefined)
    if (current) start(current)
  }, [pending, start])

  // 資料重新載入：看這次的節點做到哪了；全部做完就換成「完成」的提示
  useEffect(() => {
    if (!active) return
    const byId = new Map(options.nodes.map((n) => [n.id, n]))
    const started = new Set(active.started)
    const finished = new Set(active.finished)
    let anyBusy = false
    for (const key of active.keys) {
      const node = byId.get(key)
      const busy = BUSY.has(node?.data.status ?? '')
      anyBusy ||= busy
      if (busy) started.add(key)
      else if (started.has(key) || signatureOf(node) !== active.before.get(key)) finished.add(key)
    }
    // 已經開始過、現在沒有一格在排隊或生成：這次結束了（前一步失敗時，後面的步驟不會開始）
    const over =
      finished.size === active.keys.length || ((started.size > 0 || finished.size > 0) && !anyBusy)
    if (over) {
      setActive(undefined)
      const failed = active.keys.filter((key) => byId.get(key)?.data.status === 'failed').length
      toast.show(
        failed > 0
          ? {
              key: 'run',
              tone: 'danger',
              message: `有 ${String(failed)} 步沒有成功：在那一格按「重試」`,
            }
          : { key: 'run', message: `完成：${active.summary}` },
      )
      return
    }
    if (started.size !== active.started.size || finished.size !== active.finished.size) {
      setActive({ ...active, started, finished })
    }
  }, [options.nodes, active, toast])

  /** 停止這一次：取消還在做的鏡頭。 */
  const stop = useCallback((): void => {
    const current = active
    if (!current) return
    setActive(undefined)
    for (const shotId of current.shotIds) {
      call('shots.cancel', { shotId }).catch(() => undefined)
    }
    toast.show({ key: 'run', message: '已經停止，做好的部分留著' })
  }, [active, toast])

  const cancel = useCallback((): void => {
    setPending(undefined)
  }, [])

  /** 確認面板上換等級：重新算這次的步驟與花費（面板留在原地）；之後的執行也沿用。 */
  const setQuality = useCallback(
    (next: ModelTier | undefined): void => {
      setQualityState(next)
      const current = pending
      if (!current) return
      const { keys, all } = current.request
      const request: CanvasRunRequest = {
        keys,
        ...(all === undefined ? {} : { all }),
        ...(next ? { quality: next } : {}),
      }
      call('canvas.runPlan', request)
        .then((plan) => {
          setPending((now) => (now === current ? { ...current, request, plan } : now))
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [pending, toast],
  )

  return { pending, active, quality, setQuality, ask, confirm, start, cancel, stop }
}

export interface PendingCost {
  /** 還沒生成的部分預估多少錢；算不出來（沒有模型等）是 undefined。 */
  usd: number | undefined
  /** 所有鏡頭都生成好了，成品也接好了（跟現在的影片對得上）。 */
  done: boolean
  /** 素材都生成好了，只剩接成品。 */
  joinOnly: boolean
}

/**
 * 上方列「全部生成」的預估：只算還沒生成的（成品還沒接或對不上時也包括接成品）。資料有變動（`version` 換了）就重算，
 * 連續變動時等一下再算，免得生成中每個進度都重算整張畫布。
 */
export function usePendingCost(
  version: unknown,
  hasShots: boolean,
  quality?: ModelTier,
): PendingCost {
  const [cost, setCost] = useState<PendingCost>({ usd: undefined, done: false, joinOnly: false })
  useEffect(() => {
    if (!hasShots) {
      setCost({ usd: undefined, done: false, joinOnly: false })
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      call('canvas.runPlan', { keys: [], all: true, ...(quality ? { quality } : {}) })
        .then((plan) => {
          if (!alive) return
          setCost(
            plan.ok
              ? {
                  usd: plan.estimatedUsd,
                  done: plan.steps.length === 0,
                  joinOnly:
                    plan.steps.length > 0 && plan.steps.every((step) => step.kind === 'cut'),
                }
              : { usd: undefined, done: false, joinOnly: false },
          )
        })
        .catch(() => {
          if (alive) setCost({ usd: undefined, done: false, joinOnly: false })
        })
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [version, hasShots, quality])
  return cost
}
