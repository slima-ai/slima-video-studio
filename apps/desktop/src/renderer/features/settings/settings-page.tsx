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

/** 頂端的小標籤（順序＝頁面上區的順序）。 */
const TAGS: readonly SettingsTag[] = [
  { id: 'general', label: '一般' },
  { id: 'connections', label: 'AI 工具連線' },
  { id: 'keys', label: '服務金鑰' },
  { id: 'models', label: '模型' },
  { id: 'experiments', label: '實驗功能' },
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
      title="設定"
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
              重試
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            <SettingGroup id="general" title="一般" hint="示範模式、外觀與單次花費上限。">
              <GeneralSection settings={state.data.settings} onChanged={reload} />
            </SettingGroup>
            <SettingGroup
              id="connections"
              title="AI 工具連線"
              hint="讓你自己的 Claude 等 AI 工具連到這個 App；用示範模式不需要金鑰就能玩；AI 工具花多少由你設定，預設不能花。"
            >
              <ConnectionsArea onChanged={reload} storageAvailable={state.data.storage.available} />
            </SettingGroup>
            <SettingGroup
              id="keys"
              title="服務金鑰"
              hint="用你自己的帳號呼叫 AI 服務，費用由服務商直接向你收；金鑰只存在這台電腦、不會上傳。"
            >
              <KeysSection keys={state.data.keys} storage={state.data.storage} onChanged={reload} />
            </SettingGroup>
            <SettingGroup id="models" title="使用的模型" hint="不確定的話保持預設就好。">
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
            <SettingGroup id="experiments" title="實驗功能" hint="還在試的功能，可能隨時改變。">
              <ExperimentsSection settings={state.data.settings} onChanged={reload} />
            </SettingGroup>
          </>
        ) : null}
      </div>
    </Page>
  )
}
