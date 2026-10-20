import type { OnelinerParams, QuickStartCheck, QuickStartRequest } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'
import type { ConfirmAnchor } from './run-confirm'

/** 還沒回報是哪個節點在生成（例如離開畫布再回來）時，所有一句話節點都顯示生成中。 */
export const ANY_ONELINER = '*'

/** 這次做到哪：只寫分鏡（文字模型），或一次做完整支（分鏡、圖片、影片、接片）。 */
export type GrowStage = 'storyboard' | 'full'

export interface GrowConfirm {
  nodeId: string
  stage: GrowStage
  /** 只寫分鏡時：下一步（生圖片和影片）大概多少錢，已經扣掉寫分鏡這一步。 */
  nextUsd?: number
  params: OnelinerParams
  anchor: ConfirmAnchor
  check: QuickStartCheck
  /** 專案裡已經有鏡頭：才有「取代全部」可以選。 */
  hasContent: boolean
  /** 現在有幾個場、幾個鏡頭：「取代全部」說清楚會刪掉多少。 */
  existing: { scenes: number; shots: number }
  /** 第幾次從這個一句話生成（用來換一批新的結果）。 */
  variation: number
}

/**
 * 一句話節點的生成流程：先檢查設定與預估花費（有問題就用提示說明）、貼在按鈕旁的確認面板、
 * 確認後在背景生成；進度靠 `quickstart.progress` 事件，結束時用提示說結果。
 * 生成中畫布會因為鏡頭、圖、影片陸續寫進資料而重新載入，節點就一個個長出來。
 */
export function useGrow(options: {
  /** 結束時（成功、失敗、停止）重新讀資料並整理畫面；做完才顯示結果提示。 */
  onFinished: (status: 'succeeded' | 'failed' | 'cancelled') => Promise<void>
}) {
  const toast = useToast()
  const { undo } = useHistory()
  const undoRef = useRef(undo)
  undoRef.current = undo
  const [confirm, setConfirm] = useState<GrowConfirm>()
  const [running, setRunning] = useState<string>()
  // 生成結束後讀最後的資料、整理畫面的這段時間
  const [finishing, setFinishing] = useState(false)
  const runningRef = useRef(running)
  runningRef.current = running
  // 正在跑的是哪一步（結束時的提示不同）
  const stageRef = useRef<GrowStage>('full')
  const onFinished = useRef(options.onFinished)
  onFinished.current = options.onFinished

  useEffect(() => {
    let alive = true
    const off = window.svs.on('quickstart.progress', (progress) => {
      if (progress.status === 'running') {
        // 影片接好之後正在加旁白與配樂：畫布仍顯示生成中，提示說明在做什麼
        if (progress.phase === 'sound') {
          toast.show({ key: 'grow', message: '正在加旁白與配樂…' })
        }
        return
      }
      const was = runningRef.current
      if (was === undefined) return
      setRunning(undefined)
      setFinishing(true)
      const say = (): void => {
        setFinishing(false)
        // 整次生成是一筆可以復原的動作：按「復原」回到按下「生成影片」之前（「取代全部」刪掉的也會回來）
        const action = {
          label: '復原',
          onAction: () => {
            undoRef.current()
          },
        }
        if (progress.status === 'succeeded' && stageRef.current === 'storyboard') {
          toast.show({
            key: 'grow',
            message:
              '分鏡寫好了，圖片和影片還沒生成。看過、改好，再按右上角的「全部生成」，那裡會給你準確的預估',
            action,
            ms: 12_000,
          })
        } else if (progress.status === 'succeeded') {
          toast.show({
            key: 'grow',
            message: progress.soundFailed
              ? '短片生成好了，但聲音沒加成，可以在成品面板再試'
              : '短片生成好了',
            action,
          })
        } else if (progress.status === 'failed') {
          toast.show({
            key: 'grow',
            message: progress.error?.userMessage ?? '生成失敗了，請再試一次。',
            tone: 'danger',
          })
        } else {
          toast.show({ key: 'grow', message: '已經停止生成，做好的部分留著', action })
        }
      }
      onFinished.current(progress.status).then(say, say)
    })
    call('quickstart.state', {})
      .then((state) => {
        if (alive && state?.status === 'running') setRunning((current) => current ?? ANY_ONELINER)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
    }
  }, [toast])

  const request = (
    nodeId: string,
    params: OnelinerParams,
    variation: number,
    replace: boolean,
    stage: GrowStage,
  ): QuickStartRequest => ({
    ...params,
    variation,
    mode: replace ? 'replace' : 'append',
    sourceKey: nodeId,
    stage,
  })

  /** 按下「先產生分鏡」或「一次做完整支」：先檢查，沒問題才跳出確認。 */
  const start = useCallback(
    (
      nodeId: string,
      params: OnelinerParams,
      anchor: ConfirmAnchor,
      context: Pick<GrowConfirm, 'hasContent' | 'existing' | 'variation'>,
      stage: GrowStage = 'full',
    ): void => {
      // 只寫分鏡時多問一次整支的預估：確認面板要說下一步（圖片和影片）大概多少錢
      const checks = Promise.all([
        call('quickstart.check', request(nodeId, params, context.variation, false, stage)),
        stage === 'storyboard'
          ? call('quickstart.check', request(nodeId, params, context.variation, false, 'full'))
          : Promise.resolve(undefined),
      ])
      checks
        .then(([check, full]) => {
          const [issue] = check.issues
          if (!check.ok || issue) {
            toast.show({ message: issue?.message ?? '現在不能生成。', tone: 'danger' })
            return
          }
          const nextUsd =
            full === undefined ? undefined : Math.max(0, full.estimatedUsd - check.estimatedUsd)
          setConfirm({
            nodeId,
            stage,
            params,
            anchor,
            check,
            ...(nextUsd === undefined ? {} : { nextUsd }),
            ...context,
          })
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [toast],
  )

  const run = useCallback(
    (replace: boolean): void => {
      const pending = confirm
      setConfirm(undefined)
      if (!pending) return
      setRunning(pending.nodeId)
      stageRef.current = pending.stage
      call(
        'quickstart.run',
        request(pending.nodeId, pending.params, pending.variation, replace, pending.stage),
      ).catch((error: unknown) => {
        setRunning(undefined)
        toast.show({ message: errorText(error), tone: 'danger' })
      })
    },
    [confirm, toast],
  )

  const cancelConfirm = useCallback((): void => {
    setConfirm(undefined)
  }, [])
  const stop = useCallback((): void => {
    call('quickstart.cancel', {}).catch(() => undefined)
  }, [])

  return { confirm, running, finishing, start, run, cancelConfirm, stop }
}
