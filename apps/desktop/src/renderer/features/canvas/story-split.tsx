import type { OutlineSplitCheck } from '@svs/schema'
import { useCallback, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { call, errorText } from '../../lib/svs'
import { RunConfirm, type ConfirmAnchor } from './run-confirm'
import { t } from '@svs/schema'

/** 「把故事拆成分鏡」按下去、檢查過、等使用者確認花費的那一刻。 */
export interface SplitPending {
  text: string
  check: OutlineSplitCheck
  anchor: ConfirmAnchor
}

/**
 * 貼一段故事 → 拆成場與鏡頭（只用文字模型，不生成圖片和影片）：先檢查與預估花費、貼在按鈕旁讓人確認；
 * 確認後先把故事拆成幕與場、抽出角色與地點，再一個場一個場拆成鏡頭，用提示說做到哪。
 * 拆場會取代現有大綱，所以只在還沒有內容的畫布上用（空白畫布的入口）。
 */
export function useStorySplit(options: { onChanged: () => void }) {
  const toast = useToast()
  const [pending, setPending] = useState<SplitPending>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const onChanged = useRef(options.onChanged)
  onChanged.current = options.onChanged

  const start = useCallback(
    (text: string, anchor: ConfirmAnchor): void => {
      if (busyRef.current || text.trim() === '') return
      call('outline.splitCheck', { text })
        .then((check) => {
          if (!check.ok) {
            toast.show({ message: check.issue ?? t('canvas.theStoryCanTBe'), tone: 'danger' })
            return
          }
          setPending({ text, check, anchor })
        })
        .catch((error: unknown) => {
          toast.show({ message: errorText(error), tone: 'danger' })
        })
    },
    [toast],
  )

  const run = useCallback((): void => {
    const current = pending
    setPending(undefined)
    if (!current || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const finish = (): void => {
      busyRef.current = false
      setBusy(false)
    }
    void (async () => {
      try {
        toast.show({ key: 'split', message: t('canvas.splittingTheStoryIntoScenes') })
        const result = await call('outline.split', { text: current.text })
        onChanged.current()
        const scenes = result.outline.acts.flatMap((act) => act.scenes)
        let usd = current.check.estimatedUsd
        let shots = 0
        for (const [index, scene] of scenes.entries()) {
          toast.show({
            key: 'split',
            message: t('canvas.splittingSceneOfIntoShots', {
              value: String(index + 1),
              value2: String(scenes.length),
            }),
          })
          const check = await call('storyboard.splitCheck', { sceneId: scene.id })
          if (!check.ok) {
            toast.show({
              key: 'split',
              message: check.issue ?? t('canvas.thisSceneCanTBe'),
              tone: 'danger',
            })
            onChanged.current()
            return
          }
          const snapshot = await call('storyboard.splitScene', { sceneId: scene.id })
          usd += check.estimatedUsd
          shots = snapshot.shots.length
          onChanged.current()
        }
        toast.show({
          key: 'split',
          message: t('canvas.splitIntoScenesAndShots', {
            value: String(scenes.length),
            value2: String(shots),
            value3: usd.toFixed(2),
          }),
          ms: 12_000,
        })
      } catch (error) {
        onChanged.current()
        toast.show({ message: errorText(error), tone: 'danger' })
      } finally {
        finish()
      }
    })()
  }, [pending, toast])

  const cancel = useCallback((): void => {
    setPending(undefined)
  }, [])

  return { pending, busy, start, run, cancel }
}

/** 拆分鏡的確認面板：說清楚只用文字模型、不生成圖片和影片、大概多少錢。 */
export function SplitConfirm({
  pending,
  onOk,
  onCancel,
}: {
  pending: SplitPending
  onOk: () => void
  onCancel: () => void
}) {
  const { check } = pending
  return (
    <RunConfirm
      anchor={pending.anchor}
      count={2}
      title={t('canvas.splitTheStoryIntoA')}
      lines={[
        t('canvas.splitTheStoryIntoActs'),
        t('canvas.thenSplitEachSceneInto'),
        t('canvas.noPicturesOrVideoAre'),
      ]}
      pinnedLines={[
        ...(check.modelName === undefined
          ? []
          : [t('canvas.uses2', { modelName: check.modelName })]),
        ...(check.demoMode ? [t('canvas.demoModeNothingIsCharged2')] : []),
      ]}
      costUsd={check.estimatedUsd}
      lowerBound
      cachedNote={false}
      okLabel={t('canvas.splitIntoStoryboard')}
      onOk={onOk}
      onCancel={onCancel}
    />
  )
}
