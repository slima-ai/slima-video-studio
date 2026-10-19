import { useState } from 'react'

import { Button } from '../../components/button'
import { call, errorText } from '../../lib/svs'
import { KeysSection } from '../settings/keys-section'
import type { AppData } from '../settings/use-app-data'

export interface SetupWizardProps {
  data: AppData
  /** 資料有變動（填了 Key）→ 重新載入。 */
  reload: () => void
  /** 引導完成或略過之後呼叫（上層會重新載入設定，並進入主畫面）。 */
  onDone: () => void
}

/** 第一次開啟時的引導：先試玩（示範模式），或填入服務金鑰。 */
export function SetupWizard({ data, reload, onDone }: SetupWizardProps) {
  const [step, setStep] = useState<'welcome' | 'keys'>('welcome')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const hasKey = data.keys.some((k) => k.configured)

  const finish = (patch: { demoMode: boolean }): void => {
    setBusy(true)
    setError(undefined)
    call('settings.update', { onboardingDone: true, ...patch })
      .then(onDone)
      .catch((e: unknown) => {
        setError(errorText(e))
        setBusy(false)
      })
  }

  return (
    <div className="flex h-full items-center justify-center p-6" data-testid="setup-wizard">
      <div className="w-full max-w-xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold">歡迎使用 Slima Video Studio</h1>
          <p className="mt-2 text-fg-muted">
            把你的故事做成 AI
            影片：先自動分成一個個畫面，再逐一生成畫面和影片，最後接成一支完整的片。
          </p>
        </header>

        {step === 'welcome' ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">想怎麼開始？</p>
            <button
              type="button"
              data-testid="wizard-demo"
              disabled={busy}
              onClick={() => {
                finish({ demoMode: true })
              }}
              className="w-full rounded-lg border border-border bg-surface-raised shadow-card p-4 text-left hover:border-accent disabled:opacity-50"
            >
              <span className="block font-medium">先試玩看看</span>
              <span className="block text-sm text-fg-muted">
                用假的結果走完整個流程，不需要金鑰、不會花錢。之後隨時可以到設定改成真的。
              </span>
            </button>
            <button
              type="button"
              data-testid="wizard-keys"
              disabled={busy}
              onClick={() => {
                setStep('keys')
              }}
              className="w-full rounded-lg border border-border bg-surface-raised shadow-card p-4 text-left hover:border-accent disabled:opacity-50"
            >
              <span className="block font-medium">我有服務金鑰（API Key）</span>
              <span className="block text-sm text-fg-muted">
                填一把 OpenRouter 的金鑰，就能生成真正的文字、圖片和影片。
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <KeysSection
              keys={data.keys}
              storage={data.storage}
              onChanged={reload}
              only={['openrouter']}
            />
            <p className="text-sm text-fg-muted" data-testid="wizard-more-keys">
              只要這一把就能做出完整的影片。之後想用角色鎖定或更多模型，再到「設定」填 fal.ai
              的金鑰。
            </p>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep('welcome')
                }}
              >
                返回
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  data-testid="wizard-skip"
                  disabled={busy}
                  onClick={() => {
                    finish({ demoMode: false })
                  }}
                >
                  稍後再填
                </Button>
                <Button
                  variant="primary"
                  data-testid="wizard-finish"
                  disabled={busy || !hasKey}
                  onClick={() => {
                    finish({ demoMode: false })
                  }}
                >
                  完成
                </Button>
              </div>
            </div>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
