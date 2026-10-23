import {
  DEFAULT_PER_RUN_LIMIT_USD,
  THEME_PREFERENCES,
  type AppSettings,
  type ThemePreference,
  t,
  msg,
  type MessageRef,
} from '@svs/schema'
import { CircleDollarSign, FlaskConical, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { Switch } from '../../components/switch'
import { call, errorText } from '../../lib/svs'
import { AreaPointer, areaPath } from './area-pointer'
import { LanguageCard } from './language-card'

export interface GeneralSectionProps {
  settings: AppSettings
  onChanged: () => void
}

const THEME_LABELS: Record<ThemePreference, MessageRef> = {
  system: msg('settings.followSystem'),
  light: msg('settings.light'),
  dark: msg('settings.dark'),
}

/** 「一般」區的四張卡：示範模式、外觀、單次花費上限、介面語言。 */
export function GeneralSection({ settings, onChanged }: GeneralSectionProps) {
  const [limit, setLimit] = useState(String(settings.budget.perRunLimitUsd))
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  /** 最近一次存成功的單次上限（提示要寫「存了多少」，輸入框之後再改也不影響已顯示的那句）。 */
  const [savedAs, setSavedAs] = useState<number | undefined>()
  // 勾選框先照使用者的操作更新，不用等主行程回應；失敗時再還原
  const [demo, setDemo] = useState(settings.demoMode)
  useEffect(() => {
    setDemo(settings.demoMode)
  }, [settings.demoMode])
  const [theme, setTheme] = useState(settings.theme)
  useEffect(() => {
    setTheme(settings.theme)
  }, [settings.theme])

  /** 回傳 true 表示儲存成功。 */
  const update = (patch: Parameters<typeof call<'settings.update'>>[1]): Promise<boolean> => {
    setError(undefined)
    setSaved(false)
    return call('settings.update', patch)
      .then(() => {
        onChanged()
        return true
      })
      .catch((e: unknown) => {
        setError(errorText(e))
        return false
      })
  }

  const parsed = Number(limit)
  const valid = Number.isFinite(parsed) && parsed > 0

  // 這一區的卡直接排進區的格線裡（display: contents 的外框只是留 testid）
  return (
    <div className="contents" data-testid="general-section">
      <SettingCard
        icon={FlaskConical}
        title={t('settings.demoMode')}
        status={
          demo
            ? { tone: 'ok', label: t('settings.onCostsNothing') }
            : { tone: 'warn', label: t('settings.offUsesRealServices') }
        }
        summary={t('settings.runTheWholeProcessWith')}
        action={
          <Switch
            aria-label={t('settings.demoMode')}
            data-testid="demo-mode"
            checked={demo}
            onChange={(event) => {
              const { checked } = event.target
              setDemo(checked)
              void update({ demoMode: checked }).then((ok) => {
                if (!ok) setDemo(!checked)
              })
            }}
          />
        }
      />

      <SettingCard
        icon={Palette}
        title={t('settings.appearance')}
        summary={t('settings.lightDarkOrFollowThe')}
        body={
          <fieldset>
            <legend className="sr-only">{t('settings.appearance')}</legend>
            <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
              {THEME_PREFERENCES.map((option) => (
                <label
                  key={option}
                  className="cursor-pointer rounded px-3 py-1.5 text-sm text-fg-muted transition-colors duration-200 has-checked:bg-surface-overlay has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-accent"
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    data-testid={`theme-${option}`}
                    checked={theme === option}
                    onChange={() => {
                      const previous = theme
                      // 先換，畫面立刻有反應；存檔失敗再換回來
                      setTheme(option)
                      void update({ theme: option }).then((ok) => {
                        if (!ok) setTheme(previous)
                      })
                    }}
                    className="sr-only"
                  />
                  {t(THEME_LABELS[option])}
                </label>
              ))}
            </div>
          </fieldset>
        }
      />

      <SettingCard
        icon={CircleDollarSign}
        title={t('settings.perRunSpendingLimit')}
        status={{ tone: 'ok', label: `US$${String(settings.budget.perRunLimitUsd)}` }}
        summary={t('settings.eachTimeYouGenerateOr')}
        body={
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!valid) return
              void update({ budget: { ...settings.budget, perRunLimitUsd: parsed } }).then((ok) => {
                setSaved(ok)
                // 提示寫明存到哪一張、存了多少（不是只說「已儲存」）
                if (ok) setSavedAs(parsed)
              })
            }}
          >
            <label className="sr-only" htmlFor="per-run-limit">
              {t('settings.perRunSpendingLimitUs')}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-muted">US$</span>
              <input
                id="per-run-limit"
                data-testid="per-run-limit"
                inputMode="decimal"
                value={limit}
                onChange={(event) => {
                  setLimit(event.target.value)
                  setSaved(false)
                }}
                className="w-28 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              <Button type="submit" variant="secondary" disabled={!valid}>
                {t('settings.save')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {t('settings.ifItSOverYou', { value: String(DEFAULT_PER_RUN_LIMIT_USD) })}
            </p>
            {valid ? null : (
              <p className="mt-1 text-sm text-danger">{t('settings.enterANumberGreaterThan')}</p>
            )}
            {saved ? (
              <p role="status" className="mt-1 text-sm text-success">
                {t('settings.cardSavedAs', {
                  card: t('settings.perRunSpendingLimit'),
                  value: String(savedAs ?? parsed),
                })}
              </p>
            ) : null}
            <AreaPointer
              testId="per-run-pointer"
              targetId="connections"
              text={t('settings.perRunPointer', {
                where: areaPath('aiTools'),
                card: t('mcp.allowanceCard'),
              })}
            />
          </form>
        }
      />

      <LanguageCard value={settings.language} onChanged={onChanged} />

      {error ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  )
}
