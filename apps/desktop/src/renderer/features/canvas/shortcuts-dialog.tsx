import { Button } from '../../components/button'
import { Modal } from '../../components/modal'
import { t, msg, type MessageRef } from '@svs/schema'

/** 畫布上的快捷鍵（Mac 用 Cmd，Windows 用 Ctrl）。 */
export const SHORTCUTS: readonly { keys: MessageRef | string; what: MessageRef }[] = [
  { keys: msg('canvas.tabOr'), what: msg('canvas.addOpensTheAddMenu') },
  { keys: msg('canvas.doubleClickEmptySpace'), what: msg('canvas.addRightThere') },
  { keys: 'Enter', what: msg('canvas.openTheSelectedCellS') },
  { keys: 'F2', what: msg('canvas.renameSceneCharacterLocationGroup') },
  { keys: 'Delete', what: msg('canvas.deleteTheSelectedCells2') },
  { keys: 'Ctrl+C／Ctrl+V', what: msg('canvas.copyPaste') },
  { keys: 'Ctrl+D', what: msg('canvas.duplicate') },
  { keys: 'Ctrl+G', what: msg('canvas.groupTheSelection') },
  { keys: 'Ctrl+Enter', what: msg('canvas.runTheSelectedCells2') },
  { keys: 'Ctrl+Z／Ctrl+Shift+Z', what: msg('canvas.undoRedo') },
  { keys: msg('canvas.arrowKeys'), what: msg('canvas.nudgeTheSelectedCellsShift') },
  { keys: msg('canvas.spaceDragMiddleButtonDrag'), what: msg('canvas.panTheCanvas') },
  { keys: 'Esc', what: msg('canvas.closeMenusAndPanels') },
]

/** 「？」選單裡的「鍵盤快捷鍵」。 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label={t('canvas.keyboardShortcuts')} onClose={onClose} testId="shortcuts-dialog">
      <div className="flex w-[480px] max-w-full flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">{t('canvas.keyboardShortcuts')}</h2>
        <p className="text-xs text-fg-muted">{t('canvas.onAMacUseCmd')}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={typeof s.keys === 'string' ? s.keys : s.keys.msgKey} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-xs">
                  {typeof s.keys === 'string' ? s.keys : t(s.keys)}
                </kbd>
              </dt>
              <dd className="text-fg-muted">{t(s.what)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose} autoFocus>
            {t('canvas.gotIt')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
