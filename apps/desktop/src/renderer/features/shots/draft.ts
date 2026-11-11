import type { BeatKind, ShotEdit, ShotView } from '@svs/schema'

/** 詳情面板上還沒存檔的修改。 */
export interface Draft {
  description: string
  cameraMove: string
  durationSec: number
  prompt: string
  /** 格子種類（預告片）：會動／不動／字卡；片名卡不能在這裡改，維持原樣。 */
  beatKind: BeatKind
  cardText: string
  cardSubtext: string
}

export const draftOf = (shot: ShotView): Draft => ({
  description: shot.description,
  cameraMove: shot.cameraMove ?? '',
  durationSec: shot.durationSec,
  prompt: shot.prompt ?? shot.autoPrompt,
  beatKind: shot.beatKind ?? 'video',
  cardText: shot.card?.text ?? '',
  cardSubtext: shot.card?.subtext ?? '',
})

/** 這一格要不要寫畫面描述、運鏡與 Prompt（字卡與片名卡不用，它們只有字）。 */
export const hasPicture = (kind: BeatKind): boolean => kind === 'video' || kind === 'still'

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
  if (draft.beatKind !== (shot.beatKind ?? 'video')) edit.beatKind = draft.beatKind
  // 字卡的字：只有字卡才存；空的字卡不存（要有字才算字卡，按鈕也會擋）
  const text = draft.cardText.trim()
  const subtext = draft.cardSubtext.trim()
  if (
    draft.beatKind === 'card' &&
    text !== '' &&
    (text !== (shot.card?.text ?? '') || subtext !== (shot.card?.subtext ?? ''))
  ) {
    edit.card = { text, subtext }
  }
  return edit
}
