import { useEffect } from 'react'

import { Button } from '../../components/button'
import { SkeletonCards } from '../../components/skeleton'
import { SettingGroup } from '../../components/setting-group'
import { ConnectionsArea } from './connections'
import { ExperimentsSection } from './experiments-section'
import { GeneralSection } from './general-section'
import { KeysSection } from './keys-section'
import { ModelsSection } from './models-section'
import { ProjectModelsSection } from './project-models-section'
import { SettingsTags, type SettingsTag } from './settings-tags'
import { ProductionGuideSection } from './production-guide-section'
import { StoryboardGuideSection } from './storyboard-guide-section'
import { VideoNegativeSection } from './video-negative-section'
import type { AppDataState } from './use-app-data'
import { Page } from '../../components/page'
import { t, msg } from '@svs/schema'

/** 頂端的小標籤（順序＝頁面上區的順序）。 */
const TAGS: readonly SettingsTag[] = [
  { id: 'general', label: msg('settings.general') },
  { id: 'connections', label: msg('settings.aiTools') },
  { id: 'keys', label: msg('settings.apiKeys') },
  { id: 'models', label: msg('settings.models') },
  { id: 'experiments', label: msg('settings.experiments') },
]

export interface SettingsPageProps {
  state: AppDataState
  reload: () => void
}

/** 設定頁：API Key、模型、示範模式與花費上限。 */
export function SettingsPage({ state, reload }: SettingsPageProps) {
  // 每次打開都重讀：專案可能剛開或剛換，金鑰也可能在別的地方改過
  useEffect(() => {
    reload()
  }, [reload])
  /** 從「使用的模型」跳到金鑰區，並把游標放進第一個還沒填的欄位。 */
  const goToKeys = (): void => {
    const box = document.getElementById('keys')
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'start' })
    box.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
  }
  return (
    <Page
      title={t('settings.settings')}
      width="narrow"
      testId="settings-page"
      actions={<SettingsTags tags={TAGS} />}
      shrinkActions
    >
      <div className="space-y-8">
        {state.status === 'loading' ? <SkeletonCards count={2} testId="settings-loading" /> : null}
        {state.status === 'error' ? (
          <div role="alert" className="text-danger">
            <p>{state.message}</p>
            <Button className="mt-2" onClick={reload}>
              {t('settings.retry')}
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            <SettingGroup
              id="general"
              title={t('settings.general')}
              hint={t('settings.demoModeAppearanceAndThe')}
            >
              <GeneralSection settings={state.data.settings} onChanged={reload} />
            </SettingGroup>
            <SettingGroup
              id="connections"
              title={t('settings.aiTools')}
              hint={t('settings.letYourOwnClaudeOr')}
            >
              <ConnectionsArea onChanged={reload} storageAvailable={state.data.storage.available} />
            </SettingGroup>
            <SettingGroup
              id="keys"
              title={t('settings.apiKeys')}
              hint={t('settings.callAiServicesWithYour')}
            >
              <KeysSection keys={state.data.keys} storage={state.data.storage} onChanged={reload} />
            </SettingGroup>
            <SettingGroup
              id="models"
              title={t('settings.modelsToUse')}
              hint={t('settings.ifYouReNotSure')}
            >
              <>
                <ModelsSection
                  models={state.data.models}
                  selected={state.data.selected}
                  voices={state.data.voices}
                  locked={state.data.locked}
                  onChanged={reload}
                  onGoToKeys={goToKeys}
                />
                {state.data.project && state.data.models.length > 0 ? (
                  <ProjectModelsSection
                    project={state.data.project}
                    models={state.data.models}
                    selected={state.data.selected}
                    locked={state.data.locked}
                    onChanged={reload}
                  />
                ) : null}
                <StoryboardGuideSection settings={state.data.settings} onChanged={reload} />
                <ProductionGuideSection settings={state.data.settings} onChanged={reload} />
                <VideoNegativeSection
                  settings={state.data.settings}
                  videoModel={state.data.models.find((m) => m.id === state.data.selected.i2v)}
                  onChanged={reload}
                />
              </>
            </SettingGroup>
            <SettingGroup
              id="experiments"
              title={t('settings.experiments')}
              hint={t('settings.featuresStillBeingTriedThey')}
            >
              <ExperimentsSection settings={state.data.settings} onChanged={reload} />
            </SettingGroup>
          </>
        ) : null}
      </div>
    </Page>
  )
}
