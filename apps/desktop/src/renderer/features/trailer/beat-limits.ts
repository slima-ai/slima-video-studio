import {
  CARD_MAX_CJK,
  CARD_MAX_WORDS,
  NARRATION_MAX_CJK_PER_SEC,
  NARRATION_MAX_WORDS_PER_SEC,
  getLocale,
  textUnits,
} from '@svs/schema'

const HAN = /\p{Script=Han}/u

/** 這段字用「字」還是「單字」算：有中文就算字；空的看介面語言。檢查器也是看內容判斷的，所以兩邊一致。 */
const countsChars = (text: string): boolean =>
  HAN.test(text) || (text.trim() === '' && getLocale() !== 'en')

export interface Count {
  n: number
  max: number
  /** true：算的是字（中文）；false：算的是單字（英文）。 */
  chars: boolean
  over: boolean
}

/** 旁白字數：上限是這一格秒數 × 每秒上限，無條件捨去。超過仍然可以存（檢查器自己會給 warning）。 */
export function narrationCount(text: string, sec: number): Count {
  const chars = countsChars(text)
  const max = Math.floor(
    (chars ? NARRATION_MAX_CJK_PER_SEC : NARRATION_MAX_WORDS_PER_SEC) * sec + 1e-9,
  )
  const n = textUnits(text)
  return { n, max, chars, over: n > max }
}

/** 字卡上的字數與上限（12 字／6 個單字）。 */
export function cardCount(text: string): Count {
  const chars = countsChars(text)
  const max = chars ? CARD_MAX_CJK : CARD_MAX_WORDS
  const n = textUnits(text)
  return { n, max, chars, over: n > max }
}
