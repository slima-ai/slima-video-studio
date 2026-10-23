import {
  DEFAULT_QUICK_START_SOUND,
  QUICK_STYLE_IDS,
  QUICK_STYLE_LABELS,
  type OnelinerParams,
  type QuickStartSound,
  t,
  msg,
  type MessageRef,
} from '@svs/schema'
import { Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SimpleSelect } from '../../components/list-select'
import { Spinner } from '../../components/skeleton'
import { useCanvasActions } from './canvas-actions'
import type { CanvasNodeData } from './canvas-model'
import { anchorOf } from './run-confirm'

const STYLE_OPTIONS = QUICK_STYLE_IDS.map((id) => ({ value: id, label: QUICK_STYLE_LABELS[id] }))
// 選項的字要在畫的時候才翻（模組載入時語言還沒定下來），所以是函式
const shotOptions = () =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: t('canvas.shots2', { value: String(i + 1) }),
  }))
const durationOptions = () =>
  Array.from({ length: 13 }, (_, i) => ({
    value: String(i + 3),
    label: t('canvas.secPerShot', { value: String(i + 3) }),
  }))
/** 欄位上方的小標籤：選了、寫了之後還看得出這一格是什麼。 */
const FIELD_LABEL = 'text-[11px] font-medium text-fg-muted'

/** 聲音三個勾選（預設全開）：原聲在生成影片時帶；旁白與配樂在影片完成後自動加。 */
const SOUND_CHOICES: { key: keyof QuickStartSound; label: MessageRef; hint: MessageRef }[] = [
  { key: 'native', label: msg('canvas.videoSound'), hint: msg('canvas.generateSoundAlongWithThe') },
  { key: 'narration', label: msg('canvas.narration'), hint: msg('canvas.readEachShotSLines') },
  { key: 'music', label: msg('canvas.music'), hint: msg('canvas.addBackgroundMusicWhenDone') },
]

const ASPECT_OPTIONS = [
  { value: '16:9', label: msg('canvas.landscape169') },
  { value: '9:16', label: msg('canvas.portrait916') },
]

/**
 * 一句話節點的內容：寫故事、選畫風／鏡頭數／秒數／比例，按「先產生分鏡」先在畫布上長出場與鏡頭（只用文字模型），看過、改好再生圖片和影片；也可以按「一次做完整支」。
 * 文字離開輸入框時存起來；下拉選了就存。生成中顯示「生成中…」與「停止」。
 */
export function OnelinerBody({ id, data }: { id: string; data: CanvasNodeData }) {
  const { growStory, updateOneliner, stopGrow } = useCanvasActions()
  const params = data.oneliner
  const saved = params?.story ?? data.summary ?? ''
  const [story, setStory] = useState(saved)
  const focused = useRef(false)
  // 別處（復原、重新載入）改了故事，而且使用者沒在打字：跟著更新
  useEffect(() => {
    if (!focused.current) setStory(saved)
  }, [saved])
  // 畫風、鏡頭數、秒數、比例：選了馬上換（不等存好、重新載入），按下去用的就是畫面上看到的
  const [picked, setPicked] = useState(params)
  // 剛選了、還沒存好的設定：重新載入讀到的舊值不能蓋掉它（不然選 5 鏡馬上按生成，可能用到上一次存的 3 鏡）
  const unsaved = useRef<Partial<OnelinerParams>>({})
  const key = JSON.stringify(params)
  useEffect(() => {
    if (!params) {
      setPicked(params)
      return
    }
    const waiting = Object.fromEntries(
      Object.entries(unsaved.current).filter(
        ([name, value]) => params[name as keyof OnelinerParams] !== value,
      ),
    ) as Partial<OnelinerParams>
    unsaved.current = waiting
    setPicked({ ...params, ...waiting })
    // 只在存下來的內容真的變了才跟著換；內容一樣的重新載入不能蓋掉剛選的
  }, [key])
  const running = data.status === 'running'
  const commit = (patch: Partial<OnelinerParams>): void => {
    unsaved.current = { ...unsaved.current, ...patch }
    setPicked((current) => (current ? { ...current, ...patch } : current))
    updateOneliner?.(id, patch)
  }
  return (
    <>
      <label className="lod-full flex min-h-0 flex-1 flex-col gap-0.5">
        <span className={FIELD_LABEL}>{t('canvas.story')}</span>
        <textarea
          data-testid="oneliner-story"
          value={story}
          maxLength={4000}
          placeholder={t('canvas.forExampleACatFinds')}
          disabled={running}
          className="nodrag nowheel nopan lod-full min-h-[64px] flex-1 resize-none rounded-lg border border-border bg-surface p-2 text-sm placeholder:text-fg-subtle disabled:opacity-60"
          onFocus={() => {
            focused.current = true
          }}
          onChange={(event) => {
            setStory(event.target.value)
          }}
          onBlur={() => {
            focused.current = false
            if (story !== saved) commit({ story })
          }}
        />
      </label>
      <div className="nodrag nowheel nopan lod-full grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            {t('canvas.style')}
          </span>
          <SimpleSelect
            label={t('canvas.style')}
            testId="oneliner-style"
            value={picked?.style}
            options={STYLE_OPTIONS}
            disabled={running}
            onChange={(value) => {
              const style = STYLE_OPTIONS.find((o) => o.value === value)
              if (style) commit({ style: style.value })
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            {t('canvas.numberOfShots')}
          </span>
          <SimpleSelect
            label={t('canvas.numberOfShots')}
            testId="oneliner-shots"
            value={picked === undefined ? undefined : String(picked.shotCount)}
            options={shotOptions()}
            disabled={running}
            onChange={(value) => {
              commit({ shotCount: Number(value) })
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            {t('canvas.secondsPerShot')}
          </span>
          <SimpleSelect
            label={t('canvas.secondsPerShot')}
            testId="oneliner-duration"
            value={picked === undefined ? undefined : String(picked.durationSec)}
            options={durationOptions()}
            disabled={running}
            onChange={(value) => {
              commit({ durationSec: Number(value) })
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            {t('canvas.aspectRatio')}
          </span>
          <SimpleSelect
            label={t('canvas.aspectRatio')}
            testId="oneliner-aspect"
            value={picked?.aspectRatio}
            options={ASPECT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
            disabled={running}
            onChange={(value) => {
              if (value === '16:9' || value === '9:16') commit({ aspectRatio: value })
            }}
          />
        </div>
      </div>
      {picked ? (
        <fieldset
          className="nodrag lod-full flex flex-wrap items-center gap-x-3 gap-y-1"
          disabled={running}
          data-testid="oneliner-sound"
        >
          <legend className="sr-only">{t('canvas.sound')}</legend>
          <span className={FIELD_LABEL} aria-hidden title={t('canvas.narrationAndMusicMadeWhen')}>
            {t('canvas.sound')}
          </span>
          {SOUND_CHOICES.map(({ key, label, hint }) => (
            <label key={key} className="flex items-center gap-1 text-xs" title={t(hint)}>
              <input
                type="checkbox"
                data-testid={`oneliner-sound-${key}`}
                checked={(picked.sound ?? DEFAULT_QUICK_START_SOUND)[key]}
                onChange={(event) => {
                  commit({
                    sound: {
                      ...(picked.sound ?? DEFAULT_QUICK_START_SOUND),
                      [key]: event.target.checked,
                    },
                  })
                }}
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {picked ? (
        <p
          className="lod-full text-[11px] leading-snug text-fg-muted"
          data-testid="oneliner-sound-note"
        >
          {t('canvas.narrationAndMusicAreAdded')}
        </p>
      ) : null}
      {growStory && picked ? (
        <div className="nodrag lod-full flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              data-testid="oneliner-storyboard"
              disabled={running || story.trim() === ''}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
              onClick={(event) => {
                growStory(
                  id,
                  { ...picked, sound: picked.sound ?? DEFAULT_QUICK_START_SOUND, story },
                  anchorOf(event.currentTarget),
                  'storyboard',
                )
              }}
            >
              {running ? (
                <>
                  <Spinner label={t('canvas.generating')} />
                  {t('canvas.generating3')}
                </>
              ) : (
                t('canvas.writeTheStoryboardFirst')
              )}
            </button>
            {running && stopGrow ? (
              <button
                type="button"
                data-testid="oneliner-stop"
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-fg/10"
                onClick={stopGrow}
              >
                {t('canvas.stop')}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            data-testid="oneliner-generate"
            disabled={running || story.trim() === ''}
            title={t('canvas.generatesTheStoryboardPicturesAnd')}
            className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-fg/10 disabled:opacity-50"
            onClick={(event) => {
              growStory(
                id,
                { ...picked, sound: picked.sound ?? DEFAULT_QUICK_START_SOUND, story },
                anchorOf(event.currentTarget),
                'full',
              )
            }}
          >
            {t('canvas.wholeFilmInOneGo')}
          </button>
          <p className="text-[11px] leading-snug text-fg-muted">
            {t('canvas.writeOnlyTheStoryboardFirst')}
          </p>
        </div>
      ) : null}
      {running ? (
        <p
          data-testid="oneliner-locked"
          className="lod-full flex items-center gap-1 text-[11px] text-fg-muted"
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          {t('canvas.generatingTheStoryAndSettings')}
        </p>
      ) : story.trim() === '' ? (
        <p data-testid="oneliner-locked" className="lod-full text-[11px] text-fg-muted">
          {t('canvas.writeTheStoryFirstTo')}
        </p>
      ) : null}
    </>
  )
}
