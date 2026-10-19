import { describe, expect, it } from 'vitest'

import { assetUrl, parseAssetUrl } from './asset-url'

const HASH = 'ab'.repeat(32)

describe('parseAssetUrl', () => {
  it('接受 svs-asset://asset/<hash>，可以帶 query 或 hash', () => {
    expect(parseAssetUrl(assetUrl(HASH))).toEqual({ ok: true, hash: HASH })
    expect(parseAssetUrl(`${assetUrl(HASH)}?t=1#frag`)).toEqual({ ok: true, hash: HASH })
  })

  it('全數字的雜湊也能正常解析', () => {
    const digits = '0123456789'.repeat(7).slice(0, 64)
    expect(parseAssetUrl(assetUrl(digits))).toEqual({ ok: true, hash: digits })
  })

  it('拒絕路徑穿越與各種變形', () => {
    const bad = [
      'svs-asset://../../etc/passwd',
      'svs-asset://..%2F..%2Fetc%2Fpasswd',
      'svs-asset://asset/../../etc/passwd',
      'svs-asset://asset/%2e%2e/%2e%2e/etc/passwd',
      'svs-asset://asset/..%2f..%2fetc%2fpasswd',
      `svs-asset://asset/${HASH}/../../etc/passwd`,
      `svs-asset://asset/${HASH}/sub/file.png`,
      `svs-asset://asset/${HASH}.png`,
      `svs-asset://asset/${HASH}/`,
      `svs-asset://user:pw@asset/${HASH}`,
      `svs-asset://asset:8080/${HASH}`,
      `svs-asset://other/${HASH}`,
      `svs-asset://${HASH}`,
      `svs-asset://asset/${HASH.slice(0, 63)}`,
      `svs-asset://asset/${'g'.repeat(64)}`,
      `svs-asset://asset/${HASH.toUpperCase()}`,
      'svs-asset:///etc/passwd',
      'svs-asset://asset',
      'svs-asset://asset/',
      `file://asset/${HASH}`,
      `https://asset/${HASH}`,
      'not a url',
      '',
    ]
    for (const url of bad) expect(parseAssetUrl(url), url).toEqual({ ok: false, status: 400 })
  })
})
