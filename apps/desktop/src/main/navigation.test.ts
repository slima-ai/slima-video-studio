import { describe, expect, it } from 'vitest'

import { isInternalUrl, isSafeExternalUrl } from './navigation'

describe('isInternalUrl', () => {
  it('dev server：同 origin 才算內部', () => {
    const app = 'http://localhost:5173/'
    expect(isInternalUrl('http://localhost:5173/#/x', app)).toBe(true)
    expect(isInternalUrl('http://localhost:5174/', app)).toBe(false)
    expect(isInternalUrl('https://example.com/', app)).toBe(false)
  })

  it('打包版：只有 App 自己的 index.html 算內部', () => {
    const app = 'file:///opt/app/out/renderer/index.html'
    expect(isInternalUrl('file:///opt/app/out/renderer/index.html#/a', app)).toBe(true)
    expect(isInternalUrl('file:///etc/passwd', app)).toBe(false)
    expect(isInternalUrl('https://example.com/', app)).toBe(false)
  })

  it('壞掉的 URL 一律當外部', () => {
    expect(isInternalUrl('not a url', 'http://localhost:5173/')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('只放行 http(s)', () => {
    expect(isSafeExternalUrl('https://slima.ai/docs')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('svs-asset://abc')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})
