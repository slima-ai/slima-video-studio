import { CHAT_BUDGET_MAX_USD, CHAT_BUDGET_MIN_USD, type AppSettings } from '@svs/schema'
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
            幫你改這個專案，你看得到它用了哪些步驟。需要先裝好並登入 Claude Code，也要打開上面的「AI
            工具連線」。對話會用到你自己的 Claude 用量，花錢的生成步驟照「AI
            工具連線」的額度擋。這是實驗功能，可能隨時改變。
          </span>
        </span>
      </label>
      <BudgetField
        value={settings.experiments.claudeBudgetUsd}
        onChanged={onChanged}
        onError={setError}
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}

/** Claude 對話每一段的用量上限（美金，約）。到上限時對話裡會出現「繼續」，不會斷掉。 */
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
        `每一段的用量上限要在 US$${String(CHAT_BUDGET_MIN_USD)} 到 US$${String(CHAT_BUDGET_MAX_USD)} 之間。`,
      )
      return
    }
    if (next === value) return
    call('settings.update', { experiments: { claudeBudgetUsd: next ?? null } })
      .then(onChanged)
      .catch((e: unknown) => {
        onError(errorText(e))
      })
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-sm">
      <label htmlFor="experiment-claude-budget" className="text-fg-muted">
        Claude 對話每一段的用量上限（美金，約）
      </label>
      <input
        id="experiment-claude-budget"
        data-testid="experiment-claude-budget"
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="0.5"
        className="w-20 rounded-md border border-border bg-surface px-2 py-1"
        onChange={(event) => {
          setText(event.target.value)
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
        }}
      />
      <span className="text-xs text-fg-muted">
        到上限時對話裡會出現「繼續」，按了就接著做；留空用預設（US$0.5）。
      </span>
    </div>
  )
}
