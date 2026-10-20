import { describe, expect, it } from 'vitest'

import { claudeBinOverride, openrouterBaseUrlOverride, startsOnHome } from './test-overrides'

const env = (value: string | undefined) => ({ SVS_OPENROUTER_BASE_URL: value })

describe('openrouterBaseUrlOverride', () => {
  it('沒設變數：不覆寫（照常連 OpenRouter）', () => {
    expect(openrouterBaseUrlOverride({}, false)).toBeUndefined()
    expect(openrouterBaseUrlOverride(env(''), false)).toBeUndefined()
  })

  it('打包版不吃這個變數，就算設了也不覆寫', () => {
    expect(openrouterBaseUrlOverride(env('http://127.0.0.1:5000'), true)).toBeUndefined()
  })

  it('非打包版、本機位址：生效，去掉結尾的斜線', () => {
    expect(openrouterBaseUrlOverride(env('http://127.0.0.1:5000'), false)).toBe(
      'http://127.0.0.1:5000',
    )
    expect(openrouterBaseUrlOverride(env('http://localhost:5000/api/v1/'), false)).toBe(
      'http://localhost:5000/api/v1',
    )
    expect(openrouterBaseUrlOverride(env('http://[::1]:5000'), false)).toBe('http://[::1]:5000')
  })

  it('不是本機位址一律不接受：Key 會被送到這個位址，不能被環境變數導去別的主機', () => {
    for (const bad of [
      'https://openrouter.ai.evil.example/api/v1',
      'http://192.168.1.10:5000',
      'http://127.0.0.1.evil.example',
      'https://example.com',
    ]) {
      expect(openrouterBaseUrlOverride(env(bad), false), bad).toBeUndefined()
    }
  })

  it('不是 http／https 或格式不對：不接受', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://127.0.0.1', 'not a url', '127.0.0.1:5000']) {
      expect(openrouterBaseUrlOverride(env(bad), false), bad).toBeUndefined()
    }
  })
})

describe('startsOnHome', () => {
  it('沒設變數：先到首頁', () => {
    expect(startsOnHome({}, false)).toBe(true)
    expect(startsOnHome({ SVS_DISABLE_HOME: '' }, false)).toBe(true)
    expect(startsOnHome({ SVS_DISABLE_HOME: '0' }, false)).toBe(true)
  })

  it('非打包版設 SVS_DISABLE_HOME=1：跳過首頁', () => {
    expect(startsOnHome({ SVS_DISABLE_HOME: '1' }, false)).toBe(false)
  })

  it('打包版就算設了也無效：一樣先到首頁', () => {
    expect(startsOnHome({ SVS_DISABLE_HOME: '1' }, true)).toBe(true)
  })
})

describe('claudeBinOverride', () => {
  it('沒設變數：不覆寫（照常找這台電腦的 claude）', () => {
    expect(claudeBinOverride({}, false)).toBeUndefined()
    expect(claudeBinOverride({ SVS_CLAUDE_BIN: '' }, false)).toBeUndefined()
  })

  it('非打包版設了：用那支執行檔', () => {
    expect(claudeBinOverride({ SVS_CLAUDE_BIN: '/tmp/fake-claude' }, false)).toBe(
      '/tmp/fake-claude',
    )
  })

  it('打包版就算設了也無效：不然別人能用環境變數讓 App 執行任意程式', () => {
    expect(claudeBinOverride({ SVS_CLAUDE_BIN: '/tmp/fake-claude' }, true)).toBeUndefined()
  })
})
