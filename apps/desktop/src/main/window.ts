import type { BrowserWindowConstructorOptions } from 'electron'

import { QUIET_WINDOW_POSITION } from './quiet-windows'

export const APP_TITLE = 'Slima Video Studio'

/** 視窗建立選項。安全預設集中在這裡，由單元測試把關。 */
export function createWindowOptions(
  preloadPath: string,
  options: { quiet?: boolean } = {},
): BrowserWindowConstructorOptions {
  return {
    // 安靜模式（只給自動化測試）：不能拿到焦點、不進工作列、放在螢幕外
    ...(options.quiet ? { focusable: false, skipTaskbar: true, ...QUIET_WINDOW_POSITION } : {}),
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  }
}
