import type { zhTW } from './locales/zh-TW'

type ZhDict = typeof zhTW
type PluralSuffix = '_one' | '_other'
type PluralBase<K extends string> = K extends `${infer B}${PluralSuffix}` ? B : never

/**
 * 英文字串檔的型別：中文有的 key 英文都要有（少一條編譯不過）；英文另外可以有單複數的 `_one`
 * （中文只需要 `_other`）。多出中文沒有的 key 也會編譯不過。
 */
export type EnglishDictionary = Readonly<Record<keyof ZhDict, string>> &
  Readonly<Partial<Record<`${PluralBase<Extract<keyof ZhDict, string>>}_one`, string>>>
