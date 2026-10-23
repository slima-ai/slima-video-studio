import { getLocale, intlTag, type Locale } from './locale'
import type { EnglishDictionary } from './dictionary'
import { en as enRaw } from './locales/en'
import { zhTW } from './locales/zh-TW'

type ZhDict = typeof zhTW
/** 英文字串檔：型別檢查它和中文有同一組 key（少一條、多一條都編譯不過）。 */
const en: EnglishDictionary = enRaw

/** 單複數的字尾：`foo_one`、`foo_other` 合起來是一條訊息 `foo`（用 `count` 參數挑）。 */
type PluralSuffix = '_one' | '_other'
type PluralBase<K extends string> = K extends `${infer B}${PluralSuffix}` ? B : never

/** 所有可以傳給 `t()` 的 key：一般的 key，加上單複數訊息的底（`foo`）。 */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents -- 目前還沒有單複數的訊息，PluralBase 算出來是 never；有了就是那些訊息的底（foo） */
export type MessageKey =
  Exclude<keyof ZhDict, `${string}${PluralSuffix}`> | PluralBase<Extract<keyof ZhDict, string>>
/* eslint-enable @typescript-eslint/no-redundant-type-constituents */

type TextOf<K extends string> = K extends keyof ZhDict
  ? ZhDict[K]
  : `${K}_other` extends keyof ZhDict
    ? ZhDict[`${K}_other`]
    : never

type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | ParamNames<Rest>
  : never

/** 這條訊息要傳的參數（從中文原文的 `{名稱}` 推出來；單複數的訊息固定要有 `count`）。 */
export type ParamsOf<K extends MessageKey> = Record<ParamNames<TextOf<K>>, string | number>

type HasParams<K extends MessageKey> = [ParamNames<TextOf<K>>] extends [never] ? false : true

/** 沒有參數的 key（用 `msg()` 標記、存在常數表裡）。 */
export type PlainMessageKey = {
  [K in MessageKey]: HasParams<K> extends true ? never : K
}[MessageKey]

/**
 * 在「模組載入時就固定」的地方（常數表、陣列）用 `msg('key')` 標記要翻的字：它只回傳 key 本身，
 * 用的時候再 `t(label)`。直接在模組層級呼叫 `t()` 會把語言鎖在載入的那一刻，切換語言就不會變。
 */
export function msg<K extends PlainMessageKey>(key: K): MessageRef<K> {
  return { msgKey: key }
}

/** `msg()` 的結果：故意不是字串，所以沒有經過 `t()` 就放進畫面或當字串用會編譯不過。 */
export interface MessageRef<K extends PlainMessageKey = PlainMessageKey> {
  readonly msgKey: K
}

type Args<K extends MessageKey> = HasParams<K> extends true ? [params: ParamsOf<K>] : []

const PSEUDO_FROM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const PSEUDO_TO = 'àbçdéfgĥìjķlmñöpqŕšţûvŵxýžÀBÇDÉFGĤÌJĶLMÑÖPQŔŠŢÛVŴXÝŽ'

/** 假語系：英文每個字母換成帶記號的、拉長約 40%、前後加括號；`{參數}` 原樣保留。 */
export function pseudoLocalize(text: string): string {
  let out = ''
  let inParam = false
  for (const char of text) {
    if (char === '{') inParam = true
    const index = PSEUDO_FROM.indexOf(char)
    out += !inParam && index >= 0 ? (PSEUDO_TO[index] ?? char) : char
    if (char === '}') inParam = false
  }
  const pad = '·'.repeat(Math.ceil(text.length * 0.4))
  return `[${out}${pad}]`
}

function dictionaryFor(locale: Locale): Readonly<Record<string, string>> {
  return locale === 'zh-TW' ? zhTW : en
}

type Dictionary = Readonly<Partial<Record<string, string>>>

/**
 * 在一份字串檔裡找訊息：有 `count` 就依該語言的單複數規則挑 `key_one`／`key_other`；
 * 找不到就退回 `fallback`（中文原文），最後才是 key 本身——畫面上不會出現 key。
 * （匯出只是為了單元測試；平常用 `t()`。）
 */
export function lookupMessage(
  dict: Dictionary,
  tag: string,
  key: string,
  count: number | undefined,
  fallback: Dictionary = {},
): string {
  if (count !== undefined) {
    const form = new Intl.PluralRules(tag).select(count)
    const plural = dict[`${key}_${form}`] ?? dict[`${key}_other`]
    if (plural !== undefined) return plural
  }
  return dict[key] ?? fallback[key] ?? key
}

function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** 翻成目前語言。有 `{名稱}` 的訊息要傳參數（型別會檢查名稱）；單複數的訊息用 `count` 挑字尾。 */
export function t(ref: MessageRef): string
export function t<K extends MessageKey>(key: K, ...args: Args<K>): string
export function t(keyOrRef: MessageKey | MessageRef, ...args: unknown[]): string {
  const key = typeof keyOrRef === 'string' ? keyOrRef : keyOrRef.msgKey
  const locale = getLocale()
  const params = (args[0] ?? {}) as Readonly<Record<string, string | number>>
  const count = typeof params.count === 'number' ? params.count : undefined
  const lookupLocale = locale === 'en-XA' ? 'en' : locale
  const raw = lookupMessage(dictionaryFor(lookupLocale), intlTag(lookupLocale), key, count, zhTW)
  // 假語系先換字再插值：{參數} 與傳進來的值（專案名、數字）都原樣保留
  return interpolate(locale === 'en-XA' ? pseudoLocalize(raw) : raw, params)
}

/** 數字依目前語言排版（千分位）。 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(intlTag()).format(value)
}

export type DateStyle = 'dateTime' | 'time' | 'timeShort'

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  dateTime: { hour12: false, dateStyle: 'short', timeStyle: 'medium' },
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  timeShort: { hour: '2-digit', minute: '2-digit' },
}

/** 日期時間依目前語言排版；`zh-TW` 的輸出和以前的 `toLocaleString('zh-TW', …)` 一模一樣。 */
export function formatDate(value: Date | string | number, style: DateStyle): string {
  const date = value instanceof Date ? value : new Date(value)
  const tag = intlTag()
  return style === 'dateTime'
    ? date.toLocaleString(tag, DATE_OPTIONS[style])
    : date.toLocaleTimeString(tag, DATE_OPTIONS[style])
}
