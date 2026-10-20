import { Wallet } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/button'
import { SettingCard } from '../../../components/setting-card'
import { allowanceLight } from './connection-state'
import type { McpConnection } from './use-mcp'

const usd = (value: number): string => `US$${value.toFixed(2)}`

/**
 * AI 工具的總額度：累計、用完為止，預設 0。花的是服務金鑰帳戶的錢；
 * 每一次生成同時受一般設定的「單次花費上限」管。
 */
export function AllowanceCard({ mcp }: { mcp: McpConnection }) {
  const { status } = mcp
  const [typed, setTyped] = useState<string | undefined>()
  const text = typed ?? String(status?.allowanceUsd ?? 0)
  const number = Number(text)
  const valid = text.trim() !== '' && Number.isFinite(number) && number >= 0
  return (
    <SettingCard
      testId="mcp-allowance-card"
      icon={Wallet}
      title="AI 工具的總額度（美金）"
      status={{ ...allowanceLight(status), testId: 'mcp-allowance-status' }}
      summary="Claude 等 AI 工具透過 App 生成時，一共最多能花多少（花的是你服務金鑰帳戶的錢）；預設 US$0，用完就不能再生成。"
      body={
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (valid)
              void mcp.update({ allowanceUsd: number }).then(() => {
                setTyped(undefined)
              })
          }}
        >
          <div className="flex gap-2">
            <input
              data-testid="mcp-allowance"
              aria-label="AI 工具的總額度（美金）"
              inputMode="decimal"
              value={text}
              onChange={(event) => {
                setTyped(event.target.value)
              }}
              className="h-9 w-32 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button type="submit" variant="secondary" disabled={!valid}>
              儲存
            </Button>
          </div>
          {valid ? null : <p className="mt-1 text-sm text-danger">請輸入 0 或更大的數字。</p>}
          {status ? (
            <p data-testid="mcp-committed" className="mt-2 text-sm text-fg-muted">
              已預留 {usd(status.committedUsd)}，還能花{' '}
              {usd(Math.max(status.allowanceUsd - status.committedUsd, 0))}。
            </p>
          ) : null}
        </form>
      }
      details={
        <div className="space-y-2 text-sm text-fg-muted">
          <p>
            只有你能改這個數字，AI
            工具改不了。要花錢的步驟（文字、圖片、影片）會先用預估金額預留，預留的金額不會因為實際花得比較少而退回；超過就拒絕。
          </p>
          <p>AI 工具的每一次生成，也受「一般」裡的「單次花費上限」管。示範模式不花錢。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="mcp-reset"
              disabled={!status || status.committedUsd === 0}
              onClick={mcp.resetCommitted}
            >
              已用的歸零
            </Button>
            <span>歸零後，可以再花同樣的額度。</span>
          </div>
        </div>
      }
    />
  )
}
