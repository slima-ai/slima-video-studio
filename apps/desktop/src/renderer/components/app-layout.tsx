import {
  Clapperboard,
  LayoutDashboard,
  Download,
  FolderOpen,
  History,
  LayoutList,
  ListTree,
  MapPin,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Button } from './button'
import { PANEL_WIDTHS, PanelHostContext, type PanelHost, type PanelWidth } from './side-panel'

export type AppView =
  | 'home'
  | 'canvas'
  | 'outline'
  | 'storyboard'
  | 'characters'
  | 'locations'
  | 'slima'
  | 'records'
  | 'files'
  | 'projects'
  | 'settings'

interface NavItem {
  label: string
  /** 圖示下面的小字（太長放不下時用短的；沒給就是 label）。 */
  short?: string
  icon: LucideIcon
  view?: AppView
  /** false 的項目要有對應的條件才顯示（Slima 連上了）。 */
  always: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: '畫布', icon: LayoutDashboard, view: 'canvas', always: true },
  { label: '大綱', icon: ListTree, view: 'outline', always: true },
  { label: '分鏡表', icon: LayoutList, view: 'storyboard', always: true },
  { label: '角色', icon: Users, view: 'characters', always: true },
  { label: '場景卡', icon: MapPin, view: 'locations', always: true },
  { label: '生成紀錄', icon: History, view: 'records', always: true },
  { label: '檔案', icon: FolderOpen, view: 'files', always: true },
  { label: '從 Slima 匯入', short: 'Slima', icon: Download, view: 'slima', always: false },
  { label: '專案', icon: Clapperboard, view: 'projects', always: true },
]

/**
 * 導覽按鈕：圖示下面直接寫名字（不用滑過才知道這顆是什麼）；目前所在的頁面有底色與左側指示條；
 * 滑過或鍵盤聚焦會顯示完整名稱。
 */
function NavButton({
  label,
  short,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  short?: string | undefined
  icon: LucideIcon
  active: boolean
  onClick?: (() => void) | undefined
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-active={active}
      onClick={onClick}
      className={`group relative h-auto w-12 flex-col gap-0.5 px-0 py-1.5 ${active ? 'bg-surface-overlay text-fg' : ''}`}
    >
      {active ? (
        <span aria-hidden className="absolute -left-1 top-2 h-5 w-[3px] rounded-r bg-accent" />
      ) : null}
      <Icon className="size-5" />
      <span aria-hidden className="text-[10px] font-normal leading-none">
        {short ?? label}
      </span>
      <span
        aria-hidden
        role="presentation"
        className="pointer-events-none absolute left-full z-30 ml-3 whitespace-nowrap rounded-md border border-border bg-surface-overlay px-2 py-1 text-xs font-normal text-fg opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </Button>
  )
}

export interface AppLayoutProps {
  /** 中央工作區內容 */
  children?: ReactNode
  /** 目前所在的頁面（導覽列會標示）。 */
  view?: AppView
  onNavigate?: (view: AppView) => void
  /** 底部的生成佇列面板。 */
  queue?: ReactNode
  /** 有連上（或設定了）Slima 才顯示「從 Slima 匯入」。 */
  showSlima?: boolean
  /** 最上面一條，每一頁都在（專案名、存檔狀態、模式、花費）。 */
  header?: ReactNode
  /** 整條從右邊滑出的面板（Claude 對話）：占自己的位置，中央區與詳細面板讓出空間，不被蓋住。 */
  drawer?: ReactNode
}

/**
 * 四區佈局：左導覽、中央工作區、右面板、底部佇列。
 * 各工作區（畫布、角色、…）都放進中央區。
 */
export function AppLayout({
  children,
  view = 'canvas',
  onNavigate,
  queue,
  showSlima = false,
  header,
  drawer,
}: AppLayoutProps) {
  // 右側面板：頁面用 <SidePanel> 把內容放進來，有選取才滑入
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // 收起時寬度維持上一次的，滑出的過程內容才不會被切掉
  const [panelWidth, setPanelWidth] = useState<PanelWidth>('normal')
  const host = useMemo<PanelHost>(
    () => ({
      element: panelElement,
      setWidth: (width) => {
        if (width) setPanelWidth(width)
        setPanelOpen(width !== undefined)
      },
    }),
    [panelElement],
  )
  // 設定頁、首頁用不到生成佇列，不佔畫面
  const showQueue = view !== 'settings' && view !== 'home'
  return (
    <PanelHostContext.Provider value={host}>
      <div className="flex h-full flex-col" data-testid="app-layout">
        {header}
        <div className="relative flex min-h-0 flex-1 overflow-clip">
          <nav
            aria-label="主導覽"
            data-testid="layout-nav"
            className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-raised py-2"
          >
            {NAV_ITEMS.filter((item) => item.always || showSlima).map(
              ({ label, short, icon, view: target }) => (
                <NavButton
                  key={label}
                  label={label}
                  short={short}
                  icon={icon}
                  active={target !== undefined && target === view}
                  onClick={target ? () => onNavigate?.(target) : undefined}
                />
              ),
            )}
            <div className="flex-1" />
            <NavButton
              label="設定"
              icon={Settings}
              active={view === 'settings'}
              onClick={() => onNavigate?.('settings')}
            />
          </nav>

          <div className="relative flex min-w-0 flex-1 overflow-clip">
            {/* 面板打開時中央一次讓出位置（只重排一次）；面板自己用 translateX 滑入，動畫過程不會重排 */}
            <main
              data-testid="layout-main"
              style={{ marginRight: panelOpen ? PANEL_WIDTHS[panelWidth] : 0 }}
              data-bleed={view === 'canvas'}
              className={
                // 畫布首頁滿版（自己處理平移與捲動）；其他頁面是有邊界的內容區
                view === 'canvas'
                  ? 'relative min-w-0 flex-1 overflow-hidden'
                  : 'min-w-0 flex-1 overflow-auto'
              }
            >
              {children}
            </main>

            <aside
              ref={setPanelElement}
              aria-label="詳細面板"
              inert={!panelOpen}
              data-testid="layout-panel"
              data-open={panelOpen}
              style={{
                width: PANEL_WIDTHS[panelWidth],
                transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
              }}
              className={`absolute inset-y-0 right-0 z-10 overflow-clip border-l border-border bg-surface-raised transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                // 收起時不要陰影：面板在畫面外，陰影會漏進來
                panelOpen ? 'shadow-panel' : ''
              }`}
            />
          </div>
          {drawer}
        </div>

        {showQueue ? (
          <footer
            aria-label="生成佇列"
            data-testid="layout-queue"
            className="shrink-0 border-t border-border bg-surface-raised px-4"
          >
            {queue ?? <h2 className="py-2 text-sm font-medium text-fg-muted">生成佇列</h2>}
          </footer>
        ) : null}
      </div>
    </PanelHostContext.Provider>
  )
}
