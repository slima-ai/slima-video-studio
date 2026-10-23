import { msg, t, type MessageRef } from '../i18n'
import { type CharacterReferencePurpose } from './characters'
import { type LocationReferencePurpose } from './location-cards'
import { type QuickStyleId } from './quickstart'
import { type ShotAngle, type ShotSize } from './story'

/**
 * 給「人」看的名稱，跟著介面語言。送給模型的 Prompt 與 MCP 回給 Claude 的名稱仍用各自檔案裡的中文表
 * （`SHOT_SIZE_LABELS`、`CAMERA_MOVES`…）：提示的內容用 SHA-256 釘住，不隨介面語言變。
 */
const SIZE: Readonly<Record<ShotSize, MessageRef>> = {
  extreme_wide: msg('labels.size.extremeWide'),
  wide: msg('labels.size.wide'),
  full: msg('labels.size.full'),
  medium: msg('labels.size.medium'),
  close_up: msg('labels.size.closeUp'),
  extreme_close_up: msg('labels.size.extremeCloseUp'),
}
export const shotSizeLabel = (size: ShotSize): string => t(SIZE[size])

const ANGLE: Readonly<Record<ShotAngle, MessageRef>> = {
  eye_level: msg('labels.angle.eyeLevel'),
  high: msg('labels.angle.high'),
  low: msg('labels.angle.low'),
  overhead: msg('labels.angle.overhead'),
  over_shoulder: msg('labels.angle.overShoulder'),
  side: msg('labels.angle.side'),
  back: msg('labels.angle.back'),
  dutch: msg('labels.angle.dutch'),
}
export const shotAngleLabel = (angle: ShotAngle): string => t(ANGLE[angle])

const STYLE: Readonly<Record<QuickStyleId, MessageRef>> = {
  realistic: msg('labels.style.realistic'),
  anime: msg('labels.style.anime'),
  '3d': msg('labels.style.3d'),
  watercolor: msg('labels.style.watercolor'),
  painted: msg('labels.style.painted'),
}
export const quickStyleLabel = (id: QuickStyleId): string => t(STYLE[id])

const MOVE: Readonly<Record<string, { label: MessageRef; hint: MessageRef }>> = {
  static: { label: msg('labels.move.static'), hint: msg('labels.moveHint.static') },
  push_in: { label: msg('labels.move.pushIn'), hint: msg('labels.moveHint.pushIn') },
  pull_out: { label: msg('labels.move.pullOut'), hint: msg('labels.moveHint.pullOut') },
  pan: { label: msg('labels.move.pan'), hint: msg('labels.moveHint.pan') },
  tilt: { label: msg('labels.move.tilt'), hint: msg('labels.moveHint.tilt') },
  orbit: { label: msg('labels.move.orbit'), hint: msg('labels.moveHint.orbit') },
  follow: { label: msg('labels.move.follow'), hint: msg('labels.moveHint.follow') },
  handheld: { label: msg('labels.move.handheld'), hint: msg('labels.moveHint.handheld') },
  crane: { label: msg('labels.move.crane'), hint: msg('labels.moveHint.crane') },
  slow_motion: { label: msg('labels.move.slowMotion'), hint: msg('labels.moveHint.slowMotion') },
}

/** 運鏡的名稱；不是預設清單裡的（舊資料或自己打的字）就原樣顯示。 */
export const cameraMoveLabel = (value: string): string => {
  const known = MOVE[value]
  return known ? t(known.label) : value
}

/** 運鏡的一句白話說明（選單旁邊顯示）；不是預設清單裡的沒有說明。 */
export const cameraMoveHint = (value: string): string | undefined => {
  const known = MOVE[value]
  return known ? t(known.hint) : undefined
}

const CHAR_REF: Readonly<Record<CharacterReferencePurpose, MessageRef>> = {
  face: msg('labels.charRef.face'),
  body: msg('labels.charRef.body'),
  turnaround: msg('labels.charRef.turnaround'),
  expression: msg('labels.charRef.expression'),
  costume: msg('labels.charRef.costume'),
  prop: msg('labels.charRef.prop'),
  general: msg('labels.charRef.general'),
}
export const characterReferencePurposeLabel = (purpose: CharacterReferencePurpose): string =>
  t(CHAR_REF[purpose])

const LOC_REF: Readonly<Record<LocationReferencePurpose, MessageRef>> = {
  main: msg('labels.locRef.main'),
  reverse: msg('labels.locRef.reverse'),
  wide: msg('labels.locRef.wide'),
  top_down: msg('labels.locRef.topDown'),
  depth: msg('labels.locRef.depth'),
  general: msg('labels.locRef.general'),
}
export const locationReferencePurposeLabel = (purpose: LocationReferencePurpose): string =>
  t(LOC_REF[purpose])
