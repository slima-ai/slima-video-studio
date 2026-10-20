import {
  DEFAULT_PER_RUN_LIMIT_USD,
  THEME_PREFERENCES,
  type AppSettings,
  type ThemePreference,
} from '@svs/schema'
import { CircleDollarSign, FlaskConical, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { Switch } from '../../components/switch'
import { call, errorText } from '../../lib/svs'

export interface GeneralSectionProps {
  settings: AppSettings
  onChanged: () => void
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: '跟隨系統',
  light: '淺色',
  dark: '深色',
}

/** 「一般」區的三張卡：示範模式、外觀、App 自己每次生成最多花多少。 */
export function GeneralSection({ settings, onChanged }: GeneralSectionProps) {
  const [limit, setLimit] = useState(String(settings.budget.perRunLimitUsd))
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
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
        title="示範模式"
        status={
          demo
            ? { tone: 'ok', label: '開著・不花錢' }
            : { tone: 'warn', label: '關著・會用真的服務' }
        }
        summary="用假的結果跑完整個流程，不需要金鑰、不會花錢，適合先熟悉操作。"
        action={
          <Switch
            aria-label="示範模式"
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
        title="外觀"
        summary="淺色、深色，或跟著系統換。"
        body={
          <fieldset>
            <legend className="sr-only">外觀</legend>
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
                  {THEME_LABELS[option]}
                </label>
              ))}
            </div>
          </fieldset>
        }
      />

      <SettingCard
        icon={CircleDollarSign}
        title="每次生成的花費上限"
        status={{ tone: 'ok', label: `US$${String(settings.budget.perRunLimitUsd)}` }}
        summary="App 自己每次生成最多花多少：預估超過，那一次就不會開始，會告訴你。"
        body={
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!valid) return
              void update({ budget: { ...settings.budget, perRunLimitUsd: parsed } }).then((ok) => {
                setSaved(ok)
              })
            }}
          >
            <label className="sr-only" htmlFor="per-run-limit">
              每次生成的花費上限（美金）
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
                儲存
              </Button>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              要做更大的就到這裡調高，不會偷偷花錢。預設 US${DEFAULT_PER_RUN_LIMIT_USD}。
            </p>
            {valid ? null : <p className="mt-1 text-sm text-danger">請輸入大於 0 的數字。</p>}
            {saved ? (
              <p role="status" className="mt-1 text-sm text-success">
                已儲存。
              </p>
            ) : null}
          </form>
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
