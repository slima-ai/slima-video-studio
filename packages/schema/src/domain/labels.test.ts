import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, setLocale } from '../i18n'
import { CAMERA_MOVES, cameraMoveById } from './camera'
import { CHARACTER_REFERENCE_PURPOSE_LABELS, CHARACTER_REFERENCE_PURPOSES } from './characters'
import {
  cameraMoveHint,
  cameraMoveLabel,
  characterReferencePurposeLabel,
  locationReferencePurposeLabel,
  quickStyleLabel,
  shotAngleLabel,
  shotSizeLabel,
} from './labels'
import { LOCATION_REFERENCE_PURPOSE_LABELS, LOCATION_REFERENCE_PURPOSES } from './location-cards'
import { QUICK_STYLE_IDS, QUICK_STYLE_LABELS } from './quickstart'
import { SHOT_ANGLE_LABELS, SHOT_SIZE_LABELS, ShotAngleSchema, ShotSizeSchema } from './story'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const HAN = /[㐀-鿿]/

describe('給人看的名稱表（景別、角度、運鏡、畫風、參考圖用途）', () => {
  it('繁中：跟原本給模型看的中文表一字不差（換成函式沒有改到任何一個字）', () => {
    for (const size of ShotSizeSchema.options)
      expect(shotSizeLabel(size)).toBe(SHOT_SIZE_LABELS[size])
    for (const angle of ShotAngleSchema.options)
      expect(shotAngleLabel(angle)).toBe(SHOT_ANGLE_LABELS[angle])
    for (const id of QUICK_STYLE_IDS) expect(quickStyleLabel(id)).toBe(QUICK_STYLE_LABELS[id])
    for (const move of CAMERA_MOVES) {
      expect(cameraMoveLabel(move.id)).toBe(move.label)
      expect(cameraMoveHint(move.id)).toBe(move.description)
    }
    for (const purpose of CHARACTER_REFERENCE_PURPOSES)
      expect(characterReferencePurposeLabel(purpose)).toBe(
        CHARACTER_REFERENCE_PURPOSE_LABELS[purpose],
      )
    for (const purpose of LOCATION_REFERENCE_PURPOSES)
      expect(locationReferencePurposeLabel(purpose)).toBe(
        LOCATION_REFERENCE_PURPOSE_LABELS[purpose],
      )
  })

  it('英文：每一個值都有名稱、不含中文、也不是中文表裡的字', () => {
    setLocale('en')
    const seen: string[] = [
      ...ShotSizeSchema.options.map(shotSizeLabel),
      ...ShotAngleSchema.options.map(shotAngleLabel),
      ...QUICK_STYLE_IDS.map(quickStyleLabel),
      ...CAMERA_MOVES.map((m) => cameraMoveLabel(m.id)),
      ...CAMERA_MOVES.map((m) => cameraMoveHint(m.id) ?? ''),
      ...CHARACTER_REFERENCE_PURPOSES.map(characterReferencePurposeLabel),
      ...LOCATION_REFERENCE_PURPOSES.map(locationReferencePurposeLabel),
    ]
    expect(seen.length).toBeGreaterThan(40)
    for (const text of seen) {
      expect(text.trim(), text).not.toBe('')
      expect(HAN.test(text), text).toBe(false)
    }
    expect(shotSizeLabel('close_up')).toBe('Close-up')
    expect(shotAngleLabel('over_shoulder')).toBe('Over the shoulder')
    expect(quickStyleLabel('3d')).toBe('3D animation')
    expect(cameraMoveLabel('push_in')).toBe('Push in')
  })

  it('預設運鏡清單和名稱表一一對應；不在清單裡的（舊資料、自己打的）原樣顯示、沒有說明', () => {
    for (const move of CAMERA_MOVES) expect(cameraMoveById(move.id)).toBeDefined()
    setLocale('en')
    expect(cameraMoveLabel('whip_pan')).toBe('whip_pan')
    expect(cameraMoveHint('whip_pan')).toBeUndefined()
  })
})
