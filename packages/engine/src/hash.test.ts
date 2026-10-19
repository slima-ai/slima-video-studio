import { describe, expect, it } from 'vitest'

import { hashValue, sha256Hex, stableStringify } from './hash'

describe('stableStringify', () => {
  it('物件 key 的順序不影響結果', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    )
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('陣列順序有意義；undefined 欄位省略、陣列裡的 undefined 變 null', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(stableStringify([undefined, 1])).toBe('[null,1]')
  })

  it('基本型別', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('他說"好"')).toBe('"他說\\"好\\""')
    expect(stableStringify(true)).toBe('true')
    expect(stableStringify(false)).toBe('false')
    expect(stableStringify(1.5)).toBe('1.5')
  })

  it('不是 JSON 值的東西會丟錯', () => {
    expect(() => stableStringify(() => 1)).toThrow(TypeError)
    expect(() => stableStringify(Number.NaN)).toThrow(TypeError)
    expect(() => stableStringify(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => stableStringify(10n)).toThrow(TypeError)
    expect(() => stableStringify(Symbol('x'))).toThrow(TypeError)
  })
})

describe('hash', () => {
  it('sha256 對照已知值', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashValue 是 64 碼小寫十六進位，且內容相同就相同', () => {
    expect(hashValue({ a: 1, b: [1, 2] })).toMatch(/^[0-9a-f]{64}$/)
    expect(hashValue({ b: [1, 2], a: 1 })).toBe(hashValue({ a: 1, b: [1, 2] }))
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }))
  })
})
