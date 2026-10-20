import type { AppSettings } from '@svs/schema'
import { useEffect, useState } from 'react'

import { Section } from '../../components/section'
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
    <Section testId="experiments-section" title="實驗功能">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          data-testid="experiment-claude-chat"
          checked={on}
          className="mt-1"
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
        <span className="text-sm">
          <span className="font-medium">畫布右下角的 Claude 對話</span>
          <span className="mt-1 block text-fg-muted">
            在畫布右邊開一個對話面板，用你電腦上已經登入的 Claude Code
            幫你改這個專案，你看得到它用了哪些步驟。 需要先裝好並登入 Claude
            Code，也要打開上面的「AI 工具連線」。對話會用到你自己的 Claude 用量，
            花錢的生成步驟照「AI 工具連線」的額度擋。這是實驗功能，可能隨時改變。
          </span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
