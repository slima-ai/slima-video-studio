import type { MenuAction } from '@svs/schema'
import type { MenuItemConstructorOptions } from 'electron'

import { APP_TITLE } from './window'

/** 「開啟最近的專案」子選單最多列幾個。 */
const RECENT_IN_MENU = 5

export interface AppMenuOptions {
  /** 選了「檔案」裡的哪一項（主程序轉給畫面去做）。 */
  onAction?: (action: MenuAction) => void
  /** 「開啟最近的專案」要列的專案（找不到的、現在開著的不要放）。 */
  recent?: readonly { name: string; dir: string }[]
}

/**
 * 視窗上方的選單：Windows／Linux 不放選單列（預設的是英文的 File、Edit、View、Window，
 * 而且裡面的東西 App 用不到）；macOS 一定要有選單，Cmd+C／V／Z 這些才會在輸入框裡生效，所以放中文的精簡選單，並有「檔案」：新專案、開啟、儲存、另存為。
 * 回傳 null 代表不要選單。
 */
export function appMenuTemplate(
  platform: NodeJS.Platform,
  options: AppMenuOptions = {},
): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null
  const act = (action: MenuAction['action'], dir?: string) => () => {
    options.onAction?.(dir === undefined ? { action } : { action, dir })
  }
  const recent = (options.recent ?? []).slice(0, RECENT_IN_MENU)
  return [
    {
      label: APP_TITLE,
      submenu: [
        { role: 'about', label: `關於 ${APP_TITLE}` },
        { type: 'separator' },
        { role: 'hide', label: `隱藏 ${APP_TITLE}` },
        { role: 'hideOthers', label: '隱藏其他' },
        { role: 'unhide', label: '全部顯示' },
        { type: 'separator' },
        { role: 'quit', label: `結束 ${APP_TITLE}` },
      ],
    },
    {
      label: '檔案',
      submenu: [
        { label: '新專案…', accelerator: 'CmdOrCtrl+N', click: act('new') },
        { label: '開啟舊專案…', accelerator: 'CmdOrCtrl+O', click: act('open') },
        {
          label: '開啟最近的專案',
          enabled: recent.length > 0,
          submenu: recent.map((project) => ({
            label: project.name,
            click: act('openRecent', project.dir),
          })),
        },
        { type: 'separator' },
        // 專案是自動儲存的：「儲存」只是告訴你最後一次存在幾點（跟專案列的 ⌘S 同一句）
        { label: '儲存', accelerator: 'CmdOrCtrl+S', click: act('save') },
        { label: '另存為…', accelerator: 'Shift+CmdOrCtrl+S', click: act('saveAs') },
        { label: '改名…', click: act('rename') },
        { label: '在 Finder 顯示', click: act('reveal') },
        { type: 'separator' },
        { label: '首頁', click: act('home') },
      ],
    },
    {
      label: '編輯',
      submenu: [
        { role: 'undo', label: '復原' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪下' },
        { role: 'copy', label: '拷貝' },
        { role: 'paste', label: '貼上' },
        { role: 'selectAll', label: '全選' },
      ],
    },
    {
      label: '視窗',
      submenu: [
        { role: 'minimize', label: '縮到 Dock' },
        { role: 'zoom', label: '縮放' },
        { role: 'togglefullscreen', label: '全螢幕' },
        { type: 'separator' },
        { role: 'close', label: '關閉視窗' },
      ],
    },
  ]
}
