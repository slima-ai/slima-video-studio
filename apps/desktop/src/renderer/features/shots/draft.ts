import type { ShotEdit, ShotView } from '@svs/schema'

/** 詳情面板上還沒存檔的修改。 */
export interface Draft {
  description: string
  cameraMove: string
  durationSec: number
  prompt: string
}

export const draftOf = (shot: ShotView): Draft => ({
  description: shot.description,
  cameraMove: shot.cameraMove ?? '',
  durationSec: shot.durationSec,
  prompt: shot.prompt ?? shot.autoPrompt,
})

/** 草稿跟目前存的內容比較，只回傳有改的欄位。 */
export function diffDraft(shot: ShotView, draft: Draft): ShotEdit {
  const edit: ShotEdit = {}
  const description = draft.description.trim()
  if (description !== shot.description) edit.description = description
  const camera = draft.cameraMove.trim()
  if (camera !== (shot.cameraMove ?? '')) edit.cameraMove = camera === '' ? null : camera
  if (draft.durationSec !== shot.durationSec) edit.durationSec = draft.durationSec
  const prompt = draft.prompt.trim()
  if (prompt !== (shot.prompt ?? shot.autoPrompt)) {
    // 改回跟自動組出的一樣（或清空）= 清掉手動修改
    edit.prompt = prompt === shot.autoPrompt || prompt === '' ? null : prompt
  }
  return edit
}
