import { useCallback, useEffect, useState } from 'react'

import { AppLayout, type AppView } from './components/app-layout'
import { Spinner } from './components/skeleton'
import { ToastProvider } from './components/toast'
import { CharactersPage } from './features/characters/characters-page'
import { CanvasPage } from './features/canvas/canvas-page'
import { FilesPage } from './features/files/files-page'
import { ProjectsPage } from './features/projects/projects-page'
import { RecordsPage } from './features/records/records-page'
import { LocationsPage } from './features/locations/locations-page'
import { OutlinePage } from './features/outline/outline-page'
import { StoryboardPage } from './features/storyboard/storyboard-page'
import { QueuePanel } from './features/queue/queue-panel'
import { SetupWizard } from './features/onboarding/setup-wizard'
import { ModelNotices } from './features/settings/model-notices'
import { SettingsPage } from './features/settings/settings-page'
import { useAppData } from './features/settings/use-app-data'
import { SlimaImportPage } from './features/slima/import-page'
import { useSlimaStatus } from './features/slima/use-slima-status'
import { HistoryProvider } from './lib/history'
import { applyTheme } from './lib/theme'

export function App() {
  const { state, reload } = useAppData()
  const [view, setView] = useState<AppView>('canvas')
  const openSettings = useCallback(() => {
    setView('settings')
  }, [])
  const slima = useSlimaStatus()

  // 外觀跟著設定走（設定還沒載入時維持目前的樣子）
  const theme = state.status === 'ready' ? state.data.settings.theme : undefined
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-6 text-fg-muted">
        <Spinner label="載入中" />
        載入中…
      </p>
    )
  }

  // 第一次使用：先走引導（設定載入失敗時略過，直接進主畫面，使用者還是能到設定頁重試）
  if (state.status === 'ready' && !state.data.settings.onboardingDone) {
    return <SetupWizard data={state.data} reload={reload} onDone={reload} />
  }

  return (
    <ToastProvider>
      <ModelNotices onOpenSettings={openSettings} />
      <HistoryProvider enabled={view === 'canvas' || view === 'outline' || view === 'storyboard'}>
        <AppLayout
          view={view}
          onNavigate={setView}
          queue={<QueuePanel />}
          showSlima={slima !== undefined && slima.state !== 'no_token'}
        >
          {view === 'settings' ? (
            <SettingsPage state={state} reload={reload} />
          ) : view === 'characters' ? (
            <CharactersPage />
          ) : view === 'locations' ? (
            <LocationsPage />
          ) : view === 'slima' ? (
            <SlimaImportPage
              onOpenSettings={() => {
                setView('settings')
              }}
              onNavigate={setView}
            />
          ) : view === 'records' ? (
            <RecordsPage onNavigate={setView} />
          ) : view === 'files' ? (
            <FilesPage />
          ) : view === 'projects' ? (
            <ProjectsPage onNavigate={setView} />
          ) : view === 'outline' ? (
            <OutlinePage />
          ) : view === 'storyboard' ? (
            <StoryboardPage />
          ) : (
            <CanvasPage />
          )}
        </AppLayout>
      </HistoryProvider>
    </ToastProvider>
  )
}
