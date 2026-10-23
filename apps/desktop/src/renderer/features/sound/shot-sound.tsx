import type { SoundPlan } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { useAutoMix } from './use-auto-mix'
import { useRemoveSound } from './use-remove-sound'
import { useSound } from './use-sound'
import { t } from '@svs/schema'

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
        {t('sound.linesNarrationReadsExactlyThis')}
      </label>
      <textarea
        id={`shot-sound-dialogue-${shotId}`}
        data-testid="shot-sound-dialogue"
        className="w-full resize-y rounded-lg border border-border bg-surface px-2 py-1 text-sm"
        rows={2}
        maxLength={2000}
        value={draft}
        placeholder={t('sound.forExampleBlackVinesCover')}
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
          {t('sound.saveLines')}
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
  // 記下點擊當下主程序那邊的 nativeMuted（base）：它一變（含別處改的）就以主程序為準並把暫存清掉。
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
  const removeSound = useRemoveSound({ reload, scheduleMix: schedule, onError: setError })
  const view = state?.shots.find((s) => s.shotId === shotId)
  const nativeMuted = view?.nativeMuted
  if (pending && pending.base !== nativeMuted) {
    // 主程序的狀態已經不是點擊當下那樣：暫存用完了。不清掉的話，之後別處改回原樣時它會復活
    setPending(undefined)
  }
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
        if (!plan.ok) setError(plan.issue ?? t('sound.canTMakeNarrationRight'))
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
      aria-label={t('sound.soundForThisShot')}
    >
      <h3 className="text-sm font-semibold">{t('sound.sound')}</h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="shot-sound-native"
          checked={pendingUse ?? !view.nativeMuted}
          onChange={(event) => {
            toggleNative(event.target.checked)
          }}
        />
        {t('sound.useTheVideoSOwn')}
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
            {narration.durationSec === undefined
              ? t('sound.narrationVersion', { version: narration.version })
              : t('sound.narrationSVersion', {
                  value: narration.durationSec.toFixed(1),
                  version: narration.version,
                })}
          </p>
        ) : dialogue === '' ? (
          <p className="text-sm text-fg-muted" data-testid="shot-sound-no-dialogue">
            {t('sound.thisShotHasNoLines')}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">{t('sound.thisShotHasNoNarration')}</p>
        )}
        {flow.step === 'confirm' ? (
          <div className="space-y-1" data-testid="shot-sound-confirm">
            <p className="text-sm">{t('sound.aboutStart', { value: usd(flow.plan.totalUsd) })}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="shot-sound-go"
                onClick={runNarration}
              >
                {t('sound.start')}
              </Button>
              <Button
                size="sm"
                data-testid="shot-sound-cancel"
                onClick={() => {
                  setFlow({ step: 'idle' })
                }}
              >
                {t('sound.cancel')}
              </Button>
            </div>
          </div>
        ) : flow.step === 'running' ? (
          <p className="text-sm text-fg-muted" role="status" data-testid="shot-sound-running">
            {t('sound.readingAloud')}
          </p>
        ) : (
          <div className="flex gap-2">
            {dialogue !== '' ? (
              <Button
                size="sm"
                data-testid="shot-sound-narrate"
                disabled={dialogueDirty}
                title={dialogueDirty ? t('sound.saveTheLinesFirst') : undefined}
                onClick={askNarration}
              >
                {narration ? t('sound.readAgain') : t('sound.readThisLineAloud')}
              </Button>
            ) : null}
            {narration ? (
              <Button
                size="sm"
                data-testid="shot-sound-narration-delete"
                title={t('sound.deleteThisShotSNarration')}
                onClick={() => {
                  setError(undefined)
                  removeSound({ kind: 'narration', shotId }, t('sound.deletedThisShotSNarration'))
                }}
              >
                {t('sound.deleteNarration')}
              </Button>
            ) : null}
          </div>
        )}
        {mixing ? (
          <p className="text-xs text-fg-muted" role="status" data-testid="shot-sound-mixing">
            {t('sound.mixing')}
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
