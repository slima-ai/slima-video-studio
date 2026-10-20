import { McpSection } from '../mcp-section'
import { SlimaSection } from '../slima-section'

export interface ConnectionsAreaProps {
  onChanged: () => void
  storageAvailable: boolean
}

/**
 * 「AI 工具連線」整區的內容（區標題之外的全部）。
 * **這個資料夾是 studio 1 的**：連線區改版時把這支檔案換成新畫面（三張連線卡、連線示意圖、狀態燈、額度卡），
 * 不用再動 settings-page.tsx。現在只是暫時的轉接：原樣放現有的兩個區塊。
 */
export function ConnectionsArea({ onChanged, storageAvailable }: ConnectionsAreaProps) {
  return (
    <div className="space-y-6 md:col-span-2" data-testid="connections-area">
      <McpSection onChanged={onChanged} />
      <SlimaSection storageAvailable={storageAvailable} />
    </div>
  )
}
