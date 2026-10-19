/**
 * 安靜模式：自動化測試（Playwright 的 E2E、讓 AI 工具連線的實接）開的 App 視窗，不要跳到桌面上、不要搶走使用者的焦點。
 * 只在「非打包版＋明確設了環境變數」時生效，打包版與一般開發完全不受影響。
 */
export const QUIET_WINDOWS_ENV = 'SVS_QUIET_WINDOWS'

/**
 * 視窗放在螢幕外這麼遠（Windows／Linux 有效；macOS 會把視窗夾回螢幕內，所以另外讓視窗完全透明，見 index.ts）。
 * Playwright 走 DevTools 協定操作，不需要視窗在螢幕上。
 */
export const QUIET_WINDOW_POSITION = { x: -20_000, y: -20_000 } as const

export function quietWindowsEnabled(
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean,
): boolean {
  return !isPackaged && env[QUIET_WINDOWS_ENV] === '1'
}

/**
 * 視窗在螢幕外或被擋住時，Chromium 會停止繪製（截圖、動畫就會卡住）。這幾個開關是 Playwright／Puppeteer
 * 自己也會加的，讓「看不到的視窗」照常繪製。
 */
export const QUIET_COMMAND_LINE_SWITCHES: readonly (readonly [string, string?])[] = [
  ['disable-backgrounding-occluded-windows'],
  ['disable-renderer-backgrounding'],
  ['disable-features', 'CalculateNativeWinOcclusion'],
]
