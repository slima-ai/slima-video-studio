import { describe, expect, it } from 'vitest'

import { createWindowOptions } from './window'

describe('createWindowOptions', () => {
  const options = createWindowOptions('/path/to/preload.js')
  const prefs = options.webPreferences

  it('使用安全的 webPreferences', () => {
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    })
  })

  it('帶入 preload 路徑', () => {
    expect(prefs?.preload).toBe('/path/to/preload.js')
  })

  it('等 ready-to-show 才顯示，避免白屏閃爍', () => {
    expect(options.show).toBe(false)
  })

  it('一般模式的視窗可以拿焦點、在螢幕上；安靜模式（給自動化測試）不能拿焦點、不進工作列、放在螢幕外', () => {
    expect(options.focusable).toBeUndefined()
    expect(options.x).toBeUndefined()
    const quiet = createWindowOptions('/path/to/preload.js', { quiet: true })
    expect(quiet).toMatchObject({ focusable: false, skipTaskbar: true, x: -20000, y: -20000 })
    // 安全預設一樣
    expect(quiet.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true })
  })
})
