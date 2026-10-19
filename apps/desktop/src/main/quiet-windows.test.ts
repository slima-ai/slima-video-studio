import { describe, expect, it } from 'vitest'

import { QUIET_WINDOWS_ENV, quietWindowsEnabled } from './quiet-windows'

describe('安靜模式只在「非打包版＋明確設了環境變數」時生效', () => {
  it('沒設、設成別的值、打包版（就算設了）都不生效', () => {
    expect(quietWindowsEnabled({}, false)).toBe(false)
    expect(quietWindowsEnabled({ [QUIET_WINDOWS_ENV]: '' }, false)).toBe(false)
    expect(quietWindowsEnabled({ [QUIET_WINDOWS_ENV]: 'true' }, false)).toBe(false)
    expect(quietWindowsEnabled({ [QUIET_WINDOWS_ENV]: '1' }, true)).toBe(false)
  })

  it('非打包版、SVS_QUIET_WINDOWS=1 才生效', () => {
    expect(quietWindowsEnabled({ [QUIET_WINDOWS_ENV]: '1' }, false)).toBe(true)
  })
})
