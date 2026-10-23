import { Redo2, Undo2 } from 'lucide-react'

import { isMac, useHistory } from '../lib/history'
import { Button } from './button'
import { t } from '@svs/schema'

/** 頁面標題旁的「復原」「重做」：滑過會說明要復原什麼，沒有可做的就停用。 */
export function UndoRedoButtons() {
  const { state, undo, redo } = useHistory()
  const mod = isMac() ? '⌘' : 'Ctrl+'
  const undoText = state.canUndo
    ? t('shell.undo', { value: state.undoLabel ?? '' })
    : t('shell.nothingToUndo')
  const redoText = state.canRedo
    ? t('shell.redo', { value: state.redoLabel ?? '' })
    : t('shell.nothingToRedo')
  return (
    <div className="flex items-center gap-1" data-testid="undo-redo">
      <Button
        size="icon"
        variant="ghost"
        data-testid="history-undo"
        aria-label={undoText}
        title={t('shell.withShortcut', { label: undoText, keys: `${mod}Z` })}
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
        title={t('shell.withShortcut', {
          label: redoText,
          keys: isMac() ? '⇧⌘Z' : 'Ctrl+Shift+Z',
        })}
        disabled={!state.canRedo}
        onClick={redo}
      >
        <Redo2 className="size-4" />
      </Button>
    </div>
  )
}
