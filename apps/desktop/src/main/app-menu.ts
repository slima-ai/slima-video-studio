import type { MenuAction } from '@svs/schema'
import type { MenuItemConstructorOptions } from 'electron'

import { APP_TITLE } from './window'
import { t } from '@svs/schema'

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
        { role: 'about', label: t('menu.about', { appTitle: APP_TITLE }) },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide', { appTitle: APP_TITLE }) },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit', { appTitle: APP_TITLE }) },
      ],
    },
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newProject'), accelerator: 'CmdOrCtrl+N', click: act('new') },
        { label: t('menu.openProject'), accelerator: 'CmdOrCtrl+O', click: act('open') },
        {
          label: t('menu.openRecent'),
          enabled: recent.length > 0,
          submenu: recent.map((project) => ({
            label: project.name,
            click: act('openRecent', project.dir),
          })),
        },
        { type: 'separator' },
        // 專案是自動儲存的：「儲存」只是告訴你最後一次存在幾點（跟專案列的 ⌘S 同一句）
        { label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: act('save') },
        { label: t('menu.saveAs'), accelerator: 'Shift+CmdOrCtrl+S', click: act('saveAs') },
        { label: t('menu.rename'), click: act('rename') },
        { label: t('menu.showInFinder'), click: act('reveal') },
        { type: 'separator' },
        { label: t('menu.home'), click: act('home') },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        { role: 'togglefullscreen', label: t('menu.enterFullScreen') },
        { type: 'separator' },
        { role: 'close', label: t('menu.closeWindow') },
      ],
    },
  ]
}
