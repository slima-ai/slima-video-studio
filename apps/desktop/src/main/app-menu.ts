import type { MenuItemConstructorOptions } from 'electron'

import { APP_TITLE } from './window'

/**
 * 視窗上方的選單：Windows／Linux 不放選單列（預設的是英文的 File、Edit、View、Window，
 * 而且裡面的東西 App 用不到）；macOS 一定要有選單，Cmd+C／V／Z 這些才會在輸入框裡生效，所以放中文的精簡選單。
 * 回傳 null 代表不要選單。
 */
export function appMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null
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
