import {
  DEFAULT_PRODUCTION_GUIDE,
  PRODUCTION_GUIDE_MAX_CHARS,
  resolveProductionGuide,
  type AppSettings,
  t,
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
      title={t('settings.productionConsistencyGuide')}
      summary={t('settings.whenAnAiToolSuch')}
      savedMessage={t('settings.savedAiToolsWillUse')}
      icon={Clapperboard}
      rows={18}
      onChanged={onChanged}
    />
  )
}
