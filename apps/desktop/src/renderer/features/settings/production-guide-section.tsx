import {
  DEFAULT_PRODUCTION_GUIDE,
  PRODUCTION_GUIDE_MAX_CHARS,
  resolveProductionGuide,
  type AppSettings,
} from '@svs/schema'
import { Clapperboard } from 'lucide-react'

import { GuideEditorCard } from './guide-editor-card'

export interface ProductionGuideSectionProps {
  settings: AppSettings
  onChanged: () => void
}

/** 製片與一致性指南：用 Claude Code 等 AI 工具接上這個 App 時，AI 在定義角色、場景、檢查一致性時讀的做法。 */
export function ProductionGuideSection({ settings, onChanged }: ProductionGuideSectionProps) {
  return (
    <GuideEditorCard
      field="productionGuide"
      custom={settings.productionGuide}
      defaultText={DEFAULT_PRODUCTION_GUIDE}
      maxChars={PRODUCTION_GUIDE_MAX_CHARS}
      resolve={resolveProductionGuide}
      idPrefix="production-guide"
      title="製片與一致性指南"
      summary="用 AI 工具（例如 Claude Code）接上這個 App 時，AI 在建立角色與場景、挑參考圖、檢查畫面一不一致時會讀這份做法（英文，因為 AI 工具讀英文最準）；可以照你的習慣改，留成預設也沒問題。"
      savedMessage="已儲存，AI 工具下次讀這份指南就會用到。"
      icon={Clapperboard}
      rows={18}
      onChanged={onChanged}
    />
  )
}
