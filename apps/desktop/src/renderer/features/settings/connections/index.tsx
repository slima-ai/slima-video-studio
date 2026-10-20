import { useSlimaStatus } from '../../slima/use-slima-status'
import { AccessCard } from './access-card'
import { AllowanceCard } from './allowance-card'
import { ClaudeCodeCard, ClaudeDesktopCard } from './claude-cards'
import { ConnectionDiagram } from './connection-diagram'
import { SlimaCard } from './slima-card'
import { useMcpConnection } from './use-mcp'

export interface ConnectionsAreaProps {
  onChanged: () => void
  storageAvailable: boolean
}

/**
 * 「AI 工具連線」整區的內容（區標題之外的全部）：連線示意圖與狀態燈、總開關、
 * 三張連線卡（Claude Desktop、Claude Code、Slima）、AI 工具的總額度。
 * **這個資料夾是 studio 1 的**；用 `components/setting-card` 這組共用元件，不用再動 settings-page.tsx。
 */
export function ConnectionsArea({ onChanged, storageAvailable }: ConnectionsAreaProps) {
  const mcp = useMcpConnection(onChanged)
  const slima = useSlimaStatus()
  return (
    <>
      <ConnectionDiagram status={mcp.status} info={mcp.info} slima={slima} />
      <AccessCard mcp={mcp} />
      <ClaudeDesktopCard mcp={mcp} />
      <ClaudeCodeCard mcp={mcp} />
      <SlimaCard status={slima} storageAvailable={storageAvailable} />
      <AllowanceCard mcp={mcp} />
    </>
  )
}
