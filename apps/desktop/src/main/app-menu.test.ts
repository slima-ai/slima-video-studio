import { describe, expect, it } from 'vitest'

import { appMenuTemplate } from './app-menu'

describe('視窗上方的選單', () => {
  it('Windows 與 Linux 不放選單列（不會出現英文的 File、Edit、View、Window）', () => {
    expect(appMenuTemplate('win32')).toBeNull()
    expect(appMenuTemplate('linux')).toBeNull()
  })

  it('macOS 是中文的精簡選單，保留「編輯」讓輸入框的 Cmd+C／V／Z 能用', () => {
    const menu = appMenuTemplate('darwin') ?? []
    expect(menu.map((m) => m.label)).toEqual(['Slima Video Studio', '編輯', '視窗'])
    const labels = JSON.stringify(menu)
    expect(labels).not.toMatch(/"label":"(File|Edit|View|Window)"/)
    const edit = menu[1]?.submenu
    expect(Array.isArray(edit) ? edit.map((i) => i.role) : []).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
    )
  })
})
