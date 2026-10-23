import { useEffect } from 'react'

import { useChatDock } from './chat-context'
import { ChatPanel } from './chat-panel'
import { t } from '@svs/schema'

/** 對話面板的寬度（畫布讓出這麼多位置，不蓋住畫布：要看得到它在改什麼）。 */
export const CHAT_DRAWER_WIDTH = 380

/**
 * 畫面右邊整條滑出的對話面板（不是彈出小視窗）。收起時寬度是 0、內容不可操作；
 * 裡面固定寬度，滑動過程不會跟著重排。聚焦在面板裡按 Esc 停止 Claude 正在做的事。
 */
export function ChatDrawer() {
  const { enabled, open, active, stop } = useChatDock()
  // 面板開著就在根元素上記一筆：右下角的提示（toast）靠它往左讓開，不蓋住輸入欄與送出鈕
  const showing = enabled && open
  useEffect(() => {
    if (!showing) return undefined
    document.documentElement.dataset.chatDrawer = 'open'
    return () => {
      delete document.documentElement.dataset.chatDrawer
    }
  }, [showing])
  if (!enabled) return null
  return (
    <aside
      aria-label={t('chat.claudeChat')}
      data-testid="chat-drawer"
      data-open={open}
      inert={!open}
      style={{ width: open ? CHAT_DRAWER_WIDTH : 0 }}
      className="shrink-0 overflow-hidden border-border bg-surface-raised transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[open=true]:border-l"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && active?.running === true) {
          event.stopPropagation()
          stop()
        }
      }}
    >
      <div className="h-full" style={{ width: CHAT_DRAWER_WIDTH }}>
        <ChatPanel />
      </div>
    </aside>
  )
}
