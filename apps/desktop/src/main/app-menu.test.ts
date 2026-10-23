import type { MenuItemConstructorOptions } from 'electron'
import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { appMenuTemplate } from './app-menu'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe('視窗上方的選單：英文', () => {
  it('語言是英文就整份選單都是英文，結構和中文一樣（同樣四個選單、同樣的快捷鍵）', () => {
    setLocale('en')
    const menu = appMenuTemplate('darwin') ?? []
    expect(menu.map((m) => m.label)).toEqual(['Slima Video Studio', 'File', 'Edit', 'Window'])
    const file = (menu[1]?.submenu ?? []) as MenuItemConstructorOptions[]
    expect(file.find((item) => item.label === 'New Project…')?.accelerator).toBe('CmdOrCtrl+N')
    expect(file.find((item) => item.label === 'Save As…')?.accelerator).toBe('Shift+CmdOrCtrl+S')
    expect(JSON.stringify(menu)).not.toMatch(/[\u3400-\u9fff]/)
    // 切回中文，下次建的選單就是中文
    setLocale('zh-TW')
    expect((appMenuTemplate('darwin') ?? []).map((m) => m.label)[1]).toBe('檔案')
  })
})

describe('視窗上方的選單', () => {
  it('Windows 與 Linux 不放選單列（不會出現英文的 File、Edit、View、Window）', () => {
    expect(appMenuTemplate('win32')).toBeNull()
    expect(appMenuTemplate('linux')).toBeNull()
  })

  it('macOS 是中文的精簡選單，保留「編輯」讓輸入框的 Cmd+C／V／Z 能用', () => {
    const menu = appMenuTemplate('darwin') ?? []
    expect(menu.map((m) => m.label)).toEqual(['Slima Video Studio', '檔案', '編輯', '視窗'])
    const labels = JSON.stringify(menu)
    expect(labels).not.toMatch(/"label":"(File|Edit|View|Window)"/)
    const edit = menu[2]?.submenu
    expect(Array.isArray(edit) ? edit.map((i) => i.role) : []).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
    )
  })

  it('「檔案」：新專案、開啟舊專案、最近的專案、儲存、另存為、改名、在 Finder 顯示、首頁，各自的快捷鍵', () => {
    const file = (appMenuTemplate('darwin')?.[1]?.submenu ?? []) as MenuItemConstructorOptions[]
    const byLabel = (label: string) => file.find((item) => item.label === label)
    expect(byLabel('新專案…')?.accelerator).toBe('CmdOrCtrl+N')
    expect(byLabel('開啟舊專案…')?.accelerator).toBe('CmdOrCtrl+O')
    expect(byLabel('儲存')?.accelerator).toBe('CmdOrCtrl+S')
    expect(byLabel('另存為…')?.accelerator).toBe('Shift+CmdOrCtrl+S')
    expect(byLabel('改名…')).toBeTruthy()
    expect(byLabel('在 Finder 顯示')).toBeTruthy()
    expect(byLabel('首頁')).toBeTruthy()
    // 沒有最近的專案：子選單灰掉
    expect(byLabel('開啟最近的專案')?.enabled).toBe(false)
  })

  it('選了「檔案」的項目：把動作交給 onAction；最近的專案帶著路徑、最多列 5 個', () => {
    const actions: unknown[] = []
    const recent = Array.from({ length: 7 }, (_, i) => ({
      name: `專案${String(i)}`,
      dir: `/p/${String(i)}.svsproj`,
    }))
    const menu = appMenuTemplate('darwin', { onAction: (a) => actions.push(a), recent }) ?? []
    const file = (menu[1]?.submenu ?? []) as MenuItemConstructorOptions[]
    const run = (label: string): void => {
      const item = file.find((i) => i.label === label)
      ;(item?.click as (() => void) | undefined)?.()
    }
    for (const label of [
      '新專案…',
      '開啟舊專案…',
      '儲存',
      '另存為…',
      '改名…',
      '在 Finder 顯示',
      '首頁',
    ]) {
      run(label)
    }
    expect(actions).toEqual([
      { action: 'new' },
      { action: 'open' },
      { action: 'save' },
      { action: 'saveAs' },
      { action: 'rename' },
      { action: 'reveal' },
      { action: 'home' },
    ])
    const sub = file.find((i) => i.label === '開啟最近的專案')
    expect(sub?.enabled).toBe(true)
    const items = (sub?.submenu ?? []) as MenuItemConstructorOptions[]
    expect(items.map((i) => i.label)).toEqual(['專案0', '專案1', '專案2', '專案3', '專案4'])
    actions.length = 0
    ;(items[2]?.click as () => void)()
    expect(actions).toEqual([{ action: 'openRecent', dir: '/p/2.svsproj' }])
  })
})
