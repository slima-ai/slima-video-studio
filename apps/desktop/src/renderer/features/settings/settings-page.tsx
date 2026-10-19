import { useEffect, useRef } from 'react'

import { Button } from '../../components/button'
import { SkeletonCards } from '../../components/skeleton'
import { GeneralSection } from './general-section'
import { KeysSection } from './keys-section'
import { ModelsSection } from './models-section'
import { ProjectModelsSection } from './project-models-section'
import { SlimaSection } from './slima-section'
import { StoryboardGuideSection } from './storyboard-guide-section'
import type { AppDataState } from './use-app-data'
import { Page } from '../../components/page'

export interface SettingsPageProps {
  state: AppDataState
  reload: () => void
}

/** 設定頁：API Key、模型、示範模式與花費上限。 */
export function SettingsPage({ state, reload }: SettingsPageProps) {
  const keysRef = useRef<HTMLDivElement>(null)
  // 每次打開都重讀：專案可能剛開或剛換，金鑰也可能在別的地方改過
  useEffect(() => {
    reload()
  }, [reload])
  /** 從「使用的模型」跳到金鑰區，並把游標放進第一個還沒填的欄位。 */
  const goToKeys = (): void => {
    const box = keysRef.current
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'start' })
    box.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
  }
  return (
    <Page
      title="設定"
      hint="服務金鑰、使用的模型、分鏡準則、Slima 連線與外觀"
      width="narrow"
      testId="settings-page"
    >
      <div className="space-y-6">
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
            <div ref={keysRef}>
              <KeysSection keys={state.data.keys} storage={state.data.storage} onChanged={reload} />
            </div>
            <ModelsSection
              models={state.data.models}
              selected={state.data.selected}
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
            <SlimaSection storageAvailable={state.data.storage.available} />
            <GeneralSection settings={state.data.settings} onChanged={reload} />
          </>
        ) : null}
      </div>
    </Page>
  )
}
