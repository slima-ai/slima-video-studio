import { SHOT_ANGLE_LABELS, SHOT_SIZE_LABELS, type ShotAngle, type ShotSize } from '@svs/schema'

/** 景別的白話名稱（順序就是下拉選單的順序）。 */
export const SIZE_LABELS: Readonly<Record<ShotSize, string>> = SHOT_SIZE_LABELS

/** 拍攝角度的白話名稱。 */
export const ANGLE_LABELS: Readonly<Record<ShotAngle, string>> = SHOT_ANGLE_LABELS

export const STATUS_LABELS = {
  draft: '還沒生成',
  queued: '排隊中',
  generating: '生成中',
  done: '已完成',
  failed: '失敗',
} as const

/** 「阿鐵、小花」「阿鐵,小花」→ ['阿鐵', '小花']。 */
export function parseNames(text: string): string[] {
  return text
    .split(/[、,，]/)
    .map((name) => name.trim())
    .filter((name) => name !== '')
}
