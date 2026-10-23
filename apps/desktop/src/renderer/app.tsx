import { useCallback, useEffect, useState } from 'react'

import { AppLayout, type AppView } from './components/app-layout'
import { Spinner } from './components/skeleton'
import { ToastProvider } from './components/toast'
import { ChatProvider } from './features/chat/chat-context'
import { ChatDrawer } from './features/chat/chat-drawer'
import { CharactersPage } from './features/characters/characters-page'
import { CanvasPage } from './features/canvas/canvas-page'
import { FilesPage } from './features/files/files-page'
import { HomePage } from './features/projects/home-page'
import { ProjectBar } from './features/projects/project-bar'
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
import { call } from './lib/svs'
import { applyTheme } from './lib/theme'
import { t } from '@svs/schema'

export function App() {
  const { state, reload } = useAppData()
  // 開 App 先到哪一頁：沒有專案可以接就是首頁，否則畫布。問到之前是 undefined（不畫，免得閃一下畫布）
  const [view, setView] = useState<AppView>()
  useEffect(() => {
    let alive = true
    call('app.startView', {})
      .then(({ view: first }) => {
        if (alive) setView((now) => now ?? first)
      })
      // 問不到就照老樣子進畫布
      .catch(() => {
        if (alive) setView((now) => now ?? 'canvas')
      })
    return () => {
      alive = false
    }
  }, [])
  const openSettings = useCallback(() => {
    setView('settings')
  }, [])
  const slima = useSlimaStatus()

  // 外觀跟著設定走（設定還沒載入時維持目前的樣子）
  const theme = state.status === 'ready' ? state.data.settings.theme : undefined
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  if (state.status === 'loading' || view === undefined) {
    return (
      <p className="flex items-center gap-2 p-6 text-fg-muted">
        <Spinner label={t('shell.loading')} />
        {t('shell.loading2')}
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
      <ChatProvider>
        <HistoryProvider enabled={view === 'canvas' || view === 'outline' || view === 'storyboard'}>
          <AppLayout
            drawer={view === 'canvas' ? <ChatDrawer /> : undefined}
            view={view}
            onNavigate={setView}
            queue={<QueuePanel />}
            showSlima={slima !== undefined && slima.state !== 'no_token'}
            header={
              <ProjectBar
                onNavigate={setView}
                demoMode={state.status === 'ready' ? state.data.settings.demoMode : undefined}
                hasKey={
                  state.status === 'ready' ? state.data.keys.some((k) => k.configured) : undefined
                }
              />
            }
          >
            {view === 'home' ? (
              <HomePage onNavigate={setView} />
            ) : view === 'settings' ? (
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
      </ChatProvider>
    </ToastProvider>
  )
}
