import type { SoundPlan, SoundSettingsPatch } from '@svs/schema'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { LEVEL_LABELS, MUSIC_DB, NARRATION_DB, NATIVE_DB, levelOf, type Level } from './levels'
import { useSound } from './use-sound'

type Choice = Level | 'off'

/** 一排「小／中／大」按鈕（原聲另有「關」）。 */
function LevelPicker({
  testId,
  label,
  value,
  withOff = false,
  onPick,
}: {
  testId: string
  label: string
  value: Choice
  withOff?: boolean
  onPick: (choice: Choice) => void
}) {
  const choices: Choice[] = [...(withOff ? (['off'] as const) : []), 'low', 'mid', 'high']
  return (
    <div className="flex items-center gap-3" role="group" aria-label={`${label}音量`}>
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
            {choice === 'off' ? '關' : LEVEL_LABELS[choice]}
          </Button>
        ))}
      </div>
    </div>
  )
}

type AddState =
  | { step: 'idle' }
  | { step: 'planning' }
  | { step: 'confirm'; plan: SoundPlan }
  | { step: 'running'; text: string }

const usd = (n: number): string => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

function planText(plan: SoundPlan): string {
  const narrations = plan.items.filter((i) => i.kind === 'narration').length
  const music = plan.items.filter((i) => i.kind === 'music').length
  const parts = [
    narrations > 0 ? `旁白 ${String(narrations)} 句` : '',
    music > 0 ? `配樂 ${String(music)} 首` : '',
  ].filter((p) => p !== '')
  return `預估約 ${usd(plan.totalUsd)}：${parts.join('、')}。`
}

/**
 * 成品的聲音：一顆「加上旁白與配樂」就做完（預估花費 → 確認 → 生成 → 混音）；
 * 有聲音之後是三排「小／中／大」，調整就自動重混（不花錢）。
 */
export function SoundPanel() {
  const { state, error, reload } = useSound()
  const [add, setAdd] = useState<AddState>({ step: 'idle' })
  const [actionError, setActionError] = useState<string>()
  const [mixing, setMixing] = useState(false)
  const mixTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      if (mixTimer.current) clearTimeout(mixTimer.current)
    },
    [],
  )

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

  /** 設定改完等一下就自動重混（連按幾次只混一次）。 */
  const scheduleMix = (): void => {
    if (mixTimer.current) clearTimeout(mixTimer.current)
    mixTimer.current = setTimeout(() => {
      setMixing(true)
      call('sound.mix', {})
        .catch(fail)
        .finally(() => {
          setMixing(false)
          reload()
        })
    }, 500)
  }

  const change = (patch: SoundSettingsPatch): void => {
    setActionError(undefined)
    call('sound.updateSettings', patch)
      .then(() => {
        scheduleMix()
      })
      .catch(fail)
  }

  const startAdd = (): void => {
    setActionError(undefined)
    setAdd({ step: 'planning' })
    call('sound.plan', { narration: {}, music: {} })
      .then((plan) => {
        if (!plan.ok) {
          setActionError(plan.issue ?? '現在不能加聲音。')
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
    try {
      const narrations = plan.items.filter((i) => i.kind === 'narration')
      for (const [index, item] of narrations.entries()) {
        if (item.shotId === undefined) continue
        setAdd({
          step: 'running',
          text: `旁白 ${String(index + 1)}／${String(narrations.length)}…`,
        })
        await call('sound.generateNarration', { shotId: item.shotId })
      }
      if (plan.items.some((i) => i.kind === 'music')) {
        setAdd({ step: 'running', text: '配樂…' })
        await call('sound.generateMusic', {})
      }
      setAdd({ step: 'running', text: '混音…' })
      await call('sound.mix', {})
    } catch (e) {
      fail(e)
    } finally {
      setAdd({ step: 'idle' })
      reload()
    }
  }

  const hasClips = state.music !== undefined || state.shots.some((s) => s.narration !== undefined)
  const noModels = state.models.tts === undefined && state.models.music === undefined
  const narrationCount = state.shots.filter((s) => s.narration).length

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
    body = <p className="text-sm text-fg-muted">先把鏡頭接成一支影片，再來加聲音。</p>
  } else if (!hasClips) {
    body =
      add.step === 'confirm' ? (
        <div className="space-y-2" data-testid="sound-add-confirm">
          <p className="text-sm">{planText(add.plan)}要開始嗎？</p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              data-testid="sound-add-go"
              onClick={() => {
                void runAdd(add.plan)
              }}
            >
              開始
            </Button>
            <Button
              data-testid="sound-add-cancel"
              onClick={() => {
                setAdd({ step: 'idle' })
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : add.step === 'running' ? (
        <p className="text-sm" role="status" data-testid="sound-progress">
          {add.text}
        </p>
      ) : noModels ? (
        <p className="text-sm text-fg-muted">
          還沒有可用的旁白與配樂模型：請到設定填入 OpenRouter 的金鑰（或打開示範模式）。
        </p>
      ) : (
        <div className="space-y-2">
          <Button
            variant="primary"
            data-testid="sound-add"
            disabled={add.step === 'planning'}
            onClick={startAdd}
          >
            {add.step === 'planning' ? '估價中…' : '加上旁白與配樂'}
          </Button>
          <p className="text-xs text-fg-muted">
            念每個鏡頭的台詞，再配一首背景音樂，最後混進成品。先告訴你預估花費，確認才會開始。
          </p>
        </div>
      )
  } else {
    body = (
      <div className="space-y-3" data-testid="sound-mixer">
        <LevelPicker
          testId="sound-native"
          label="影片原聲"
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
        <LevelPicker
          testId="sound-narration"
          label="旁白"
          value={levelOf(NARRATION_DB, state.settings.narrationGainDb)}
          onPick={(choice) => {
            if (choice !== 'off') change({ narrationGainDb: NARRATION_DB[choice] })
          }}
        />
        <LevelPicker
          testId="sound-music"
          label="配樂"
          value={levelOf(MUSIC_DB, state.settings.musicGainDb)}
          onPick={(choice) => {
            if (choice !== 'off') change({ musicGainDb: MUSIC_DB[choice] })
          }}
        />
        <p className="text-xs text-fg-muted" data-testid="sound-summary">
          {narrationCount} 個鏡頭有旁白
          {state.music ? '、有配樂' : '、沒有配樂'}。
          {narrationCount === 0 ? '鏡頭填了台詞才會有旁白。' : ''}調整音量不花錢，會自動重混。
        </p>
        {state.warnings.map((w) => (
          <p key={`${w.kind}:${w.shotId ?? ''}`} className="text-xs text-warning" role="status">
            {w.message}
          </p>
        ))}
        {mixing ? (
          <p className="text-sm text-fg-muted" role="status" data-testid="sound-mixing">
            混音中…
          </p>
        ) : state.final.soundStale ? (
          <Button
            size="sm"
            data-testid="sound-remix"
            onClick={() => {
              scheduleMix()
            }}
          >
            重新混音（不花錢）
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className="space-y-2 border-t border-border pt-3"
      data-testid="sound-panel"
      aria-label="聲音"
    >
      <h3 className="text-sm font-semibold">聲音</h3>
      {body}
      {actionError ? (
        <p role="alert" className="text-sm text-danger" data-testid="sound-error">
          {actionError}
        </p>
      ) : null}
    </section>
  )
}
