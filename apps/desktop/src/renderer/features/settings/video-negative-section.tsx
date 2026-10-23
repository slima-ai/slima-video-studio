import { NEGATIVE_PROMPT_MAX_CHARS, type AppSettings, type ModelOption, t } from '@svs/schema'
import { Ban } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'

export interface VideoNegativeSectionProps {
  settings: AppSettings
  /** 現在用來生影片的模型；沒有就是還沒選。 */
  videoModel: ModelOption | undefined
  onChanged: () => void
}

/** 影片的負面提示：告訴影片模型不要出現什麼（通用的畫質字）。看得到、改得動，也可以一鍵恢復預設；角色自己的特徵在角色頁設定。 */
export function VideoNegativeSection({
  settings,
  videoModel,
  onChanged,
}: VideoNegativeSectionProps) {
  const builtIn = videoModel?.negativePromptDefault
  const saved = settings.videoNegativePrompt
  const shown = saved !== '' ? saved : (builtIn ?? '')
  const [text, setText] = useState(shown)
  const [error, setError] = useState<string | undefined>()
  const [status, setStatus] = useState('')
  useEffect(() => {
    setText(shown)
  }, [shown])

  const customized = saved !== ''
  const dirty = text.trim() !== shown.trim()
  const tooLong = text.length > NEGATIVE_PROMPT_MAX_CHARS

  const save = (value: string, message: string): void => {
    setError(undefined)
    setStatus('')
    call('settings.update', { videoNegativePrompt: value })
      .then(() => {
        setStatus(message)
        onChanged()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <div className="contents" data-testid="video-negative-section">
      <SettingCard
        icon={Ban}
        title={t('settings.negativePromptForVideo')}
        className="md:col-span-2"
        status={
          customized
            ? { tone: 'ok', label: t('settings.edited') }
            : { tone: 'off', label: t('settings.default') }
        }
        summary={
          builtIn === undefined
            ? t('settings.theCurrentVideoModelDoesn')
            : t('settings.tellTheVideoModelWhat')
        }
        details={
          <div>
            <label className="sr-only" htmlFor="video-negative">
              {t('settings.negativePromptForVideo')}
            </label>
            <textarea
              id="video-negative"
              data-testid="video-negative"
              value={text}
              rows={4}
              disabled={builtIn === undefined && !customized}
              onChange={(event) => {
                setText(event.target.value)
                setStatus('')
              }}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed"
            />
            <p className={`mt-1 text-sm ${tooLong ? 'text-danger' : 'text-fg-muted'}`}>
              {tooLong
                ? t('settings.charactersTooLongPleaseShorten', {
                    value: String(text.length),
                    value2: String(NEGATIVE_PROMPT_MAX_CHARS),
                  })
                : t('settings.characters', {
                    value: String(text.length),
                    value2: String(NEGATIVE_PROMPT_MAX_CHARS),
                  })}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={!dirty || tooLong}
                onClick={() => {
                  // 改回跟預設一模一樣就存成「用預設」，之後預設更新時才會跟著更新
                  const value = text.trim() === (builtIn ?? '').trim() ? '' : text.trim()
                  save(value, t('settings.savedTheNextVideoGeneration'))
                }}
              >
                {t('settings.save')}
              </Button>
              <Button
                variant="secondary"
                disabled={!customized && !dirty}
                onClick={() => {
                  setText(builtIn ?? '')
                  save('', t('settings.defaultRestored'))
                }}
              >
                {t('settings.restoreDefault')}
              </Button>
              {status ? (
                <span role="status" className="text-sm text-success">
                  {status}
                </span>
              ) : null}
            </div>
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
