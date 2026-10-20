import { KEY_PROVIDERS, type KeyStatus, type KeyStorageInfo, type KeyTestResult } from '@svs/schema'
import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'
import { useEscape } from '../../lib/use-escape'

export interface KeysSectionProps {
  keys: KeyStatus[]
  storage: KeyStorageInfo
  /** Key 有任何變動（儲存、移除）之後呼叫，讓上層重新載入。 */
  onChanged: () => void
  /** 只列這幾家（第一次使用的精靈只引導 OpenRouter 一把）；沒給就全部列。 */
  only?: readonly string[]
}

interface Feedback {
  tone: 'ok' | 'error'
  text: string
}

/** 每家服務在這個 App 裡負責什麼（用白話）。 */
const PURPOSE: Record<string, string> = {
  fal: '角色鎖定、更多圖片與影片模型。',
  openrouter: '文字、圖片、影片都能做，只填這一把就夠。',
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

function describeTest(result: KeyTestResult): Feedback {
  if (!result.valid) return { tone: 'error', text: '金鑰無效或已被停用，請重新複製一次。' }
  return {
    tone: 'ok',
    text:
      result.balanceUsd === undefined
        ? '連線成功，金鑰有效。'
        : `連線成功，金鑰有效。帳戶剩餘約 ${usd(result.balanceUsd)}。`,
  }
}

function KeyRow({
  id,
  name,
  keyUrl,
  status,
  disabled,
  onChanged,
}: {
  id: string
  name: string
  keyUrl: string
  status: KeyStatus | undefined
  disabled: boolean
  onChanged: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | undefined>()
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  useEscape(confirmingRemove, () => {
    setConfirmingRemove(false)
  })
  const configured = status?.configured === true

  // 成功的提示過幾秒自己淡出；錯誤要留著讓人看完
  useEffect(() => {
    if (feedback?.tone !== 'ok') return undefined
    const timer = setTimeout(() => {
      setFeedback(undefined)
    }, 3000)
    return () => {
      clearTimeout(timer)
    }
  }, [feedback])

  const run = async (action: () => Promise<Feedback | undefined>): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    try {
      setFeedback(await action())
    } catch (error) {
      setFeedback({ tone: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCard
      icon={KeyRound}
      title={name}
      testId={`key-${id}`}
      status={
        configured
          ? {
              tone: 'ok',
              label: `已設定${status.last4 ? `（結尾 ${status.last4}）` : ''}`,
              testId: `key-${id}-status`,
            }
          : { tone: 'off', label: '尚未設定', testId: `key-${id}-status` }
      }
      summary={PURPOSE[id] ?? '用你自己的帳號呼叫這家服務。'}
      body={
        <div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                await call('keys.set', { provider: id, key: value })
                setValue('')
                onChanged()
                return { tone: 'ok', text: '已儲存。' }
              })
            }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`${name} 的服務金鑰`}
              placeholder={configured ? '貼上新的金鑰可以替換' : '貼上你的服務金鑰'}
              value={value}
              disabled={disabled || busy}
              onChange={(event) => {
                setValue(event.target.value)
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={disabled || busy || value.trim() === ''}
            >
              儲存
            </Button>
          </form>
          {feedback ? (
            <p
              role="status"
              data-testid={`key-${id}-feedback`}
              className={`mt-2 animate-fade-in text-sm ${feedback.tone === 'ok' ? 'text-success' : 'text-danger'}`}
            >
              {feedback.text}
            </p>
          ) : null}
        </div>
      }
      details={
        <div className="space-y-3">
          <a
            href={keyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent hover:underline"
          >
            到 {name} 取得金鑰
          </a>
          {configured ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void run(async () => describeTest(await call('keys.test', { provider: id })))
                }}
              >
                測試連線
              </Button>
              {confirmingRemove ? (
                <>
                  <span className="text-sm text-fg-muted">移除後就不能生成了，確定嗎？</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    data-testid={`key-${id}-remove-confirm`}
                    disabled={busy}
                    onClick={() => {
                      setConfirmingRemove(false)
                      void run(async () => {
                        await call('keys.delete', { provider: id })
                        onChanged()
                        return { tone: 'ok', text: '已移除這把金鑰。' }
                      })
                    }}
                  >
                    確定移除
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirmingRemove(false)
                    }}
                  >
                    不移除
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:text-danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingRemove(true)
                  }}
                >
                  移除金鑰
                </Button>
              )}
            </div>
          ) : null}
        </div>
      }
    />
  )
}

/** 填入、測試、移除各家服務的服務金鑰。金鑰只會送到主行程加密保存，畫面上永遠看不到完整內容。 */
export function KeysSection({ keys, storage, onChanged, only }: KeysSectionProps) {
  return (
    <div className="contents" data-testid="keys-section">
      {storage.available ? null : (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger md:col-span-2">
          {storage.reason ?? '這台電腦目前無法安全保存金鑰。'}
        </p>
      )}
      {KEY_PROVIDERS.filter((p) => only === undefined || only.includes(p.id)).map((provider) => (
        <KeyRow
          key={provider.id}
          id={provider.id}
          name={provider.name}
          keyUrl={provider.keyUrl}
          status={keys.find((k) => k.provider === provider.id)}
          disabled={!storage.available}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}
