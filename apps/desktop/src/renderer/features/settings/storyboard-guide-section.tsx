import {
  defaultStoryboardGuide,
  isDefaultStoryboardGuide,
  resolveStoryboardGuide,
  storyboardGuideMaxChars,
  type AppSettings,
  t,
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
      defaultText={defaultStoryboardGuide()}
      isDefault={isDefaultStoryboardGuide}
      maxChars={storyboardGuideMaxChars()}
      resolve={resolveStoryboardGuide}
      idPrefix="storyboard-guide"
      title={t('settings.storyboardGuide')}
      summary={t('settings.theAiFollowsThisGuide')}
      savedMessage={t('settings.savedTheNextSplitWill')}
      onChanged={onChanged}
    />
  )
}
