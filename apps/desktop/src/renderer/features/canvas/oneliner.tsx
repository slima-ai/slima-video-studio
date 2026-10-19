import { QUICK_STYLE_IDS, QUICK_STYLE_LABELS, type OnelinerParams } from '@svs/schema'
import { Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SimpleSelect } from '../../components/list-select'
import { Spinner } from '../../components/skeleton'
import { useCanvasActions } from './canvas-actions'
import type { CanvasNodeData } from './canvas-model'
import { anchorOf } from './run-confirm'

const STYLE_OPTIONS = QUICK_STYLE_IDS.map((id) => ({ value: id, label: QUICK_STYLE_LABELS[id] }))
const SHOT_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: `${String(i + 1)} 個鏡頭`,
}))
const DURATION_OPTIONS = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 3),
  label: `每鏡 ${String(i + 3)} 秒`,
}))
/** 欄位上方的小標籤：選了、寫了之後還看得出這一格是什麼。 */
const FIELD_LABEL = 'text-[11px] font-medium text-fg-muted'

const ASPECT_OPTIONS = [
  { value: '16:9', label: '橫式 16:9' },
  { value: '9:16', label: '直式 9:16' },
]

/**
 * 一句話節點的內容：寫故事、選畫風／鏡頭數／秒數／比例，按「生成影片」就在畫布上長出整支短片。
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
  // 畫風、鏡頭數、秒數、比例：選了馬上換（不等存好、重新載入），按「生成影片」用的就是畫面上看到的
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
        <span className={FIELD_LABEL}>故事</span>
        <textarea
          data-testid="oneliner-story"
          value={story}
          maxLength={4000}
          placeholder="例如：一隻貓在下雨的夜晚找到溫暖的家"
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
            畫風
          </span>
          <SimpleSelect
            label="畫風"
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
            鏡頭數
          </span>
          <SimpleSelect
            label="鏡頭數"
            testId="oneliner-shots"
            value={picked === undefined ? undefined : String(picked.shotCount)}
            options={SHOT_OPTIONS}
            disabled={running}
            onChange={(value) => {
              commit({ shotCount: Number(value) })
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            每鏡幾秒
          </span>
          <SimpleSelect
            label="每鏡幾秒"
            testId="oneliner-duration"
            value={picked === undefined ? undefined : String(picked.durationSec)}
            options={DURATION_OPTIONS}
            disabled={running}
            onChange={(value) => {
              commit({ durationSec: Number(value) })
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL} aria-hidden>
            畫面比例
          </span>
          <SimpleSelect
            label="畫面比例"
            testId="oneliner-aspect"
            value={picked?.aspectRatio}
            options={ASPECT_OPTIONS}
            disabled={running}
            onChange={(value) => {
              if (value === '16:9' || value === '9:16') commit({ aspectRatio: value })
            }}
          />
        </div>
      </div>
      {growStory && picked ? (
        <div className="nodrag lod-full flex gap-1.5">
          <button
            type="button"
            data-testid="oneliner-generate"
            disabled={running || story.trim() === ''}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
            onClick={(event) => {
              growStory(id, { ...picked, story }, anchorOf(event.currentTarget))
            }}
          >
            {running ? (
              <>
                <Spinner label="生成中" />
                生成中…
              </>
            ) : (
              '生成影片'
            )}
          </button>
          {running && stopGrow ? (
            <button
              type="button"
              data-testid="oneliner-stop"
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-fg/10"
              onClick={stopGrow}
            >
              停止
            </button>
          ) : null}
        </div>
      ) : null}
      {running ? (
        <p
          data-testid="oneliner-locked"
          className="lod-full flex items-center gap-1 text-[11px] text-fg-muted"
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          生成中，故事和設定先鎖住；要改請先按「停止」
        </p>
      ) : story.trim() === '' ? (
        <p data-testid="oneliner-locked" className="lod-full text-[11px] text-fg-muted">
          先寫下故事，才能生成
        </p>
      ) : null}
    </>
  )
}
