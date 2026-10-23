import { LANGUAGE_NAMES, LANGUAGE_PREFERENCES, t, type LanguagePreference } from '@svs/schema'
import { Languages } from 'lucide-react'
import { useEffect, useState } from 'react'

import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'

export interface LanguageCardProps {
  value: LanguagePreference
  onChanged: () => void
}

const nameOf = (option: LanguagePreference): string =>
  option === 'system' ? t('settings.followSystem') : LANGUAGE_NAMES[option]

/**
 * 介面語言。英文介面還沒全部做完（ENGLISH_UI_READY 是 false）之前放在「實驗功能」，不給一般使用者看到半英文半中文；
 * 做完那支 PR 會搬到「一般」。換了之後主行程會通知畫面整個重畫（見 docs/i18n.md）。
 */
export function LanguageCard({ value, onChanged }: LanguageCardProps) {
  // 先照使用者的操作換，畫面立刻有反應；存失敗再換回來
  const [chosen, setChosen] = useState(value)
  useEffect(() => {
    setChosen(value)
  }, [value])
  const [error, setError] = useState<string>()

  return (
    <SettingCard
      icon={Languages}
      title={t('settings.language')}
      status={{ tone: 'ok', label: nameOf(chosen) }}
      summary={t('settings.languageSummary')}
      body={
        <fieldset>
          <legend className="sr-only">{t('settings.language')}</legend>
          <div className="inline-flex max-w-full flex-wrap rounded-md border border-border bg-surface p-0.5">
            {LANGUAGE_PREFERENCES.map((option) => (
              <label
                key={option}
                className="cursor-pointer whitespace-nowrap rounded px-3 py-1.5 text-sm text-fg-muted transition-colors duration-200 has-checked:bg-surface-overlay has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="language"
                  value={option}
                  data-testid={`language-${option}`}
                  checked={chosen === option}
                  onChange={() => {
                    const previous = chosen
                    setChosen(option)
                    setError(undefined)
                    call('settings.update', { language: option })
                      .then(onChanged)
                      .catch((e: unknown) => {
                        setChosen(previous)
                        setError(errorText(e))
                      })
                  }}
                  className="sr-only"
                />
                {nameOf(option)}
              </label>
            ))}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </fieldset>
      }
    />
  )
}
