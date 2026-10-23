import { Wallet } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { allowanceLight } from './connection-state'
import type { McpConnection } from './use-mcp'
import { t } from '@svs/schema'

const usd = (value: number): string => `US$${value.toFixed(2)}`

/**
 * AI 工具的總額度：累計、用完為止，預設 0。花的是服務金鑰帳戶的錢；
 * 每一次生成同時受一般設定的「單次花費上限」管。
 */
export function AllowanceCard({ mcp }: { mcp: McpConnection }) {
  const { status } = mcp
  const [typed, setTyped] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)
  const stored = status?.allowanceUsd ?? 0
  const text = typed ?? String(stored)
  const number = Number(text)
  const valid = text.trim() !== '' && Number.isFinite(number) && number >= 0
  // 打了但跟已存的不一樣：旁邊提醒「還沒儲存」（切走就會丟掉）
  const unsaved = typed !== undefined && !(valid && number === stored)
  /** 成功才清掉輸入；失敗時打的數字留著，錯誤顯示在輸入框旁邊。 */
  const save = (): void => {
    if (!valid) return
    setFailed(false)
    void mcp.update({ allowanceUsd: number }).then((ok) => {
      if (ok) setTyped(undefined)
      else setFailed(true)
    })
  }
  return (
    <SettingCard
      testId="mcp-allowance-card"
      icon={Wallet}
      title={t('settings.totalAllowanceForAiTools')}
      status={{ ...allowanceLight(status), testId: 'mcp-allowance-status' }}
      summary={t('settings.theMostAiToolsLike')}
      body={
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="flex gap-2">
            <input
              data-testid="mcp-allowance"
              aria-label={t('settings.totalAllowanceForAiTools')}
              inputMode="decimal"
              value={text}
              onChange={(event) => {
                setTyped(event.target.value)
                setFailed(false)
              }}
              onKeyDown={(event) => {
                // Enter 就是「儲存」（不跳確認框）
                if (event.key !== 'Enter') return
                event.preventDefault()
                save()
              }}
              className="h-9 w-32 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button type="submit" variant="secondary" disabled={!valid}>
              {t('settings.save')}
            </Button>
            {unsaved && valid ? (
              <span
                data-testid="mcp-allowance-unsaved"
                className="self-center text-sm text-warning"
              >
                {t('settings.notSavedYet')}
              </span>
            ) : null}
          </div>
          {failed && mcp.error ? (
            <p role="alert" data-testid="mcp-allowance-error" className="mt-1 text-sm text-danger">
              {mcp.error}
            </p>
          ) : null}
          {valid ? null : (
            <p className="mt-1 text-sm text-danger">{t('settings.enter0OrALarger')}</p>
          )}
          {status ? (
            <div className="mt-2 space-y-1 text-sm text-fg-muted">
              <p data-testid="mcp-committed">
                {t('settings.reservedLeftToSpend', {
                  value: usd(status.committedUsd),
                  value2: usd(Math.max(status.allowanceUsd - status.committedUsd, 0)),
                })}
              </p>
              {status.spentUsd === undefined ? null : (
                <p data-testid="mcp-spent">
                  {t('settings.projectSpentSoFar', { value: usd(status.spentUsd) })}
                </p>
              )}
              <p data-testid="mcp-refund-note">{t('settings.reservationRefundNote')}</p>
            </div>
          ) : null}
        </form>
      }
      details={
        <div className="space-y-2 text-sm text-fg-muted">
          <p>{t('settings.onlyYouCanChangeThis')}</p>
          <p>{t('settings.everyGenerationByAnAi')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="mcp-reset"
              disabled={!status || status.committedUsd === 0}
              onClick={mcp.resetCommitted}
            >
              {t('settings.resetUsedAmount')}
            </Button>
            <span>{t('settings.afterAResetTheSame')}</span>
          </div>
        </div>
      }
    />
  )
}
