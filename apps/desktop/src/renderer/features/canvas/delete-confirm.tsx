import { Button } from '../../components/button'
import { Modal } from '../../components/modal'
import type { CanvasNode } from './canvas-model'

/** 這次要刪的東西，分種類整理好（畫面上要先確認）。 */
export interface DeletePlan {
  keys: string[]
  /** 給對話框念的幾行白話後果。 */
  lines: string[]
  /** 刪完可不可以用「復原」收回（現在全部都可以）。 */
  undoable: boolean
  /** 只有便條、群組這類自由格子，或單獨的圖、影片：不動到故事資料，直接刪（可以復原），不用先確認。 */
  freeOnly?: boolean
}

/** 直接刪、不用確認的自由格子。 */
const FREE_KINDS = new Set(['note', 'group', 'freeImage', 'freeVideo'])

const nameOf = (node: CanvasNode): string => {
  const title = node.data.title
  return title.includes('・') ? title.split('・').slice(1).join('・') || title : title
}

/**
 * 依選取的格子排出要刪的東西與後果。鏡頭的圖與影片跟著鏡頭走；單獨選到圖或影片是清掉採用中的版本
 * （uiux-spec §12.10）。剪輯不能刪。什麼都不能刪就回 undefined。
 */
export function planDelete(
  nodes: readonly CanvasNode[],
  selected: ReadonlySet<string>,
): { plan?: DeletePlan; reason?: string } {
  const picked = nodes.filter((n) => selected.has(n.id))
  const shots = picked.filter((n) => n.data.kind === 'shot')
  const shotIds = new Set(shots.map((n) => n.id))
  const scenes = picked.filter((n) => n.data.kind === 'scene')
  const locations = picked.filter((n) => n.data.kind === 'location')
  const characters = picked.filter((n) => n.data.kind === 'character')
  const strays = picked.filter(
    (n) =>
      (n.data.kind === 'image' || n.data.kind === 'video') &&
      !(n.data.shotId !== undefined && shotIds.has(n.data.shotId)),
  )
  const frees = picked.filter((n) => FREE_KINDS.has(n.data.kind))
  // 單獨選到的圖或影片：清掉採用中的版本（版本還在生成紀錄裡），還沒有版本的不用清
  const clears = strays.filter((n) => n.data.thumb !== undefined || n.data.videoSrc !== undefined)
  const keys = [...shots, ...scenes, ...locations, ...characters, ...frees, ...clears].map(
    (n) => n.id,
  )
  // 只有自由格子、圖或影片：不動到故事資料，直接刪（可以復原），不用先確認
  if (keys.length > 0 && frees.length + clears.length === keys.length) {
    return { plan: { keys, lines: [], undoable: true, freeOnly: true } }
  }
  if (keys.length === 0) {
    if (strays.length > 0) return { reason: '這一格還沒有圖或影片，沒有東西可以刪' }
    if (picked.some((n) => n.data.kind === 'cut')) return { reason: '剪輯是最後的成品，不能刪' }
    return {}
  }
  const lines: string[] = []
  if (shots.length > 0) {
    lines.push(
      `${String(shots.length)} 個鏡頭（${shots.map((n) => n.data.title).join('、')}）連同它們的圖和影片版本`,
    )
  }
  for (const scene of scenes) {
    lines.push(`「${nameOf(scene)}」這一場（裡面的鏡頭會留著，只是不屬於任何場）`)
  }
  for (const location of locations) {
    lines.push(`地點「${location.data.title}」（指到它的場和鏡頭會清空地點）`)
  }
  for (const free of frees) {
    lines.push(
      free.data.kind === 'group'
        ? `群組「${free.data.title}」（框裡的格子留著）`
        : free.data.kind === 'note'
          ? `便條「${(free.data.summary ?? '').slice(0, 12) || '空白'}」`
          : `${free.data.kind === 'freeVideo' ? '影片' : '圖片'}「${free.data.title}」`,
    )
  }
  for (const clear of clears) {
    const shot = nodes.find((n) => n.data.kind === 'shot' && n.data.shotId === clear.data.shotId)
    lines.push(
      `${shot?.data.title ?? ''}${clear.data.kind === 'video' ? '的影片' : '的第一張畫面'}（清掉採用中的版本，版本還在生成紀錄裡）`,
    )
  }
  for (const character of characters) {
    lines.push(
      `角色「${character.data.title}」（出場的鏡頭會拿掉這個角色；角色卡、概念圖、三視圖一起刪）`,
    )
  }
  return { plan: { keys, lines, undoable: true } }
}

export function DeleteConfirm({
  plan,
  onOk,
  onCancel,
}: {
  plan: DeletePlan
  onOk: () => void
  onCancel: () => void
}) {
  return (
    <Modal label="確認刪除" onClose={onCancel} testId="delete-confirm">
      <div className="flex w-[420px] max-w-full flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">要刪除這些嗎？</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
          {plan.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {plan.undoable ? (
          <p className="text-xs text-fg-subtle">刪除後可以按「復原」或 Cmd/Ctrl+Z 收回。</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" onClick={onOk} data-testid="delete-confirm-ok" autoFocus>
            刪除
          </Button>
        </div>
      </div>
    </Modal>
  )
}
