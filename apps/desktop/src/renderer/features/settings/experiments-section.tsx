import {
  CHAT_BUDGET_DEFAULT_USD,
  CHAT_BUDGET_MAX_USD,
  CHAT_BUDGET_MIN_USD,
  type AppSettings,
  t,
} from '@svs/schema'
import { MessagesSquare } from 'lucide-react'
import { useEffect, useState } from 'react'

import { SettingCard } from '../../components/setting-card'
import { Switch } from '../../components/switch'
import { call, errorText } from '../../lib/svs'

export interface ExperimentsSectionProps {
  settings: AppSettings
  onChanged: () => void
}

/**
 * 實驗功能。目前只有一個：畫布右下角的 Claude 對話。沒設過時依版本——開發版開、打包版關
 * （使用條款還沒決定前，打包版預設不開）；使用者一動，就照他選的。
 */
export function ExperimentsSection({ settings, onChanged }: ExperimentsSectionProps) {
  const [packaged, setPackaged] = useState<boolean>()
  useEffect(() => {
    call('app.getInfo', {})
      .then((info) => {
        setPackaged(info.packaged)
      })
      .catch(() => {
        setPackaged(true)
      })
  }, [])
  const effective = settings.experiments.claudeChat ?? packaged === false
  // 勾選框先照使用者的操作更新，不用等主行程回應；失敗時還原
  const [on, setOn] = useState(effective)
  useEffect(() => {
    setOn(effective)
  }, [effective])
  const [error, setError] = useState<string>()

  return (
    <div className="contents" data-testid="experiments-section">
      <SettingCard
        icon={MessagesSquare}
        title={t('settings.claudeChatOnTheCanvas')}
        status={
          on ? { tone: 'ok', label: t('settings.on') } : { tone: 'off', label: t('settings.off2') }
        }
        summary={t('settings.opensAChatPanelBeside')}
        action={
          <Switch
            aria-label={t('settings.claudeChatOnTheCanvas')}
            data-testid="experiment-claude-chat"
            checked={on}
            onChange={(event) => {
              const next = event.target.checked
              setOn(next)
              setError(undefined)
              call('settings.update', { experiments: { claudeChat: next } })
                .then(onChanged)
                .catch((e: unknown) => {
                  setOn(!next)
                  setError(errorText(e))
                })
            }}
          />
        }
        details={
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">{t('settings.claudeCodeMustBeInstalled')}</p>
            <BudgetField
              value={settings.experiments.claudeBudgetUsd}
              onChanged={onChanged}
              onError={setError}
            />
          </div>
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Claude 對話每一段的用量上限（約 US$）。到上限時對話裡會出現「繼續」，不會斷掉。 */
function BudgetField({
  value,
  onChanged,
  onError,
}: {
  value: number | undefined
  onChanged: () => void
  onError: (message: string | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setText(value === undefined ? '' : String(value))
  }, [value])
  const save = (): void => {
    onError(undefined)
    const trimmed = text.trim()
    const next = trimmed === '' ? undefined : Number(trimmed)
    if (
      next !== undefined &&
      (!Number.isFinite(next) || next < CHAT_BUDGET_MIN_USD || next > CHAT_BUDGET_MAX_USD)
    ) {
      onError(
        t('settings.theLimitPerSessionMust', {
          value: String(CHAT_BUDGET_MIN_USD),
          value2: String(CHAT_BUDGET_MAX_USD),
        }),
      )
      return
    }
    if (next === value) return
    call('settings.update', { experiments: { claudeBudgetUsd: next ?? null } })
      .then(() => {
        onChanged()
        setSaved(true)
      })
      .catch((e: unknown) => {
        onError(errorText(e))
      })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="experiment-claude-budget" className="text-fg-muted">
        {t('settings.usageLimitPerClaudeChat')}
      </label>
      <input
        id="experiment-claude-budget"
        data-testid="experiment-claude-budget"
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={String(CHAT_BUDGET_DEFAULT_USD)}
        className="w-20 rounded-md border border-border bg-surface px-2 py-1"
        onChange={(event) => {
          setText(event.target.value)
          setSaved(false)
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
        }}
      />
      {saved ? (
        <span role="status" data-testid="experiment-claude-budget-saved" className="text-success">
          {t('settings.saved')}
        </span>
      ) : null}
      <span className="text-xs text-fg-muted">
        {t('settings.thisIsYourOwnClaude', { value: String(CHAT_BUDGET_DEFAULT_USD) })}
      </span>
    </div>
  )
}
