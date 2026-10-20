import type { McpConnectInfo, McpStatus, SlimaStatus } from '@svs/schema'
import { BookOpen, ChevronRight, Clapperboard, Monitor, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { StatusLight } from '../../../components/status-light'
import { cn } from '../../../lib/cn'
import { timeAgo } from '../../../lib/usage'
import {
  appLight,
  codeLight,
  desktopLight,
  slimaLight,
  toolLinkActive,
  type Light,
} from './connection-state'

function Node({
  icon: Icon,
  name,
  light,
  hint,
  testId,
  strong = false,
}: {
  icon: LucideIcon
  name: string
  light: Light
  hint?: string
  testId: string
  strong?: boolean
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-surface-raised p-3',
        strong ? 'border-accent/60 shadow-card md:py-6' : 'border-border',
      )}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{name}</p>
        <StatusLight {...light} testId={`${testId}-status`} />
        {hint ? <p className="wrap-zh mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
      </div>
    </div>
  )
}

/** 兩個節點之間的線：通的是實線加色，還沒通是虛線；箭頭指向「誰在叫誰做事」。窄視窗改成直的。 */
function Link({
  active,
  reverse = false,
  className,
}: {
  active: boolean
  reverse?: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden
      data-active={active}
      className={cn(
        'flex items-center justify-center py-0.5 md:px-0.5 md:py-0',
        'flex-col md:flex-row',
        active ? 'text-accent' : 'text-fg-muted/60',
        className,
      )}
    >
      <span
        className={cn(
          'block h-5 border-l-2 md:h-0 md:w-full md:border-l-0 md:border-t-2',
          active ? 'border-current' : 'border-dashed border-current',
        )}
      />
      <ChevronRight
        className={cn(
          '-mt-2 size-4 shrink-0 md:-ml-2 md:mt-0',
          reverse ? '-rotate-90 md:rotate-180' : 'rotate-90 md:rotate-0',
        )}
      />
    </div>
  )
}

export interface ConnectionDiagramProps {
  status: McpStatus | undefined
  info: McpConnectInfo | undefined
  slima: SlimaStatus | undefined
}

/**
 * 連線示意圖：左邊是你的 AI 工具（Claude Desktop、Claude Code），中間是這個 App，右邊是 Slima 帳號。
 * 每個節點旁一顆狀態燈；兩端都好的線畫成實線，其他是虛線。
 */
export function ConnectionDiagram({ status, info, slima }: ConnectionDiagramProps) {
  const app = appLight(status)
  const desktop = desktopLight(info)
  const code = codeLight(info)
  const slimaState = slimaLight(slima)
  const desktopOn = toolLinkActive(app, desktop)
  const codeOn = toolLinkActive(app, code)
  const lastSeen = status?.lastSeen
  const appHint = !status?.enabled
    ? '要先打開「允許 AI 工具連線」'
    : lastSeen
      ? `最近有 AI 工具連進來：${timeAgo(lastSeen.at)}`
      : '這次開著 App，還沒有 AI 工具連進來'
  return (
    <div
      role="group"
      aria-label="連線示意圖"
      data-testid="connection-diagram"
      className="rounded-lg border border-border bg-surface p-4 md:col-span-2"
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2.5rem_1.1fr_2.5rem_1fr] md:grid-rows-2 md:items-center md:gap-y-3">
        <div className="md:col-start-1 md:row-start-1">
          <Node icon={Monitor} name="Claude Desktop" light={desktop} testId="diagram-desktop" />
        </div>
        <Link active={desktopOn} className="max-md:hidden md:col-start-2 md:row-start-1" />
        <div className="mt-3 md:col-start-1 md:row-start-2 md:mt-0">
          <Node icon={Terminal} name="Claude Code" light={code} testId="diagram-code" />
        </div>
        <Link active={codeOn} className="max-md:hidden md:col-start-2 md:row-start-2" />
        <Link active={desktopOn || codeOn} className="md:hidden" />
        <div className="md:col-start-3 md:row-span-2 md:row-start-1">
          <Node
            icon={Clapperboard}
            name="Slima Video Studio（這個 App）"
            light={app}
            hint={appHint}
            testId="diagram-app"
            strong
          />
        </div>
        <Link
          active={slimaState.tone === 'ok'}
          reverse
          className="md:col-start-4 md:row-span-2 md:row-start-1"
        />
        <div className="md:col-start-5 md:row-span-2 md:row-start-1">
          <Node icon={BookOpen} name="Slima 帳號" light={slimaState} testId="diagram-slima" />
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        實線是已經連上，虛線是還沒連上。AI 工具叫這個 App 做事；這個 App 向 Slima 讀你的小說或劇本。
      </p>
    </div>
  )
}
