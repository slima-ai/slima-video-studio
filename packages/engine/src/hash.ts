import { createHash } from 'node:crypto'

/**
 * 穩定的 JSON 序列化：物件的 key 依字母排序，所以「內容相同」就會得到「字串相同」。
 * undefined 的欄位直接省略（跟 JSON.stringify 一致）；函式、symbol、bigint、NaN / Infinity 不是 JSON 值，會丟錯。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('不能序列化 NaN 或 Infinity')
    return JSON.stringify(value)
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.map((v: unknown) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(',')}}`
  }
  throw new TypeError(`不能序列化 ${typeof value}`)
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 任意 JSON 值的內容雜湊。 */
export function hashValue(value: unknown): string {
  return sha256Hex(stableStringify(value))
}
