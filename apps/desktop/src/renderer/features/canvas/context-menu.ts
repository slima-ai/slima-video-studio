import type { CanvasNode } from './canvas-model'
import { blockedReason } from './delete-plan'
import { isRenamable } from './rename-box'
import { isRunnable } from './use-run'

/** 右鍵選單的一項：畫布依 `id` 決定要做什麼。 */
export interface ContextEntry {
  id:
    | 'open'
    | 'story'
    | 'note'
    | 'run'
    | 'incut'
    | 'rename'
    | 'steps'
    | 'focus'
    | 'copy'
    | 'duplicate'
    | 'paste'
    | 'delete'
    | 'add'
    | 'tidy'
    | 'fit'
  label: string
  /** 右邊的小字（快捷鍵）。 */
  hint?: string
  danger?: boolean
  /** 分隔線放在這一項前面。 */
  separated?: boolean
  /** 這一項現在做不了：照樣列出來但標淡；按下去會說明原因，不會默默沒反應。 */
  disabled?: boolean
  /** disabled 的原因（滑過時顯示）。 */
  why?: string
}

const deletable = (node: CanvasNode): boolean => blockedReason(node) === undefined
/** 剪輯只有一個，不能複製；其他都可以（依種類各自處理，uiux-spec §12.10）。 */
const copyable = (node: CanvasNode): boolean => node.data.kind !== 'cut'
const HAS_PANEL = new Set(['shot', 'image', 'video', 'cut', 'character', 'location', 'scene'])

/** ▶ 在選單裡的說法（跟格子的狀態走）。 */
function runLabel(node: CanvasNode): string {
  const { kind, status } = node.data
  if (kind === 'cut') return '全部生成再接成成品'
  if (kind === 'shot') return '生成這一鏡還缺的'
  if (kind === 'scene') return '生成這一場還缺的'
  if (status === 'failed') return '重試'
  if (status === 'done') return '重做（產生新的一版）'
  if (status === 'stale') return '重跑'
  return kind === 'image' ? '生成第一張畫面' : '生成影片'
}

/**
 * 在格子上按右鍵：依種類列出能做的事（打開面板、執行、放進成品、改名、置中、刪除）。
 * 按在已經選取的一群格子上（兩格以上）就是對整群：執行選取的、刪除選取的。
 */
export function nodeEntries(node: CanvasNode, selection: readonly CanvasNode[]): ContextEntry[] {
  const group = selection.some((n) => n.id === node.id) && selection.length > 1 ? selection : []
  if (group.length > 0) {
    const entries: ContextEntry[] = []
    const runnable = group.filter((n) => isRunnable(n.id))
    if (runnable.length > 0)
      entries.push({
        id: 'run',
        label: `執行選取的 ${String(runnable.length)} 格`,
        hint: 'Ctrl+Enter',
      })
    if (group.some(copyable)) {
      entries.push(
        { id: 'copy', label: '複製', hint: 'Ctrl+C', separated: entries.length > 0 },
        { id: 'duplicate', label: '再做一份', hint: 'Ctrl+D' },
      )
    }
    if (group.some(deletable))
      entries.push({
        id: 'delete',
        label: `刪除選取的 ${String(group.length)} 格`,
        hint: 'Delete',
        danger: true,
        separated: entries.length > 0,
      })
    return entries
  }
  const { kind } = node.data
  const entries: ContextEntry[] = []
  if (HAS_PANEL.has(kind))
    entries.push({ id: 'open', label: kind === 'cut' ? '打開成品' : '打開面板', hint: 'Enter' })
  if (kind === 'oneliner') entries.push({ id: 'story', label: '寫故事', hint: 'Enter' })
  if (kind === 'note') entries.push({ id: 'note', label: '編輯文字', hint: 'Enter' })
  if (isRunnable(node.id) && node.data.status !== 'running' && node.data.status !== 'queued')
    entries.push({ id: 'run', label: runLabel(node), hint: 'Ctrl+Enter' })
  if (kind === 'video')
    entries.push({ id: 'incut', label: node.data.inCut === false ? '放回成品' : '不放進成品' })
  if (isRenamable(node.id, kind)) entries.push({ id: 'rename', label: '改名', hint: 'F2' })
  if (kind === 'shot') {
    entries.push({ id: 'steps', label: node.data.expanded === true ? '收合步驟' : '展開步驟' })
  }
  entries.push({ id: 'focus', label: '置中顯示' })
  if (copyable(node)) {
    entries.push(
      { id: 'copy', label: '複製', hint: 'Ctrl+C', separated: true },
      {
        id: 'duplicate',
        label: kind === 'image' || kind === 'video' ? '複製成獨立的一格' : '再做一份',
        hint: 'Ctrl+D',
      },
    )
  }
  // 每一種都列「刪除」：刪不掉的標淡並寫原因（剪輯是由場自動長出來的…），不是把這一項藏起來
  const why = blockedReason(node)
  entries.push({
    id: 'delete',
    label:
      kind === 'group'
        ? '刪除群組（格子留著）'
        : kind === 'image' || kind === 'video'
          ? '清掉採用中的版本'
          : '刪除',
    hint: 'Delete',
    danger: true,
    separated: true,
    ...(why === undefined ? {} : { disabled: true, why }),
  })
  return entries
}

/** 在空白處按右鍵：新增、貼上（有複製的東西時）、整理、全部顯示。 */
export function paneEntries(canPaste = false): ContextEntry[] {
  return [
    { id: 'add', label: '新增…', hint: 'Tab' },
    ...(canPaste ? [{ id: 'paste' as const, label: '貼上', hint: 'Ctrl+V' }] : []),
    { id: 'tidy', label: '整理', separated: true },
    { id: 'fit', label: '全部顯示' },
  ]
}
