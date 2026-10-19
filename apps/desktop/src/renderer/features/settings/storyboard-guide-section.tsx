import {
  DEFAULT_STORYBOARD_GUIDE,
  STORYBOARD_GUIDE_MAX_CHARS,
  resolveStoryboardGuide,
  type AppSettings,
} from '@svs/schema'
import { useEffect, useState } from 'react'

import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { call, errorText } from '../../lib/svs'

export interface StoryboardGuideSectionProps {
  settings: AppSettings
  onChanged: () => void
}

/** 分鏡準則：AI 拆鏡時一起參考的做法。看得到、改得動，也可以一鍵恢復預設。 */
export function StoryboardGuideSection({ settings, onChanged }: StoryboardGuideSectionProps) {
  const saved = resolveStoryboardGuide(settings.storyboardGuide)
  const [text, setText] = useState(saved)
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState('')
  // 設定從別的地方改過（或剛存好重讀）時，輸入框跟著更新
  useEffect(() => {
    setText(saved)
  }, [saved])

  const customized = settings.storyboardGuide.trim() !== ''
  const dirty = text.trim() !== saved.trim()
  const tooLong = text.length > STORYBOARD_GUIDE_MAX_CHARS

  const save = (guide: string, message: string): void => {
    setError(undefined)
    setDone(false)
    call('settings.update', { storyboardGuide: guide })
      .then(() => {
        setDone(true)
        setStatus(message)
        onChanged()
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <Section
      testId="storyboard-guide-section"
      title="分鏡準則"
      description="AI 把故事拆成鏡頭時會一起參考這份做法。可以照你的習慣修改；留成預設也沒問題。"
    >
      <label className="sr-only" htmlFor="storyboard-guide">
        分鏡準則
      </label>
      <textarea
        id="storyboard-guide"
        data-testid="storyboard-guide"
        value={text}
        rows={14}
        onChange={(event) => {
          setText(event.target.value)
          setDone(false)
        }}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed"
      />
      <p className={`mt-1 text-sm ${tooLong ? 'text-danger' : 'text-fg-muted'}`}>
        {String(text.length)} / {String(STORYBOARD_GUIDE_MAX_CHARS)} 字
        {tooLong ? '：太長了，請刪減。' : ''}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!dirty || tooLong}
          onClick={() => {
            // 改回跟預設一模一樣就存成「用預設」，之後預設更新時才會跟著更新
            const guide = text.trim() === DEFAULT_STORYBOARD_GUIDE.trim() ? '' : text
            save(guide, '已儲存，下次拆鏡就會用這份準則。')
          }}
        >
          儲存
        </Button>
        <Button
          variant="secondary"
          disabled={!customized && !dirty}
          onClick={() => {
            setText(DEFAULT_STORYBOARD_GUIDE)
            save('', '已恢復預設。')
          }}
        >
          恢復預設
        </Button>
        {done ? (
          <span role="status" className="text-sm text-success">
            {status}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
