import type { CharacterVersion, CharacterView } from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { call, errorText } from '../../lib/svs'
import { useEscape } from '../../lib/use-escape'
import { t, msg } from '@svs/schema'

interface Props {
  character: CharacterView
  onChanged: (character: CharacterView) => void
}

const STATUS_LABEL = { draft: msg('chat.draft'), locked: msg('chat.locked') } as const

/** 版本紀錄：每次鎖定之後再改，都會留下新的一版；舊版本留著，隨時可以拿它的內容重新開始。 */
export function VersionHistory({ character, onChanged }: Props) {
  const [versions, setVersions] = useState<CharacterVersion[]>([])
  const [confirmingId, setConfirmingId] = useState<string>()
  useEscape(confirmingId !== undefined, () => {
    setConfirmingId(undefined)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // 角色換了版本、狀態、描述、主圖或三視圖，就重新讀一次
  const signature = [
    character.version,
    character.anchorStatus,
    character.anchorText,
    character.heroAssetHash ?? '',
    character.turnaround?.front ?? '',
  ].join('|')

  useEffect(() => {
    let alive = true
    call('characters.versions', { characterId: character.id })
      .then(({ versions: list }) => {
        if (alive) setVersions(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [character.id, signature])

  const restore = async (versionId: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      onChanged(await call('characters.restoreVersion', { characterId: character.id, versionId }))
      setConfirmingId(undefined)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (versions.length === 0) return null
  const hasDraft = versions.some((v) => v.current && v.status === 'draft')

  return (
    <section
      aria-label={t('chat.versionHistory')}
      className="space-y-2 rounded-md border border-border p-3"
      data-testid="character-versions"
    >
      <h3 className="text-sm font-medium">{t('chat.versionHistory')}</h3>
      <p className="text-xs text-fg-muted">{t('chat.afterLockingChangingTheLook')}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="space-y-2">
        {versions.map((v) => (
          <li
            key={v.id}
            data-testid={`character-version-${String(v.version)}`}
            data-current={v.current ? 'true' : undefined}
            data-status={v.status}
            className="flex gap-3 rounded-md bg-surface p-2"
          >
            {v.heroAssetHash ? (
              <img
                src={assetUrl(v.heroAssetHash)}
                alt={t('chat.versionMainPicture', { value: String(v.version) })}
                className="size-16 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="size-16 shrink-0 rounded bg-surface-overlay" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {t('chat.version2', { value: String(v.version) })}
                </span>
                <span className="text-xs text-fg-muted">{t(STATUS_LABEL[v.status])}</span>
                {v.current ? (
                  <span className="text-xs text-success">{t('chat.inUseNow')}</span>
                ) : null}
              </div>
              <p className="line-clamp-2 text-xs text-fg-muted">
                {v.anchorText === '' ? t('chat.noFixedAppearanceWritten') : v.anchorText}
              </p>
              {v.turnaround ? (
                <div className="flex gap-1">
                  {[v.turnaround.front, v.turnaround.side, v.turnaround.back].map((hash, i) => (
                    <img
                      key={hash}
                      src={assetUrl(hash)}
                      alt={[t('chat.front'), t('chat.side'), t('chat.back')][i] ?? ''}
                      className="h-10 rounded object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </div>
            {v.current ? null : confirmingId === v.id ? (
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                <span>
                  {hasDraft ? t('chat.theCurrentDraftWillBe') : t('chat.thisStartsANewDraft')}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid={`character-version-restore-confirm-${String(v.version)}`}
                    disabled={busy}
                    onClick={() => void restore(v.id)}
                  >
                    {t('chat.ok')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmingId(undefined)
                    }}
                  >
                    {t('chat.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                className="shrink-0 self-start"
                data-testid={`character-version-restore-${String(v.version)}`}
                disabled={busy}
                onClick={() => {
                  setConfirmingId(v.id)
                }}
              >
                {t('chat.startAgainFromThisVersion')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
