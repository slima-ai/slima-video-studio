import { BookText, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'
import { t } from '@svs/schema'

export interface GuideEditorCardProps {
  /** 設定裡存這份指南的欄位。 */
  field: 'storyboardGuide' | 'productionGuide'
  /** 設定裡目前存的自訂內容（空字串＝用預設）。 */
  custom: string
  defaultText: string
  /** 這段文字算不算「內建預設」（預設有好幾種語言時用；沒給就只跟 defaultText 比）。 */
  isDefault?: (text: string) => boolean
  maxChars: number
  /** 實際使用的內容：沒自訂就是預設。 */
  resolve: (custom: string) => string
  /** 元素 id 與測試標記的前綴，例如 storyboard-guide。 */
  idPrefix: string
  title: string
  summary: string
  /** 存好之後的提示，例如「已儲存，下次拆鏡就會用這份準則。」 */
  savedMessage: string
  icon?: LucideIcon
  rows?: number
  onChanged: () => void
}

/** 一份「預設內容、使用者看得到也改得動、可以一鍵恢復」的指南（分鏡準則、製片與一致性指南共用）。 */
export function GuideEditorCard({
  field,
  custom,
  defaultText,
  isDefault,
  maxChars,
  resolve,
  idPrefix,
  title,
  summary,
  savedMessage,
  icon = BookText,
  rows = 14,
  onChanged,
}: GuideEditorCardProps) {
  const saved = resolve(custom)
  const [text, setText] = useState(saved)
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState('')
  // 設定從別的地方改過（或剛存好重讀）時，輸入框跟著更新
  useEffect(() => {
    setText(saved)
  }, [saved])

  const isDefaultText = isDefault ?? ((value: string) => value.trim() === defaultText.trim())
  const customized = custom.trim() !== '' && !isDefaultText(custom)
  const dirty = text.trim() !== saved.trim()
  const tooLong = text.length > maxChars

  const save = (guide: string, message: string): void => {
    setError(undefined)
    setDone(false)
    call('settings.update', { [field]: guide })
      .then(() => {
        setDone(true)
        setStatus(message)
        onChanged()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <div className="contents" data-testid={`${idPrefix}-section`}>
      <SettingCard
        icon={icon}
        title={title}
        className="md:col-span-2"
        status={
          customized
            ? { tone: 'ok', label: t('settings.edited') }
            : { tone: 'off', label: t('settings.default') }
        }
        summary={summary}
        details={
          <div>
            <label className="sr-only" htmlFor={idPrefix}>
              {title}
            </label>
            <textarea
              id={idPrefix}
              data-testid={idPrefix}
              value={text}
              rows={rows}
              onChange={(event) => {
                setText(event.target.value)
                setDone(false)
              }}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed"
            />
            <p className={`mt-1 text-sm ${tooLong ? 'text-danger' : 'text-fg-muted'}`}>
              {tooLong
                ? t('settings.charactersTooLongPleaseShorten', {
                    value: String(text.length),
                    value2: String(maxChars),
                  })
                : t('settings.characters', {
                    value: String(text.length),
                    value2: String(maxChars),
                  })}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={!dirty || tooLong}
                onClick={() => {
                  // 改回跟預設一模一樣就存成「用預設」，之後預設更新時才會跟著更新
                  const guide = isDefaultText(text) ? '' : text
                  save(guide, savedMessage)
                }}
              >
                {t('settings.save')}
              </Button>
              <Button
                variant="secondary"
                disabled={!customized && !dirty}
                onClick={() => {
                  setText(defaultText)
                  save('', t('settings.defaultRestored'))
                }}
              >
                {t('settings.restoreDefault')}
              </Button>
              {done ? (
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
