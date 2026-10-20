import type { OutlineSplitCheck } from '@svs/schema'
import { useCallback, useRef, useState } from 'react'

import { useToast } from '../../components/toast'
import { call, errorText } from '../../lib/svs'
import { RunConfirm, type ConfirmAnchor } from './run-confirm'

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
            toast.show({ message: check.issue ?? '現在不能把故事拆成分鏡。', tone: 'danger' })
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
        toast.show({ key: 'split', message: '正在把故事拆成場…' })
        const result = await call('outline.split', { text: current.text })
        onChanged.current()
        const scenes = result.outline.acts.flatMap((act) => act.scenes)
        let usd = current.check.estimatedUsd
        let shots = 0
        for (const [index, scene] of scenes.entries()) {
          toast.show({
            key: 'split',
            message: `正在替第 ${String(index + 1)}／${String(scenes.length)} 場拆鏡頭…`,
          })
          const check = await call('storyboard.splitCheck', { sceneId: scene.id })
          if (!check.ok) {
            toast.show({
              key: 'split',
              message: check.issue ?? '這一場現在不能拆成鏡頭，先停在這裡。',
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
          message: `已拆成 ${String(scenes.length)} 場、共 ${String(shots)} 個鏡頭（只用文字模型，約 US$${usd.toFixed(2)}）。圖片和影片還沒生成：看過、改好再按右上角的「全部生成」`,
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
      title="把故事拆成分鏡"
      lines={[
        '把故事拆成幕和場，抽出角色與地點（文字模型）',
        '再替每一場拆成幾個鏡頭，寫好畫面描述（文字模型，每場一次）',
        '不會生成圖片和影片：拆好之後你可以先看、先改，要生成再按「全部生成」',
        ...(check.modelName === undefined ? [] : [`用：${check.modelName}`]),
        ...(check.demoMode ? ['示範模式：不會真的花錢，拆出來的內容是假的'] : []),
      ]}
      costUsd={check.estimatedUsd}
      lowerBound
      cachedNote={false}
      okLabel="拆成分鏡"
      onOk={onOk}
      onCancel={onCancel}
    />
  )
}
