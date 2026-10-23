import {
  KEY_PROVIDERS,
  type KeyStatus,
  type KeyStorageInfo,
  type KeyTestResult,
  t,
  msg,
  type MessageRef,
} from '@svs/schema'
import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'

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
const PURPOSE: Record<string, MessageRef> = {
  fal: msg('settings.lockedCharactersPlusMoreImage'),
  openrouter: msg('settings.textImagesAndVideoAll'),
}

const usd = (n: number): string => `US$${n.toFixed(2)}`

function describeTest(result: KeyTestResult): Feedback {
  if (!result.valid) return { tone: 'error', text: t('settings.theKeyIsInvalidOr') }
  return {
    tone: 'ok',
    text:
      result.balanceUsd === undefined
        ? t('settings.connectedTheKeyWorks')
        : t('settings.connectedTheKeyWorksAbout', { value: usd(result.balanceUsd) }),
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
              label: status.last4
                ? t('settings.setUpEndingIn', { last4: status.last4 })
                : t('settings.setUp2'),
              testId: `key-${id}-status`,
            }
          : { tone: 'off', label: t('settings.notSetUp'), testId: `key-${id}-status` }
      }
      summary={t(PURPOSE[id] ?? msg('settings.useYourOwnAccountTo'))}
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
                return { tone: 'ok', text: t('settings.saved2') }
              })
            }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('settings.apiKey', { name })}
              placeholder={
                configured ? t('settings.pasteANewKeyTo') : t('settings.pasteYourApiKey')
              }
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
              {t('settings.save')}
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
            {t('settings.getAKeyAt', { name })}
          </a>
          {configured ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void run(async () => describeTest(await call('keys.test', { provider: id })))
                }}
              >
                {t('settings.testConnection')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-danger"
                data-testid={`key-${id}-remove`}
                disabled={busy}
                onClick={() => {
                  // 不跳確認框（預設簡單）：移除後說明一聲，要用時再貼上
                  void run(async () => {
                    await call('keys.delete', { provider: id })
                    onChanged()
                    return { tone: 'ok', text: t('settings.removedPasteItAgainWhen') }
                  })
                }}
              >
                {t('settings.removeKey')}
              </Button>
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
          {storage.reason ?? t('settings.thisComputerCanTStore')}
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
