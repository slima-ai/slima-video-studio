import type { CanvasNode } from './canvas-model'
import { blockedReason } from './delete-plan'
import { isRenamable } from './rename-box'
import { isRunnable } from './use-run'
import { t } from '@svs/schema'

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
  if (kind === 'cut') return t('canvas.generateAllThenJoinInto')
  if (kind === 'shot') return t('canvas.generateWhatThisShotIs')
  if (kind === 'scene') return t('canvas.generateWhatThisSceneIs')
  if (status === 'failed') return t('canvas.retry')
  if (status === 'done') return t('canvas.redoMakeANewVersion')
  if (status === 'stale') return t('canvas.runAgain')
  return kind === 'image' ? t('canvas.generateFirstFrame') : t('canvas.generateVideo')
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
        label: t('canvas.runTheSelectedCells', { value: String(runnable.length) }),
        hint: 'Ctrl+Enter',
      })
    if (group.some(copyable)) {
      entries.push(
        { id: 'copy', label: t('canvas.copy3'), hint: 'Ctrl+C', separated: entries.length > 0 },
        { id: 'duplicate', label: t('canvas.duplicate'), hint: 'Ctrl+D' },
      )
    }
    if (group.some(deletable))
      entries.push({
        id: 'delete',
        label: t('canvas.deleteTheSelectedCells', { value: String(group.length) }),
        hint: 'Delete',
        danger: true,
        separated: entries.length > 0,
      })
    return entries
  }
  const { kind } = node.data
  const entries: ContextEntry[] = []
  if (HAS_PANEL.has(kind))
    entries.push({
      id: 'open',
      label: kind === 'cut' ? t('canvas.openFilm') : t('canvas.openPanel'),
      hint: 'Enter',
    })
  if (kind === 'oneliner')
    entries.push({ id: 'story', label: t('canvas.writeStory'), hint: 'Enter' })
  if (kind === 'note') entries.push({ id: 'note', label: t('canvas.editText'), hint: 'Enter' })
  if (isRunnable(node.id) && node.data.status !== 'running' && node.data.status !== 'queued')
    entries.push({ id: 'run', label: runLabel(node), hint: 'Ctrl+Enter' })
  if (kind === 'video')
    entries.push({
      id: 'incut',
      label: node.data.inCut === false ? t('canvas.putBackInFilm') : t('canvas.leaveOutOfFilm'),
    })
  if (isRenamable(node.id, kind))
    entries.push({ id: 'rename', label: t('canvas.rename'), hint: 'F2' })
  if (kind === 'shot') {
    entries.push({
      id: 'steps',
      label: node.data.expanded === true ? t('canvas.collapseSteps') : t('canvas.expandSteps'),
    })
  }
  entries.push({ id: 'focus', label: t('canvas.center') })
  if (copyable(node)) {
    entries.push(
      { id: 'copy', label: t('canvas.copy3'), hint: 'Ctrl+C', separated: true },
      {
        id: 'duplicate',
        label:
          kind === 'image' || kind === 'video'
            ? t('canvas.copyAsASeparateCell')
            : t('canvas.duplicate'),
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
        ? t('canvas.deleteGroupKeepItsCells')
        : kind === 'image' || kind === 'video'
          ? t('canvas.clearTheVersionInUse')
          : t('canvas.delete'),
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
    { id: 'add', label: t('canvas.add3'), hint: 'Tab' },
    ...(canPaste ? [{ id: 'paste' as const, label: t('canvas.paste'), hint: 'Ctrl+V' }] : []),
    { id: 'tidy', label: t('canvas.tidy'), separated: true },
    { id: 'fit', label: t('canvas.showAll') },
  ]
}
