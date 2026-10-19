import { Redo2, Undo2 } from 'lucide-react'

import { isMac, useHistory } from '../lib/history'
import { Button } from './button'

/** 頁面標題旁的「復原」「重做」：滑過會說明要復原什麼，沒有可做的就停用。 */
export function UndoRedoButtons() {
  const { state, undo, redo } = useHistory()
  const mod = isMac() ? '⌘' : 'Ctrl+'
  const undoText = state.canUndo ? `復原：${state.undoLabel ?? ''}` : '沒有可以復原的動作'
  const redoText = state.canRedo ? `重做：${state.redoLabel ?? ''}` : '沒有可以重做的動作'
  return (
    <div className="flex items-center gap-1" data-testid="undo-redo">
      <Button
        size="icon"
        variant="ghost"
        data-testid="history-undo"
        aria-label={undoText}
        title={`${undoText}（${mod}Z）`}
        disabled={!state.canUndo}
        onClick={undo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        data-testid="history-redo"
        aria-label={redoText}
        title={`${redoText}（${isMac() ? '⇧⌘Z' : 'Ctrl+Shift+Z'}）`}
        disabled={!state.canRedo}
        onClick={redo}
      >
        <Redo2 className="size-4" />
      </Button>
    </div>
  )
}
