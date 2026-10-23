import { msg, type MessageRef } from '@svs/schema'

/** 音量只給「小／中／大」三段（不是 dB 滑桿），各種聲音對應的 dB。 */
export type Level = 'low' | 'mid' | 'high'

export const LEVEL_LABELS: Record<Level, MessageRef> = {
  low: msg('sound.low'),
  mid: msg('sound.medium'),
  high: msg('sound.high'),
}

export const NATIVE_DB: Record<Level, number> = { low: -9, mid: 0, high: 4 }
export const NARRATION_DB: Record<Level, number> = { low: -6, mid: 0, high: 4 }
export const MUSIC_DB: Record<Level, number> = { low: -24, mid: -18, high: -12 }

/** 目前的增益最接近哪一段。 */
export function levelOf(table: Record<Level, number>, db: number): Level {
  const levels = Object.keys(table) as Level[]
  return levels.reduce((best, level) =>
    Math.abs(table[level] - db) < Math.abs(table[best] - db) ? level : best,
  )
}
