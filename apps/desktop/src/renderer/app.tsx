import { useCallback, useEffect, useState } from 'react'

import { AppLayout, type AppView } from './components/app-layout'
import { Spinner } from './components/skeleton'
import { ToastProvider } from './components/toast'
import { ChatProvider } from './features/chat/chat-context'
import { ChatDrawer } from './features/chat/chat-drawer'
import { CharactersPage } from './features/characters/characters-page'
import { CanvasPage } from './features/canvas/canvas-page'
import { useTrailerStatus } from './features/canvas/use-trailer-status'
import { TrailerPage } from './features/trailer/trailer-page'
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
import { CostReconcileNotice } from './features/records/cost-reconcile-notice'
import { ModelNotices } from './features/settings/model-notices'
import { AppNavigationProvider } from './lib/app-navigation'
import { SettingsPage } from './features/settings/settings-page'
import { useAppData } from './features/settings/use-app-data'
import { SlimaImportPage } from './features/slima/import-page'
import { useSlimaStatus } from './features/slima/use-slima-status'
import { HistoryProvider } from './lib/history'
import { call } from './lib/svs'
import { applyTheme } from './lib/theme'
import { viewMemory } from './lib/view-memory'
import { t } from '@svs/schema'

export function App() {
  const { state, reload } = useAppData()
  // 開 App 先到哪一頁：沒有專案可以接就是首頁，否則畫布。問到之前是 undefined（不畫，免得閃一下畫布）
  // 換介面語言時整棵樹會重新掛上（見 lib/i18n.tsx）：目前在哪一頁記在樹外面，重新掛上後回到同一頁
  const [view, setViewState] = useState<AppView | undefined>(viewMemory.view)
  const setView = useCallback((next: AppView) => {
    viewMemory.view = next
    setViewState(next)
  }, [])
  // 打開專案後落在哪：有預告片設定的專案是「預告片」頁，其他專案照舊是畫布
  const landing = useCallback(async (): Promise<AppView> => {
    try {
      return (await call('trailer.status', {})).exists ? 'trailer' : 'canvas'
    } catch {
      return 'canvas'
    }
  }, [])
  // 專案頁、首頁、專案列在開好專案之後說「去畫布」，那其實是「去這個專案的落點」；左邊導覽的「畫布」是真的去畫布
  const goFromPage = useCallback(
    (next: AppView) => {
      if (next === 'canvas') void landing().then(setView)
      else setView(next)
    },
    [landing, setView],
  )
  const openTrailer = useCallback(() => {
    setView('trailer')
  }, [setView])
  useEffect(() => {
    let alive = true
    call('app.startView', {})
      .then(async ({ view: first }) => {
        const start = first === 'canvas' ? await landing() : first
        if (alive) setViewState((now) => now ?? start)
      })
      // 問不到就照老樣子進畫布
      .catch(() => {
        if (alive) setViewState((now) => now ?? 'canvas')
      })
    return () => {
      alive = false
    }
  }, [])
  const openSettings = useCallback(() => {
    setView('settings')
  }, [])
  const slima = useSlimaStatus()
  const trailer = useTrailerStatus()
  // 這個專案沒有預告片設定（換了專案、或設定被清掉）時，不停在預告片頁
  const page: AppView =
    view === 'trailer' && trailer.status?.exists === false ? 'canvas' : (view ?? 'canvas')
  const refreshTrailer = trailer.refresh
  // 換頁時重問一次：換了專案之後，導覽上的「預告片」跟著新專案
  useEffect(() => {
    refreshTrailer()
  }, [view, refreshTrailer])

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
      <AppNavigationProvider value={{ openSettings, openTrailer }}>
        <ModelNotices onOpenSettings={openSettings} />
        <CostReconcileNotice
          onOpenRecords={() => {
            setView('records')
          }}
        />
        <ChatProvider>
          <HistoryProvider
            enabled={
              page === 'canvas' || page === 'trailer' || page === 'outline' || page === 'storyboard'
            }
          >
            <AppLayout
              drawer={page === 'canvas' || page === 'trailer' ? <ChatDrawer /> : undefined}
              view={page}
              onNavigate={setView}
              queue={<QueuePanel />}
              showSlima={slima !== undefined && slima.state !== 'no_token'}
              showTrailer={trailer.status?.exists === true}
              header={
                <ProjectBar
                  onNavigate={goFromPage}
                  demoMode={state.status === 'ready' ? state.data.settings.demoMode : undefined}
                  hasKey={
                    state.status === 'ready' ? state.data.keys.some((k) => k.configured) : undefined
                  }
                />
              }
            >
              {page === 'home' ? (
                <HomePage onNavigate={goFromPage} />
              ) : page === 'trailer' ? (
                trailer.status ? (
                  <TrailerPage status={trailer.status} />
                ) : null
              ) : page === 'settings' ? (
                <SettingsPage state={state} reload={reload} />
              ) : page === 'characters' ? (
                <CharactersPage />
              ) : page === 'locations' ? (
                <LocationsPage />
              ) : page === 'slima' ? (
                <SlimaImportPage
                  onOpenSettings={() => {
                    setView('settings')
                  }}
                  onNavigate={setView}
                />
              ) : page === 'records' ? (
                <RecordsPage onNavigate={setView} />
              ) : page === 'files' ? (
                <FilesPage />
              ) : page === 'projects' ? (
                <ProjectsPage onNavigate={goFromPage} />
              ) : page === 'outline' ? (
                <OutlinePage />
              ) : page === 'storyboard' ? (
                <StoryboardPage />
              ) : (
                <CanvasPage />
              )}
            </AppLayout>
          </HistoryProvider>
        </ChatProvider>
      </AppNavigationProvider>
    </ToastProvider>
  )
}
