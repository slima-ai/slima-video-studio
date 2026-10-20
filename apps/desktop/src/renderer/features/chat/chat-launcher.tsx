import { useEffect } from 'react'

import { Mascot } from '../../brand/mascot'
import { cn } from '../../lib/cn'
import { useChatDock } from './chat-context'

/** 畫布右下角的小按鈕：按了從右邊滑出 Claude 對話。功能沒打開（實驗功能開關）就不出現。 */
export function ChatLauncher() {
  const { enabled, open, setOpen, refreshEnabled, active } = useChatDock()
  // 回到畫布時重問一次（使用者可能剛在設定頁改了開關）
  useEffect(refreshEnabled, [refreshEnabled])
  if (!enabled) return null
  return (
    <button
      type="button"
      data-testid="chat-launcher"
      aria-pressed={open}
      title="和 Claude 對話：用你自己登入的 Claude Code，直接幫你改這個專案"
      className={cn(
        'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs shadow-card transition-colors',
        open
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-accent/50 bg-surface-raised text-accent hover:bg-accent/10',
      )}
      onClick={() => {
        setOpen(!open)
      }}
    >
      <Mascot size={20} mood={active?.running === true ? 'working' : 'idle'} className="-my-0.5" />
      Claude
    </button>
  )
}
