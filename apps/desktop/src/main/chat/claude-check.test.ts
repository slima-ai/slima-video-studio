import { describe, expect, it } from 'vitest'

import { checkClaude, compareVersions, parseVersion } from './claude-check'

describe('版本', () => {
  it('從 claude --version 的輸出取版本號、比較新舊', () => {
    expect(parseVersion('2.1.304 (Claude Code)\n')).toBe('2.1.304')
    expect(parseVersion('找不到')).toBeUndefined()
    expect(compareVersions('2.1.304', '2.1.259')).toBeGreaterThan(0)
    expect(compareVersions('2.1.259', '2.1.259')).toBe(0)
    expect(compareVersions('2.0.999', '2.1.0')).toBeLessThan(0)
    expect(compareVersions('10.0.0', '9.9.9')).toBeGreaterThan(0)
  })
})

describe('checkClaude：沒裝／版本太舊／沒登入／可以用', () => {
  const run =
    (version: string, auth: string | Error) =>
    (_file: string, args: string[]): Promise<string> => {
      if (args[0] === '--version') return Promise.resolve(`${version} (Claude Code)`)
      return auth instanceof Error ? Promise.reject(auth) : Promise.resolve(auth)
    }
  const find = () => Promise.resolve('/bin/claude')

  it('找不到 claude，或 --version 沒輸出：沒裝', async () => {
    expect(
      await checkClaude({
        findClaude: () => Promise.resolve(undefined),
        run: run('2.1.304', '{}'),
      }),
    ).toEqual({
      state: 'not_installed',
    })
    expect(
      await checkClaude({ findClaude: find, run: () => Promise.reject(new Error('boom')) }),
    ).toEqual({ state: 'not_installed' })
  })

  it('版本低於最低版：太舊，說明最低要幾版', async () => {
    expect(await checkClaude({ findClaude: find, run: run('2.1.100', '{}') })).toEqual({
      state: 'too_old',
      path: '/bin/claude',
      version: '2.1.100',
      minVersion: '2.1.259',
    })
  })

  it('auth status 說 loggedIn:false：沒登入（email 之類的欄位完全不讀）', async () => {
    const out = JSON.stringify({ loggedIn: false, email: 'someone@example.com' })
    const result = await checkClaude({ findClaude: find, run: run('2.1.304', out) })
    expect(result).toEqual({ state: 'not_logged_in', path: '/bin/claude', version: '2.1.304' })
    expect(JSON.stringify(result)).not.toContain('example.com')
  })

  it('已登入、或 auth status 解析不出來／沒有這個指令：不擋，視為可以用', async () => {
    for (const auth of [
      JSON.stringify({ loggedIn: true }),
      '看不懂',
      new Error('unknown command'),
    ]) {
      expect(await checkClaude({ findClaude: find, run: run('2.1.304', auth) })).toEqual({
        state: 'ready',
        path: '/bin/claude',
        version: '2.1.304',
      })
    }
  })
})
