import type { SoundPlan } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { useAutoMix } from './use-auto-mix'
import { useSound } from './use-sound'

const usd = (n: number): string => `US$${n < 0.1 ? n.toFixed(4) : n.toFixed(2)}`

type Step = { step: 'idle' } | { step: 'confirm'; plan: SoundPlan } | { step: 'running' }

/** 這一鏡的台詞：直接在這裡寫、改；存檔走跟分鏡表一樣的 shots.update。 */
function DialogueEditor({
  shotId,
  saved,
  onDirty,
  onSaved,
}: {
  shotId: string
  saved: string
  onDirty: (dirty: boolean) => void
  onSaved: (error?: unknown) => void
}) {
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== saved.trim()

  const save = (): void => {
    setSaving(true)
    call('shots.update', { shotId, patch: { dialogue: draft.trim() } })
      .then(() => {
        onDirty(false)
        onSaved()
      })
      .catch((e: unknown) => {
        onSaved(e)
      })
      .finally(() => {
        setSaving(false)
      })
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm text-fg-muted" htmlFor={`shot-sound-dialogue-${shotId}`}>
        台詞（旁白念的就是這句）
      </label>
      <textarea
        id={`shot-sound-dialogue-${shotId}`}
        data-testid="shot-sound-dialogue"
        className="w-full resize-y rounded-lg border border-border bg-surface px-2 py-1 text-sm"
        rows={2}
        maxLength={2000}
        value={draft}
        placeholder="例如：黑藤爬滿了斷橋。"
        onChange={(event) => {
          setDraft(event.target.value)
          onDirty(event.target.value.trim() !== saved.trim())
        }}
      />
      {dirty ? (
        <Button
          size="sm"
          variant="primary"
          data-testid="shot-sound-dialogue-save"
          disabled={saving}
          onClick={save}
        >
          儲存台詞
        </Button>
      ) : null}
    </div>
  )
}

/**
 * 一個鏡頭的聲音：影片原聲要不要用、旁白（念台詞／重新念，先給預估花費、確認才開始）。
 * 改了原聲開關或重新念之後，成品自動重混。
 */
export function ShotSound({ shotId }: { shotId: string }) {
  const { state, reload } = useSound()
  const [flow, setFlow] = useState<Step>({ step: 'idle' })
  const [error, setError] = useState<string>()
  const [dialogueDirty, setDialogueDirty] = useState(false)
  // 勾選的當下就換狀態，不等主程序回應；回應慢時才不會先彈回原樣再跳過來。
  // 記下點擊當下主程序那邊的 nativeMuted（base）：它一變（含別處改的）就以主程序為準。
  // 不用 useEffect 去清：載入那次 commit 留下的 effect 可能在點擊之後才跑，會把剛點的蓋回去
  const [pending, setPending] = useState<{ use: boolean; base: boolean | undefined }>()
  const {
    mixing,
    error: mixError,
    schedule,
  } = useAutoMix({
    enabled: state?.final !== undefined,
    onDone: reload,
  })
  const view = state?.shots.find((s) => s.shotId === shotId)
  const nativeMuted = view?.nativeMuted
  const pendingUse = pending?.base === nativeMuted ? pending?.use : undefined
  if (!state || !view) return null

  const fail = (e: unknown): void => {
    setError(errorText(e))
  }

  const toggleNative = (use: boolean): void => {
    setError(undefined)
    const muted = new Set(state.settings.muteNativeShotIds)
    if (use) muted.delete(shotId)
    else muted.add(shotId)
    setPending({ use, base: nativeMuted })
    call('sound.updateSettings', { muteNativeShotIds: [...muted] })
      .then(() => {
        schedule()
      })
      .catch((e: unknown) => {
        setPending(undefined)
        fail(e)
      })
  }

  const askNarration = (): void => {
    setError(undefined)
    call('sound.plan', { narration: { shotIds: [shotId] } })
      .then((plan) => {
        if (!plan.ok) setError(plan.issue ?? '現在不能念旁白。')
        else setFlow({ step: 'confirm', plan })
      })
      .catch(fail)
  }

  const runNarration = (): void => {
    setFlow({ step: 'running' })
    call('sound.generateNarration', { shotId })
      .then(() => {
        schedule()
      })
      .catch(fail)
      .finally(() => {
        setFlow({ step: 'idle' })
        reload()
      })
  }

  const dialogue = view.dialogue.trim()
  const narration = view.narration

  const dialogueSaved = (e?: unknown): void => {
    if (e === undefined) {
      setError(undefined)
      reload()
    } else {
      fail(e)
    }
  }

  return (
    <section
      className="space-y-2 border-t border-border pt-3"
      data-testid="shot-sound"
      aria-label="這一鏡的聲音"
    >
      <h3 className="text-sm font-semibold">聲音</h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="shot-sound-native"
          checked={pendingUse ?? !view.nativeMuted}
          onChange={(event) => {
            toggleNative(event.target.checked)
          }}
        />
        用影片原聲
      </label>
      <DialogueEditor
        key={`${shotId}:${view.dialogue}`}
        shotId={shotId}
        saved={view.dialogue}
        onDirty={setDialogueDirty}
        onSaved={dialogueSaved}
      />
      <div className="space-y-1">
        {narration ? (
          <p className="text-sm" data-testid="shot-sound-narration">
            旁白：
            {narration.durationSec === undefined ? '' : `${narration.durationSec.toFixed(1)} 秒・`}
            第 {narration.version} 版
          </p>
        ) : dialogue === '' ? (
          <p className="text-sm text-fg-muted" data-testid="shot-sound-no-dialogue">
            這一鏡還沒有台詞，所以沒有旁白。在下面寫一句，就能念出來。
          </p>
        ) : (
          <p className="text-sm text-fg-muted">這一鏡還沒有旁白。</p>
        )}
        {flow.step === 'confirm' ? (
          <div className="space-y-1" data-testid="shot-sound-confirm">
            <p className="text-sm">預估約 {usd(flow.plan.totalUsd)}。要開始嗎？</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="shot-sound-go"
                onClick={runNarration}
              >
                開始
              </Button>
              <Button
                size="sm"
                data-testid="shot-sound-cancel"
                onClick={() => {
                  setFlow({ step: 'idle' })
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : flow.step === 'running' ? (
          <p className="text-sm text-fg-muted" role="status" data-testid="shot-sound-running">
            正在念…
          </p>
        ) : dialogue !== '' ? (
          <Button
            size="sm"
            data-testid="shot-sound-narrate"
            disabled={dialogueDirty}
            title={dialogueDirty ? '先儲存台詞' : undefined}
            onClick={askNarration}
          >
            {narration ? '重新念' : '念出這句台詞'}
          </Button>
        ) : null}
        {mixing ? (
          <p className="text-xs text-fg-muted" role="status" data-testid="shot-sound-mixing">
            混音中…
          </p>
        ) : null}
      </div>
      {(error ?? mixError) ? (
        <p role="alert" className="text-sm text-danger" data-testid="shot-sound-error">
          {error ?? mixError}
        </p>
      ) : null}
    </section>
  )
}
