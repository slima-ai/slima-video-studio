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
})
