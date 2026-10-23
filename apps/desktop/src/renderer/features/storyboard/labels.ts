import {
  CAMERA_MOVES,
  ShotAngleSchema,
  ShotSizeSchema,
  cameraMoveHint,
  cameraMoveLabel,
  msg,
  shotAngleLabel,
  shotSizeLabel,
} from '@svs/schema'

/** 景別的下拉選項（順序就是下拉選單的順序；名稱跟著介面語言，所以是函式）。 */
export const sizeOptions = (): { value: string; label: string }[] =>
  ShotSizeSchema.options.map((value) => ({ value, label: shotSizeLabel(value) }))

/** 拍攝角度的下拉選項。 */
export const angleOptions = (): { value: string; label: string }[] =>
  ShotAngleSchema.options.map((value) => ({ value, label: shotAngleLabel(value) }))

/** 預設運鏡的下拉選項（不含「不指定」那一項，由各處自己加）。 */
export const cameraMoveOptions = (): { value: string; label: string; hint: string }[] =>
  CAMERA_MOVES.map((move) => ({
    value: move.id,
    label: cameraMoveLabel(move.id),
    hint: cameraMoveHint(move.id) ?? '',
  }))

export const STATUS_LABELS = {
  draft: msg('storyboard.notGenerated'),
  queued: msg('storyboard.queued'),
  generating: msg('storyboard.generating'),
  done: msg('storyboard.done'),
  failed: msg('storyboard.failed'),
} as const

/** 「阿鐵、小花」「阿鐵,小花」→ ['阿鐵', '小花']。 */
export function parseNames(text: string): string[] {
  return text
    .split(/[、,，]/)
    .map((name) => name.trim())
    .filter((name) => name !== '')
}
