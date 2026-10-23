import { describe, expect, it } from 'vitest'

import { assetUrl, parseAssetUrl, parseExportUrl } from './asset-url'

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

describe('parseExportUrl', () => {
  const url = (name: string): string => `svs-asset://export/${encodeURIComponent(name)}`

  it('接受 svs-asset://export/<檔名>，中文檔名要 encode 過', () => {
    expect(parseExportUrl(url('最終成品（中文旁白）.mp4'))).toEqual({
      ok: true,
      name: '最終成品（中文旁白）.mp4',
    })
    expect(parseExportUrl('svs-asset://export/film.mp4?t=1#x')).toEqual({
      ok: true,
      name: 'film.mp4',
    })
  })

  it('拒絕路徑穿越、隱藏檔、其他主機名稱與各種變形', () => {
    const bad = [
      'svs-asset://export/../../etc/passwd',
      'svs-asset://export/..%2F..%2Fetc%2Fpasswd',
      'svs-asset://export/sub%2Ffilm.mp4',
      'svs-asset://export/sub%5Cfilm.mp4',
      'svs-asset://export/film%00.mp4',
      'svs-asset://export/.hidden.mp4',
      'svs-asset://export/%E0%A4%A',
      'svs-asset://export/',
      'svs-asset://export',
      'svs-asset://user:pw@export/film.mp4',
      'svs-asset://export:8080/film.mp4',
      'svs-asset://asset/film.mp4',
      `svs-asset://asset/${HASH}`,
      'file://export/film.mp4',
      'not a url',
      '',
    ]
    for (const raw of bad) expect(parseExportUrl(raw), raw).toEqual({ ok: false, status: 400 })
  })

  it('素材庫的網址不會被當成成品網址（反過來也一樣）', () => {
    expect(parseExportUrl(assetUrl(HASH))).toEqual({ ok: false, status: 400 })
    expect(parseAssetUrl(url('film.mp4'))).toEqual({ ok: false, status: 400 })
  })
})
