import {
  DEFAULT_PER_RUN_LIMIT_USD,
  THEME_PREFERENCES,
  type AppSettings,
  type ThemePreference,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { Section } from '../../components/section'
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

/** 外觀、示範模式、進階模式與花費上限。 */
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

  return (
    <Section testId="general-section" title="一般">
      <fieldset>
        <legend className="text-sm font-medium">外觀</legend>
        <div className="mt-2 inline-flex rounded-md border border-border bg-surface p-0.5">
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

      <label className="mt-4 flex items-start gap-3">
        <input
          type="checkbox"
          data-testid="demo-mode"
          checked={demo}
          onChange={(event) => {
            const { checked } = event.target
            setDemo(checked)
            void update({ demoMode: checked }).then((ok) => {
              if (!ok) setDemo(!checked)
            })
          }}
          className="mt-1 size-4"
        />
        <span>
          <span className="block text-sm font-medium">示範模式</span>
          <span className="block text-sm text-fg-muted">
            用假的結果跑完整個流程，不需要金鑰、不會花錢。適合先熟悉操作。
          </span>
        </span>
      </label>

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          void update({ budget: { ...settings.budget, perRunLimitUsd: parsed } }).then((ok) => {
            setSaved(ok)
          })
        }}
      >
        <label className="block text-sm font-medium" htmlFor="per-run-limit">
          每次生成的花費上限（美金）
        </label>
        <p className="text-sm text-fg-muted">
          預估花費超過這個金額時會先停下來問你，不會偷偷花錢。預設 US${DEFAULT_PER_RUN_LIMIT_USD}。
        </p>
        <div className="mt-2 flex gap-2">
          <input
            id="per-run-limit"
            data-testid="per-run-limit"
            inputMode="decimal"
            value={limit}
            onChange={(event) => {
              setLimit(event.target.value)
              setSaved(false)
            }}
            className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <Button type="submit" variant="secondary" disabled={!valid}>
            儲存
          </Button>
        </div>
        {valid ? null : <p className="mt-1 text-sm text-danger">請輸入大於 0 的數字。</p>}
        {saved ? (
          <p role="status" className="mt-1 text-sm text-success">
            已儲存。
          </p>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
