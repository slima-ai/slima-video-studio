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
export type MessageKey =
  Exclude<keyof ZhDict, `${string}${PluralSuffix}`> | PluralBase<Extract<keyof ZhDict, string>>

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

/** `t()` 的核心：不檢查 key 與參數的型別（`retranslate` 從字串找回 key 時用）。 */
function translate(key: string, params: Readonly<Record<string, string | number>>): string {
  const locale = getLocale()
  const count = typeof params.count === 'number' ? params.count : undefined
  const lookupLocale = locale === 'en-XA' ? 'en' : locale
  const raw = lookupMessage(dictionaryFor(lookupLocale), intlTag(lookupLocale), key, count, zhTW)
  // 假語系先換字再插值：{參數} 與傳進來的值（專案名、數字）都原樣保留
  return interpolate(locale === 'en-XA' ? pseudoLocalize(raw) : raw, params)
}

/** 翻成目前語言。有 `{名稱}` 的訊息要傳參數（型別會檢查名稱）；單複數的訊息用 `count` 挑字尾。 */
export function t(ref: MessageRef): string
export function t<K extends MessageKey>(key: K, ...args: Args<K>): string
export function t(keyOrRef: MessageKey | MessageRef, ...args: unknown[]): string {
  const key = typeof keyOrRef === 'string' ? keyOrRef : keyOrRef.msgKey
  return translate(key, (args[0] ?? {}) as Readonly<Record<string, string | number>>)
}

interface StoredTemplate {
  key: string
  /** 範本裡不是參數的字數（越多越明確）。 */
  literal: number
  pattern: RegExp
  params: string[]
}

const MIN_LITERAL_WITH_PARAMS = 8

let storedIndex: { exact: Map<string, Set<string>>; templates: StoredTemplate[] } | undefined

function buildStoredIndex(): NonNullable<typeof storedIndex> {
  const exact = new Map<string, Set<string>>()
  const templates: StoredTemplate[] = []
  for (const dict of [zhTW, en] as readonly Readonly<Record<string, string>>[]) {
    for (const [fullKey, text] of Object.entries(dict)) {
      const key = fullKey.replace(/_(one|other)$/, '')
      const params = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '')
      if (params.length === 0) {
        const keys = exact.get(text) ?? new Set<string>()
        keys.add(key)
        exact.set(text, keys)
        continue
      }
      const pieces = text.split(/\{\w+\}/)
      const literal = pieces.join('').length
      if (literal < MIN_LITERAL_WITH_PARAMS) continue
      const source = pieces
        .map((piece) => piece.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(.+?)')
      templates.push({ key, literal, pattern: new RegExp(`^${source}$`, 's'), params })
    }
  }
  return { exact, templates }
}

/** 幾條訊息的字一模一樣（意思一樣、英文措辭可能不同）時挑哪一條：先挑錯誤訊息（`errors.*`），再照字串檔的順序。 */
const preferred = (keys: readonly string[]): string | undefined =>
  keys.find((key) => key.startsWith('errors.')) ?? keys[0]

/**
 * 把「錄下來當下就翻好的訊息」換成現在的語言：任務的失敗原因、記錄這類存進檔案的 `userMessage` 是錄的當下翻好的字，
 * 之後換介面語言（或換一個語言的人打開同一個專案）就會看到舊語言。這裡用字串反查它是哪一條訊息（含參數），再用現在的語言翻一次。
 * 找不到（例如外部服務回的原文、使用者自己寫的字）就原樣回傳，絕不亂翻；
 * 不同的 key 寫了一模一樣的中文時（意思相同、英文措辭可能不一樣）挑 `errors.*`，再照字串檔順序挑第一條。
 */
export function retranslate(stored: string): string {
  if (stored.trim() === '') return stored
  storedIndex ??= buildStoredIndex()
  const exactKeys = storedIndex.exact.get(stored)
  if (exactKeys !== undefined) {
    const key = preferred([...exactKeys])
    return key === undefined ? stored : translate(key, {})
  }
  let best:
    { literal: number; keys: string[]; params: Record<string, string | number>[] } | undefined
  for (const template of storedIndex.templates) {
    const match = template.pattern.exec(stored)
    if (match === null) continue
    if (best !== undefined && template.literal < best.literal) continue
    const params: Record<string, string | number> = {}
    template.params.forEach((name, index) => {
      const value = match[index + 1] ?? ''
      params[name] = name === 'count' && /^\d+$/.test(value) ? Number(value) : value
    })
    if (best === undefined || template.literal > best.literal)
      best = { literal: template.literal, keys: [], params: [] }
    best.keys.push(template.key)
    best.params.push(params)
  }
  if (best === undefined) return stored
  const key = preferred(best.keys)
  const params = key === undefined ? undefined : best.params[best.keys.indexOf(key)]
  return key === undefined || params === undefined ? stored : translate(key, params)
}

/**
 * 這條訊息在每一種語言的文字（沒有參數的訊息）。給「存在檔案裡的文字之後要比對」用：例如預設的對話標題存下來之後，
 * 換了語言還是要認得它是預設的。
 */
export function messageVariants(key: PlainMessageKey): string[] {
  return [zhTW[key], en[key]]
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

/** 句子拿來接在別的句子中間時，把第一個字母改小寫（英文用；中文沒有大小寫，原樣回傳）。 */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
