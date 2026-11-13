import type { NarrationShortened, SoundPlan, SoundSettingsPatch } from '@svs/schema'
import { useState } from 'react'

import { Button } from '../../components/button'
import { LONG_TOAST_MS, useToast } from '../../components/toast'
import { useAppNavigation } from '../../lib/app-navigation'
import { useHistory } from '../../lib/history'
import { call, errorText } from '../../lib/svs'
import { planUsd } from './plan-usd'
import { LEVEL_LABELS, MUSIC_DB, NARRATION_DB, NATIVE_DB, levelOf, type Level } from './levels'
import { SoundTimeline } from './sound-timeline'
import { useAutoMix } from './use-auto-mix'
import { useRemoveSound } from './use-remove-sound'
import { useSound } from './use-sound'
import { t } from '@svs/schema'

type Choice = Level | 'off'

/** 一排「小／中／大」按鈕（原聲另有「關」）。 */
function LevelPicker({
  testId,
  label,
  value,
  withOff = false,
  onPick,
  onDelete,
}: {
  testId: string
  label: string
  value: Choice
  withOff?: boolean
  onPick: (choice: Choice) => void
  /** 有的話，這一排最後多一顆刪除鈕（旁白、配樂）。 */
  onDelete?: { label: string; onClick: () => void }
}) {
  const choices: Choice[] = [...(withOff ? (['off'] as const) : []), 'low', 'mid', 'high']
  return (
    <div className="flex items-center gap-3" role="group" aria-label={t('sound.volume', { label })}>
      <span className="w-16 shrink-0 text-sm">{label}</span>
      <div className="flex gap-1">
        {choices.map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={value === choice ? 'primary' : 'secondary'}
            aria-pressed={value === choice}
            data-testid={`${testId}-${choice}`}
            onClick={() => {
              onPick(choice)
            }}
          >
            {choice === 'off' ? t('sound.off') : t(LEVEL_LABELS[choice])}
          </Button>
        ))}
      </div>
      {onDelete ? (
        <Button
          size="sm"
          data-testid={`${testId}-delete`}
          aria-label={onDelete.label}
          onClick={onDelete.onClick}
        >
          {t('sound.delete')}
        </Button>
      ) : null}
    </div>
  )
}

type AddState =
  | { step: 'idle' }
  | { step: 'planning' }
  | { step: 'confirm'; plan: SoundPlan }
  | { step: 'running'; text: string }

const usd = (n: number): string => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

/**
 * 成品的聲音：一顆「加上旁白與配樂」就做完（預估花費 → 確認 → 生成 → 混音）；
 * 有聲音之後是三排「小／中／大」，調整就自動重混（不花錢）。
 */
export function SoundPanel() {
  const { state, error, reload } = useSound()
  const [add, setAdd] = useState<AddState>({ step: 'idle' })
  const [actionError, setActionError] = useState<string>()
  const [importing, setImporting] = useState(false)
  const toast = useToast()
  const history = useHistory()
  const { openSettings } = useAppNavigation()
  const {
    mixing,
    error: mixError,
    schedule: scheduleMix,
  } = useAutoMix({
    enabled: state?.final !== undefined,
    onDone: reload,
  })

  const removeSound = useRemoveSound({
    reload,
    scheduleMix,
    onError: setActionError,
  })

  if (!state) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : null
  }

  const fail = (e: unknown): void => {
    setActionError(errorText(e))
  }

  const change = (patch: SoundSettingsPatch): void => {
    setActionError(undefined)
    call('sound.updateSettings', patch)
      .then(() => {
        scheduleMix()
      })
      .catch(fail)
  }

  // 選自己的音樂：檔案對話框在主程式開（畫面不碰路徑）；取消回 null，什麼都不發生
  const importMusic = (): void => {
    setActionError(undefined)
    setImporting(true)
    call('sound.importMusic', {})
      .then(({ clip }) => {
        if (clip === null) return
        reload()
        scheduleMix()
      })
      .catch(fail)
      .finally(() => {
        setImporting(false)
      })
  }

  const importButton = (
    <Button size="sm" data-testid="sound-import-music" disabled={importing} onClick={importMusic}>
      {importing ? t('sound.import.busy') : t('sound.import.button')}
    </Button>
  )

  /** `narration`：只念旁白（有台詞、還沒念的鏡頭），不加配樂。 */
  const startAdd = (scope: 'all' | 'narration' = 'all'): void => {
    setActionError(undefined)
    setAdd({ step: 'planning' })
    call('sound.plan', scope === 'narration' ? { narration: {} } : { narration: {}, music: {} })
      .then((plan) => {
        if (!plan.ok) {
          setActionError(plan.issue ?? t('sound.canTAddSoundRight'))
          setAdd({ step: 'idle' })
        } else {
          setAdd({ step: 'confirm', plan })
        }
      })
      .catch((e: unknown) => {
        fail(e)
        setAdd({ step: 'idle' })
      })
  }

  const runAdd = async (plan: SoundPlan): Promise<void> => {
    // 旁白放不進格子、被改短重念的：最後用一則提示說（台詞已經換成改短的）
    const shortened: NarrationShortened[] = []
    try {
      const narrations = plan.items.filter((i) => i.kind === 'narration')
      for (const [index, item] of narrations.entries()) {
        if (item.shotId === undefined) continue
        setAdd({
          step: 'running',
          text: t('sound.narration', {
            value: String(index + 1),
            value2: String(narrations.length),
          }),
        })
        const done = await call('sound.generateNarration', { shotId: item.shotId })
        if (done.shortened) shortened.push(done.shortened)
      }
      if (plan.items.some((i) => i.kind === 'music')) {
        setAdd({ step: 'running', text: t('sound.music') })
        await call('sound.generateMusic', {})
      }
      setAdd({ step: 'running', text: t('sound.mixing2') })
      await call('sound.mix', {})
    } catch (e) {
      fail(e)
    } finally {
      setAdd({ step: 'idle' })
      reload()
      const [only] = shortened
      if (only) {
        toast.show({
          key: 'sound-shortened',
          message:
            shortened.length === 1
              ? t('sound.narrationShortened', { value: String(only.shotNumber) })
              : t('sound.narrationsShortened', { count: shortened.length }),
          // 一句才附復原（復原一次只退一步；好幾句要一步步退，用上方列的復原）
          ...(shortened.length === 1
            ? { action: { label: t('sound.undo'), onAction: history.undo } }
            : {}),
          ms: LONG_TOAST_MS,
        })
      }
    }
  }

  const confirmBlock =
    add.step === 'confirm' ? (
      <div className="space-y-2" data-testid="sound-add-confirm">
        <p className="text-sm">{t('sound.about', { value: planUsd(add.plan, usd) })}</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            data-testid="sound-add-go"
            onClick={() => {
              void runAdd(add.plan)
            }}
          >
            {t('sound.start')}
          </Button>
          <Button
            data-testid="sound-add-cancel"
            onClick={() => {
              setAdd({ step: 'idle' })
            }}
          >
            {t('sound.cancel')}
          </Button>
        </div>
      </div>
    ) : null

  const hasClips = state.music !== undefined || state.shots.some((s) => s.narration !== undefined)
  const noModels = state.models.tts === undefined && state.models.music === undefined
  const narrationCount = state.shots.filter((s) => s.narration).length
  const dialogueShots = state.shots.filter((s) => s.dialogue.trim() !== '').length

  const nativeAllMuted =
    state.shots.length > 0 &&
    state.shots.every((s) => state.settings.muteNativeShotIds.includes(s.shotId))
  const nativeValue: Choice = nativeAllMuted
    ? 'off'
    : levelOf(NATIVE_DB, state.settings.nativeGainDb)

  let body
  if (add.step === 'running') {
    // 生成中新片段一個個進來，但還沒混好：一直顯示進度，等混完才換成音量調整
    body = (
      <p className="text-sm" role="status" data-testid="sound-progress">
        {add.text}
      </p>
    )
  } else if (state.final === undefined) {
    body = <p className="text-sm text-fg-muted">{t('sound.firstJoinTheShotsInto')}</p>
  } else if (!hasClips) {
    body =
      confirmBlock ??
      (noModels ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-fg-muted">{t('sound.noNarrationOrMusicModel')}</p>
            <Button size="sm" data-testid="sound-go-settings" onClick={openSettings}>
              {t('settings.goToSettings')}
            </Button>
          </div>
          {importButton}
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            variant="primary"
            data-testid="sound-add"
            disabled={add.step === 'planning'}
            onClick={() => {
              startAdd()
            }}
          >
            {add.step === 'planning'
              ? t('sound.gettingAnEstimate')
              : t('sound.addNarrationAndMusic')}
          </Button>
          {importButton}
        </div>
      ))
  } else {
    body = (
      <div className="space-y-3" data-testid="sound-mixer">
        <LevelPicker
          testId="sound-native"
          label={t('sound.videoSound')}
          withOff
          value={nativeValue}
          onPick={(choice) => {
            if (choice === 'off') {
              change({ muteNativeShotIds: state.shots.map((s) => s.shotId) })
            } else {
              change({ muteNativeShotIds: [], nativeGainDb: NATIVE_DB[choice] })
            }
          }}
        />
        {narrationCount > 0 ? (
          <LevelPicker
            testId="sound-narration"
            label={t('sound.narration2')}
            value={levelOf(NARRATION_DB, state.settings.narrationGainDb)}
            onPick={(choice) => {
              if (choice !== 'off') change({ narrationGainDb: NARRATION_DB[choice] })
            }}
            onDelete={{
              label: t('sound.deleteNarration'),
              onClick: () => {
                setActionError(undefined)
                removeSound(
                  { kind: 'narration' },
                  t('sound.narrationsDeleted', { count: narrationCount }),
                )
              },
            }}
          />
        ) : dialogueShots > 0 ? (
          // 有台詞、沒有旁白（例如旁白被刪掉了）：台詞還在，一顆「只念旁白」（先給預估、確認才花錢）
          (confirmBlock ?? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-fg-muted" data-testid="sound-narration-missing">
                {t('sound.narrationMissing', { count: dialogueShots })}
              </span>
              <Button
                size="sm"
                data-testid="sound-narrate-only"
                disabled={add.step === 'planning'}
                onClick={() => {
                  startAdd('narration')
                }}
              >
                {t('sound.narrateOnly')}
              </Button>
            </div>
          ))
        ) : null}
        <LevelPicker
          testId="sound-music"
          label={t('sound.music2')}
          value={levelOf(MUSIC_DB, state.settings.musicGainDb)}
          onPick={(choice) => {
            if (choice !== 'off') change({ musicGainDb: MUSIC_DB[choice] })
          }}
          {...(state.music
            ? {
                onDelete: {
                  label: t('sound.deleteMusic'),
                  onClick: () => {
                    setActionError(undefined)
                    removeSound({ kind: 'music' }, t('sound.deletedTheMusic'))
                  },
                },
              }
            : {})}
        />
        <div className="flex flex-wrap items-center gap-2">
          {state.music?.source === 'imported' ? (
            <span className="text-xs text-fg-muted" data-testid="sound-music-own">
              {t('sound.import.own', { name: state.music.text })}
            </span>
          ) : null}
          {importButton}
        </div>
        <SoundTimeline state={state} part="sound" />
        {state.warnings.map((w) => (
          <p key={`${w.kind}:${w.shotId ?? ''}`} className="text-xs text-warning" role="status">
            {w.message}
          </p>
        ))}
        {mixing ? (
          <p className="text-sm text-fg-muted" role="status" data-testid="sound-mixing">
            {t('sound.mixing')}
          </p>
        ) : state.final.soundStale ? (
          <Button
            size="sm"
            data-testid="sound-remix"
            onClick={() => {
              scheduleMix()
            }}
          >
            {t('sound.mixAgainFree')}
          </Button>
        ) : null}
      </div>
    )
  }

  // 接過成品就有「時間軸」：秒數尺、鏡頭、剪掉（拖格子邊緣剪頭尾）；跟有沒有旁白與配樂無關
  const showTimeline = state.final !== undefined && state.totalSec > 0 && state.shots.length > 0

  return (
    <>
      {showTimeline ? (
        <section
          className="space-y-2 border-t border-border pt-3"
          data-testid="timeline-panel"
          aria-label={t('sound.timeline')}
        >
          <h3 className="text-sm font-semibold">{t('sound.timeline')}</h3>
          <SoundTimeline
            state={state}
            part="film"
            onTrim={async (shotId, edit) => {
              await call('shots.trim', { shotId, edit })
            }}
          />
        </section>
      ) : null}
      <section
        className="space-y-2 border-t border-border pt-3"
        data-testid="sound-panel"
        aria-label={t('sound.sound')}
      >
        <h3 className="text-sm font-semibold">{t('sound.sound')}</h3>
        {body}
        {mixError ? (
          <p role="alert" className="text-sm text-danger" data-testid="sound-mix-error">
            {mixError}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-sm text-danger" data-testid="sound-error">
            {actionError}
          </p>
        ) : null}
      </section>
    </>
  )
}
