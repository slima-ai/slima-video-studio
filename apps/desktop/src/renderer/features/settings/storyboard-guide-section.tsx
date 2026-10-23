import {
  DEFAULT_STORYBOARD_GUIDE,
  STORYBOARD_GUIDE_MAX_CHARS,
  resolveStoryboardGuide,
  type AppSettings,
} from '@svs/schema'

import { GuideEditorCard } from './guide-editor-card'

export interface StoryboardGuideSectionProps {
  settings: AppSettings
  onChanged: () => void
}

/** 分鏡準則：AI 拆鏡時一起參考的做法。看得到、改得動，也可以一鍵恢復預設。 */
export function StoryboardGuideSection({ settings, onChanged }: StoryboardGuideSectionProps) {
  return (
    <GuideEditorCard
      field="storyboardGuide"
      custom={settings.storyboardGuide}
      defaultText={DEFAULT_STORYBOARD_GUIDE}
      maxChars={STORYBOARD_GUIDE_MAX_CHARS}
      resolve={resolveStoryboardGuide}
      idPrefix="storyboard-guide"
      title="分鏡準則"
      summary="AI 把故事拆成鏡頭時會參考這份做法；可以照你的習慣改，留成預設也沒問題。"
      savedMessage="已儲存，下次拆鏡就會用這份準則。"
      onChanged={onChanged}
    />
  )
}
