import type { TrailerPlanCheck, TrailerStatus } from '@svs/schema'
import { secLabel, t } from '@svs/schema'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '../../components/button'
import { SimpleSelect } from '../../components/list-select'
import { cn } from '../../lib/cn'
import { call, errorText } from '../../lib/svs'
import { TRAILER_LENGTHS } from './trailer-start'

/** 面板寬度（窄視窗會縮到視窗寬減 24）。 */
const PANEL_WIDTH = 320

const FIELD =
  'w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-normal placeholder:text-fg-subtle'

/** 頂列上的標籤長度部分：「30／30 秒」（腳本加總／目標）。 */
export function trailerBadgeLength(status: TrailerStatus): string {
  return t('trailer.badgeLength', {
    script: secLabel(status.scriptSec),
    target: secLabel(status.targetSec),
  })
}

/** 頂列上的標籤文字：「預告片 30／30 秒」。 */
export function trailerBadgeText(status: TrailerStatus): string {
  return `${t('trailer.badgeName')} ${trailerBadgeLength(status)}`
}

/** 一個設定欄位：離開輸入框才存，沒改就不存。 */
function TextSetting({
  testId,
  label,
  placeholder,
  value,
  onSave,
}: {
  testId: string
  label: string
  placeholder?: string
  value: string
  onSave: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <input
        data-testid={testId}
        className={FIELD}
        value={draft}
        maxLength={200}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={() => {
          if (draft.trim() !== value) onSave(draft.trim())
        }}
      />
    </label>
  )
}

/**
 * 頂列的預告片標籤與設定面板：腳本加總／目標長度（對不上時用警示色），
 * 點開可以改長度與書名等設定、「自動調整」各格秒數、用原文「重寫腳本」。
 * 一般專案（沒有預告片設定）不顯示。
 */
export function TrailerBadge({ status }: { status: TrailerStatus | undefined }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'rewrite' | 'fit' | 'save'>()
  const [check, setCheck] = useState<TrailerPlanCheck>()
  const [confirming, setConfirming] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // 面板用視窗座標放（夾在畫面內，窄視窗也不會伸出左右邊，也不會撐出畫布）
  const [at, setAt] = useState<{ left: number; top: number; width: number; maxHeight: number }>()
  const source = status?.settings.sourceText ?? ''

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = button.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 24)
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
      const top = rect.bottom + 8
      // 下面留給生成佇列的標題列
      setAt({ left, top, width, maxHeight: Math.max(160, window.innerHeight - top - 56) })
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    const onDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        (root.current?.contains(event.target) || panel.current?.contains(event.target))
      )
        return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  // 打開面板時問一次：重寫要花多少、會取代幾格
  useEffect(() => {
    if (!open || source === '') return
    let stale = false
    call('trailer.check', { text: source })
      .then((next) => {
        if (!stale) setCheck(next)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [open, source, status?.beatCount])

  if (!status?.exists) return null
  const { settings } = status
  // 旁白念不完的格子不在這裡列（標在那幾格上）；其他錯誤照列
  const otherErrors = status.errors.filter((e) => e.code !== 'narration_too_dense')
  const lengths: number[] = TRAILER_LENGTHS.includes(settings.targetSec as 15)
    ? [...TRAILER_LENGTHS]
    : [...TRAILER_LENGTHS, settings.targetSec].sort((a, b) => a - b)

  const save = (patch: Record<string, unknown>, refit = false): void => {
    setBusy(refit ? 'fit' : 'save')
    setError(undefined)
    call('trailer.update', { patch, ...(refit ? { refit } : {}) })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(undefined)
      })
  }

  const rewrite = (): void => {
    setConfirming(false)
    setBusy('rewrite')
    setError(undefined)
    call('trailer.plan', {
      text: source,
      kind: settings.kind,
      targetSec: settings.targetSec,
      title: settings.title,
      author: settings.author,
      tagline: settings.tagline,
      endLine: settings.endLine,
      narration: settings.narration,
      music: settings.music,
      musicMood: settings.musicMood,
      claims: settings.claims,
    })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
      .finally(() => {
        setBusy(undefined)
      })
  }

  const onRewrite = (): void => {
    if (check !== undefined && check.existingBeats > 0) setConfirming(true)
    else rewrite()
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        data-testid="trailer-badge"
        data-matches={status.matches}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[13px] font-semibold',
          status.matches
            ? 'border-border bg-surface-raised text-fg'
            : 'border-warning bg-warning/10 text-warning',
        )}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        {/* 窄視窗頂列擠：只留長度，名字藏起來（螢幕閱讀器與文字內容仍然完整） */}
        <span className="hidden sm:inline">{t('trailer.badgeName')} </span>
        {trailerBadgeLength(status)}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label={t('trailer.panel.title')}
              data-testid="trailer-panel"
              style={
                at
                  ? { left: at.left, top: at.top, width: at.width, maxHeight: at.maxHeight }
                  : { visibility: 'hidden' }
              }
              className="fixed z-40 flex flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-4 shadow-panel"
            >
              <header className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('trailer.panel.title')}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                  }}
                >
                  {t('trailer.panel.close')}
                </Button>
              </header>
              {!status.matches ? (
                <div
                  data-testid="trailer-mismatch"
                  className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/10 p-2.5 text-xs text-warning"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="trailer-fit"
                    disabled={busy !== undefined}
                    onClick={() => {
                      save({}, true)
                    }}
                  >
                    {t('trailer.panel.fit')}
                  </Button>
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="shrink-0">{t('trailer.panel.length')}</span>
                <div className="min-w-0 flex-1">
                  <SimpleSelect
                    testId="trailer-panel-length"
                    label={t('trailer.panel.length')}
                    value={String(settings.targetSec)}
                    disabled={busy !== undefined}
                    options={lengths.map((n) => ({
                      value: String(n),
                      label: t('trailer.lengthSec', { n }),
                    }))}
                    onChange={(value) => {
                      save({ targetSec: Number(value) }, true)
                    }}
                  />
                </div>
              </div>
              <TextSetting
                testId="trailer-panel-title"
                label={t('trailer.panel.titleLabel')}
                value={settings.title}
                onSave={(title) => {
                  save({ title })
                }}
              />
              <TextSetting
                testId="trailer-panel-author"
                label={t('trailer.panel.author')}
                value={settings.author}
                onSave={(author) => {
                  save({ author })
                }}
              />
              <TextSetting
                testId="trailer-panel-tagline"
                label={t('trailer.panel.tagline')}
                value={settings.tagline}
                onSave={(tagline) => {
                  save({ tagline })
                }}
              />
              <TextSetting
                testId="trailer-panel-endline"
                label={t('trailer.panel.endLine')}
                placeholder={t('trailer.panel.endLinePlaceholder')}
                value={settings.endLine}
                onSave={(endLine) => {
                  save({ endLine })
                }}
              />
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    data-testid="trailer-panel-narration"
                    checked={settings.narration}
                    onChange={(event) => {
                      save({ narration: event.target.checked })
                    }}
                  />
                  {t('trailer.panel.narration')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    data-testid="trailer-panel-music"
                    checked={settings.music}
                    onChange={(event) => {
                      save({ music: event.target.checked })
                    }}
                  />
                  {t('trailer.panel.music')}
                </label>
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                {source === '' ? null : confirming && check ? (
                  <div data-testid="trailer-rewrite-confirm" className="flex flex-col gap-2">
                    {check.generatedBeats > 0 ? (
                      <p className="text-xs text-warning">
                        {t('trailer.panel.replaceWarn', { generated: check.generatedBeats })}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="trailer-rewrite-ok"
                        onClick={rewrite}
                      >
                        {t('trailer.panel.rewriteConfirm')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirming(false)
                        }}
                      >
                        {t('trailer.panel.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      data-testid="trailer-rewrite"
                      disabled={busy !== undefined || !check?.ok}
                      onClick={onRewrite}
                    >
                      {busy === 'rewrite'
                        ? t('trailer.panel.rewriting')
                        : check === undefined
                          ? t('trailer.panel.rewrite')
                          : check.demoMode
                            ? t('trailer.panel.rewrite')
                            : t('trailer.panel.rewriteReal', {
                                usd: check.estimatedUsd.toFixed(2),
                              })}
                    </Button>
                  </>
                )}
              </div>
              {status.errors.length + status.warnings.length > 0 ? (
                <div data-testid="trailer-issues-box" className="flex flex-col gap-2 text-xs">
                  <ul data-testid="trailer-issues" className="flex flex-col gap-1">
                    {otherErrors.map((issue, i) => (
                      <li key={`e${String(i)}`} className="text-danger">
                        {issue.message}
                      </li>
                    ))}
                    {status.warnings.map((issue, i) => (
                      <li key={`w${String(i)}`} className="text-warning">
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {error !== undefined ? (
                <p
                  role="alert"
                  data-testid="trailer-panel-error"
                  className="whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger"
                >
                  {error}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
