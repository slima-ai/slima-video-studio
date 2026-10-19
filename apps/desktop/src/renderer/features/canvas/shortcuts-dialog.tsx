import { Button } from '../../components/button'
import { Modal } from '../../components/modal'

/** 畫布上的快捷鍵（Mac 用 Cmd，Windows 用 Ctrl）。 */
export const SHORTCUTS: readonly { keys: string; what: string }[] = [
  { keys: 'Tab 或 /', what: '新增（開新增選單）' },
  { keys: '雙擊空白處', what: '在那裡新增' },
  { keys: 'Enter', what: '打開選取那一格的面板' },
  { keys: 'F2', what: '改名（場、角色、地點、群組）' },
  { keys: 'Delete', what: '刪除選取的格子' },
  { keys: 'Ctrl+C／Ctrl+V', what: '複製、貼上' },
  { keys: 'Ctrl+D', what: '再做一份' },
  { keys: 'Ctrl+G', what: '把選取的框成群組' },
  { keys: 'Ctrl+Enter', what: '執行選取的格子' },
  { keys: 'Ctrl+Z／Ctrl+Shift+Z', what: '復原、重做' },
  { keys: '方向鍵', what: '微調選取的格子（Shift 一次多一點）；沒選取時平移畫布' },
  { keys: '空白鍵＋拖曳、中鍵拖曳', what: '平移畫布' },
  { keys: 'Esc', what: '關掉選單、面板' },
]

/** 「？」選單裡的「鍵盤快捷鍵」。 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="鍵盤快捷鍵" onClose={onClose} testId="shortcuts-dialog">
      <div className="flex w-[480px] max-w-full flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">鍵盤快捷鍵</h2>
        <p className="text-xs text-fg-muted">Mac 上把 Ctrl 換成 Cmd。</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-xs">
                  {s.keys}
                </kbd>
              </dt>
              <dd className="text-fg-muted">{s.what}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose} autoFocus>
            知道了
          </Button>
        </div>
      </div>
    </Modal>
  )
}
