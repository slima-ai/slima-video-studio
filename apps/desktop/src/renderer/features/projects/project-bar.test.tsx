import type { ProjectStatus } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { appError, installFakeSvs } from '../../test/fake-svs'
import { ProjectBar } from './project-bar'

afterEach(cleanup)

const at = (hour: number, minute: number): string =>
  new Date(2026, 9, 20, hour, minute, 30).toISOString()

const status = (extra: Partial<ProjectStatus> = {}): ProjectStatus => ({
  name: '貓的故事',
  dir: '/tmp/cat.svsproj',
  savedAt: at(12, 3),
  spentUsd: 0,
  ...extra,
})

const summary = (name: string, extra: { current?: boolean; missing?: boolean } = {}) => ({
  dir: `/tmp/${name}.svsproj`,
  name,
  lastOpenedAt: at(10, 0),
  updatedAt: at(10, 0),
  current: extra.current ?? false,
  missing: extra.missing ?? false,
})

describe('ProjectBar：每頁最上面的專案列', () => {
  it('有專案：名字、已自動儲存的時間、已花；沒有儲存鈕', async () => {
    installFakeSvs({ 'project.status': () => status({ spentUsd: 1.234 }) })
    render(<ProjectBar onNavigate={vi.fn()} demoMode={false} hasKey />)
    expect((await screen.findByTestId('project-name')).textContent).toBe('貓的故事')
    expect(screen.getByTestId('save-status').textContent).toBe('已自動儲存・12:03')
    expect(screen.getByTestId('spent').textContent).toBe('已花 US$1.23')
    expect(screen.queryByRole('button', { name: /儲存/ })).toBeNull()
  })

  it('沒有專案：寫「還沒有專案」（不是「未命名專案」），不能改名，沒有存檔狀態也沒有花費', async () => {
    const fake = installFakeSvs({ 'project.status': () => null })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    await waitFor(() => {
      expect(fake.payloadsOf('project.status')).toHaveLength(1)
    })
    const name = screen.getByTestId('project-name')
    expect(name.textContent).toBe('還沒有專案')
    expect((name as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('save-status')).toBeNull()
    expect(screen.queryByTestId('spent')).toBeNull()
  })

  it('狀態問不到也不壞：照樣畫出這一列', () => {
    installFakeSvs()
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    expect(screen.getByTestId('project-bar')).toBeTruthy()
    expect(screen.getByTestId('project-name').textContent).toBe('還沒有專案')
  })

  it('專案有動靜（事件）就重新問，存檔時間跟著更新', async () => {
    let saved = at(12, 3)
    const fake = installFakeSvs({ 'project.status': () => status({ savedAt: saved }) })
    render(<ProjectBar onNavigate={vi.fn()} demoMode={false} hasKey />)
    await screen.findByText('已自動儲存・12:03')
    saved = at(12, 9)
    act(() => {
      fake.emit('canvas.changed', {})
      fake.emit('history.changed', {})
    })
    expect(await screen.findByText('已自動儲存・12:09')).toBeTruthy()
    // 兩個事件擠在一起，只多問一次
    expect(fake.payloadsOf('project.status')).toHaveLength(2)
  })

  it('模式徽章：示範模式／真的 AI／真的 AI 但還沒填金鑰；點了到設定', () => {
    installFakeSvs({ 'project.status': () => status() })
    const go = vi.fn()
    const { rerender } = render(<ProjectBar onNavigate={go} demoMode />)
    expect(screen.getByTestId('mode-badge').textContent).toBe('示範模式・不花錢')
    rerender(<ProjectBar onNavigate={go} demoMode={false} hasKey />)
    expect(screen.getByTestId('mode-badge').textContent).toBe('真的 AI')
    rerender(<ProjectBar onNavigate={go} demoMode={false} hasKey={false} />)
    expect(screen.getByTestId('mode-badge').textContent).toBe('真的 AI・還沒填金鑰')
    fireEvent.click(screen.getByTestId('mode-badge'))
    expect(go).toHaveBeenCalledWith('settings')
    rerender(<ProjectBar onNavigate={go} />)
    expect(screen.queryByTestId('mode-badge')).toBeNull()
  })

  it('點名字改名：Enter 送出，名字更新；Esc 取消不送；沒改不送', async () => {
    let name = '貓的故事'
    const fake = installFakeSvs({
      'project.status': () => status({ name }),
      'project.rename': (payload: { name: string }) => {
        name = payload.name
        return { id: 'p1', name, dir: '/tmp/cat.svsproj', aspectRatio: '16:9' }
      },
    })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    fireEvent.click(await screen.findByText('貓的故事'))
    let input = screen.getByTestId('project-rename')
    fireEvent.change(input, { target: { value: '放棄的名字' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('project-rename')).toBeNull()
    expect(fake.payloadsOf('project.rename')).toEqual([])

    fireEvent.click(screen.getByTestId('project-name'))
    input = screen.getByTestId('project-rename')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(fake.payloadsOf('project.rename')).toEqual([])

    fireEvent.click(screen.getByTestId('project-name'))
    input = screen.getByTestId('project-rename')
    fireEvent.change(input, { target: { value: '  雨夜的貓  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByTestId('project-name').textContent).toBe('雨夜的貓')
    })
    expect(fake.payloadsOf('project.rename')).toEqual([{ name: '雨夜的貓' }])
  })

  it('改名失敗：顯示原因，名字不變', async () => {
    installFakeSvs({
      'project.status': () => status(),
      'project.rename': () => {
        throw appError('專案是唯讀的。')
      },
    })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    fireEvent.click(await screen.findByText('貓的故事'))
    const input = screen.getByTestId('project-rename')
    fireEvent.change(input, { target: { value: '新名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((await screen.findByTestId('project-bar-error')).textContent).toBe('專案是唯讀的。')
    expect(screen.getByTestId('project-name').textContent).toBe('貓的故事')
  })

  it('專案選單：新專案、最近的專案（不含現在這個）一點就到；全部專案到專案頁', async () => {
    const go = vi.fn()
    const fake = installFakeSvs({
      'project.status': () => status(),
      'project.recent': () => ({
        projects: [
          summary('貓的故事', { current: true }),
          summary('狗的故事'),
          summary('搬走的', { missing: true }),
          summary('鳥的故事'),
        ],
      }),
      'project.createAt': () => ({
        id: 'p2',
        name: '我的短片',
        dir: '/tmp/new.svsproj',
        aspectRatio: '16:9',
      }),
      'project.openRecent': (payload: { dir: string }) => ({
        id: 'p3',
        name: '狗的故事',
        dir: payload.dir,
        aspectRatio: '16:9',
      }),
    })
    render(<ProjectBar onNavigate={go} demoMode />)
    await screen.findByText('貓的故事')

    fireEvent.click(screen.getByTestId('project-menu-button'))
    const recent = await screen.findAllByTestId('menu-recent')
    expect(recent.map((item) => item.textContent)).toEqual(['狗的故事', '鳥的故事'])
    const [first] = recent
    if (!first) throw new Error('最近的專案是空的')
    fireEvent.click(first)
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })
    expect(fake.payloadsOf('project.openRecent')).toEqual([{ dir: '/tmp/狗的故事.svsproj' }])
    expect(screen.queryByTestId('project-menu')).toBeNull()

    // 新專案：先跳出問名字的視窗，建好才回到畫布
    go.mockClear()
    fireEvent.click(screen.getByTestId('project-menu-button'))
    fireEvent.click(await screen.findByTestId('menu-new'))
    expect(await screen.findByTestId('new-project-dialog')).toBeTruthy()
    expect(go).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('new-project-create'))
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })
    expect(fake.payloadsOf('project.createAt')).toEqual([{ name: '我的短片' }])
    expect(screen.queryByTestId('new-project-dialog')).toBeNull()

    go.mockClear()
    fireEvent.click(screen.getByTestId('project-menu-button'))
    fireEvent.click(await screen.findByTestId('menu-all'))
    expect(go).toHaveBeenCalledWith('projects')
  })

  it('專案選單：Esc 收起；沒有專案時沒有「改名」「在資料夾中顯示」', async () => {
    installFakeSvs({
      'project.status': () => null,
      'project.recent': () => ({ projects: [] }),
    })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    fireEvent.click(screen.getByTestId('project-menu-button'))
    const menu = await screen.findByTestId('project-menu')
    expect(screen.queryByTestId('menu-rename')).toBeNull()
    expect(screen.queryByTestId('menu-reveal')).toBeNull()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByTestId('project-menu')).toBeNull()
  })

  it('專案選單：最近的專案不含找不到的；「首頁」回首頁', async () => {
    const go = vi.fn()
    installFakeSvs({
      'project.status': () => status(),
      'project.recent': () => ({
        projects: [summary('貓的故事', { current: true }), summary('搬走的', { missing: true })],
      }),
    })
    render(<ProjectBar onNavigate={go} demoMode />)
    await screen.findByText('貓的故事')
    fireEvent.click(screen.getByTestId('project-menu-button'))
    await screen.findByTestId('project-menu')
    expect(screen.queryByTestId('menu-recent')).toBeNull()
    fireEvent.click(screen.getByTestId('menu-home'))
    expect(go).toHaveBeenCalledWith('home')
  })

  it('專案選單：開啟舊專案…——選到就進畫布；在選資料夾的視窗按取消就留在原地；選錯顯示原因', async () => {
    const go = vi.fn()
    let picked: { id: string; name: string; dir: string; aspectRatio: '16:9' } | null = {
      id: 'p9',
      name: '舊的',
      dir: '/old.svsproj',
      aspectRatio: '16:9',
    }
    let fail = false
    installFakeSvs({
      'project.status': () => status(),
      'project.recent': () => ({ projects: [] }),
      'project.pickAndOpen': () => {
        if (fail) throw appError('這個資料夾不是 Slima Video Studio 的專案。')
        return picked
      },
    })
    render(<ProjectBar onNavigate={go} demoMode />)
    await screen.findByText('貓的故事')
    const open = async (): Promise<void> => {
      fireEvent.click(screen.getByTestId('project-menu-button'))
      fireEvent.click(await screen.findByTestId('menu-open-old'))
    }

    picked = null
    await open()
    await waitFor(() => {
      expect(screen.queryByTestId('project-menu')).toBeNull()
    })
    expect(go).not.toHaveBeenCalled()

    picked = { id: 'p9', name: '舊的', dir: '/old.svsproj', aspectRatio: '16:9' }
    await open()
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })

    go.mockClear()
    fail = true
    await open()
    expect((await screen.findByTestId('project-bar-error')).textContent).toBe(
      '這個資料夾不是 Slima Video Studio 的專案。',
    )
    expect(go).not.toHaveBeenCalled()
  })

  it('⌘S／Ctrl+S：專案自動儲存，跳出「專案會自動儲存，最後一次 12:03」；沒有專案也有說明；不會被當成真的存檔', async () => {
    installFakeSvs({ 'project.status': () => status() })
    const { unmount } = render(
      <ToastProvider>
        <ProjectBar onNavigate={vi.fn()} demoMode />
      </ToastProvider>,
    )
    await screen.findByText('貓的故事')
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect((await screen.findByTestId('toast')).textContent).toContain(
      '專案會自動儲存，最後一次 12:03',
    )
    // Ctrl+S 一樣；Shift+S（另存為的快捷鍵）不是這個提示
    const ctrl = new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(ctrl)
    })
    expect(ctrl.defaultPrevented).toBe(true)
    const shift = new KeyboardEvent('keydown', {
      key: 'S',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(shift)
    })
    expect(shift.defaultPrevented).toBe(false)
    unmount()

    installFakeSvs({ 'project.status': () => null })
    render(
      <ToastProvider>
        <ProjectBar onNavigate={vi.fn()} demoMode />
      </ToastProvider>,
    )
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
    })
    expect((await screen.findByTestId('toast')).textContent).toContain('還沒有專案')
  })

  it('專案選單：另存為…——名字預設「<專案名> 副本」，另存後提示現在開著的是新的這一份', async () => {
    const fake = installFakeSvs({
      'project.status': () => status(),
      'project.recent': () => ({ projects: [] }),
      'project.list': () => ({ folder: '/tmp', projects: [] }),
      'project.saveAs': (payload: { name: string }) => ({
        id: 'p1',
        name: payload.name,
        dir: '/tmp/copy.svsproj',
        aspectRatio: '16:9',
      }),
    })
    render(
      <ToastProvider>
        <ProjectBar onNavigate={vi.fn()} demoMode />
      </ToastProvider>,
    )
    await screen.findByText('貓的故事')
    fireEvent.click(screen.getByTestId('project-menu-button'))
    fireEvent.click(await screen.findByTestId('menu-save-as'))
    expect(await screen.findByTestId('save-as-dialog')).toBeTruthy()
    expect(screen.getByTestId<HTMLInputElement>('new-project-name').value).toBe('貓的故事 副本')
    fireEvent.click(screen.getByTestId('new-project-create'))
    await waitFor(() => {
      expect(fake.payloadsOf('project.saveAs')).toEqual([{ name: '貓的故事 副本' }])
    })
    expect((await screen.findByTestId('toast')).textContent).toContain(
      '已另存為「貓的故事 副本」，現在開著的是這一份。',
    )
    expect(screen.queryByTestId('save-as-dialog')).toBeNull()
  })

  it('沒有專案：選單沒有「另存為…」', async () => {
    installFakeSvs({
      'project.status': () => null,
      'project.recent': () => ({ projects: [] }),
    })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    fireEvent.click(screen.getByTestId('project-menu-button'))
    await screen.findByTestId('project-menu')
    expect(screen.queryByTestId('menu-save-as')).toBeNull()
  })

  describe('視窗上方選單（macOS「檔案」）選的動作', () => {
    const setup = (statusValue: ProjectStatus | null = status()) => {
      const go = vi.fn()
      const fake = installFakeSvs({
        'project.status': () => statusValue,
        'project.list': () => ({ folder: '/tmp', projects: [] }),
        'project.reveal': () => ({}),
        'project.openRecent': (payload: { dir: string }) => ({
          id: 'p3',
          name: '狗的故事',
          dir: payload.dir,
          aspectRatio: '16:9',
        }),
        'project.pickAndOpen': () => ({
          id: 'p9',
          name: '舊的',
          dir: '/old.svsproj',
          aspectRatio: '16:9',
        }),
      })
      render(
        <ToastProvider>
          <ProjectBar onNavigate={go} demoMode />
        </ToastProvider>,
      )
      return { go, fake }
    }
    const pick = (action: string, dir?: string): void => {
      act(() => {
        useMenu(action, dir)
      })
    }
    let useMenu: (action: string, dir?: string) => void = () => undefined

    it('新專案、儲存、改名、首頁、開啟舊專案、最近的專案、在資料夾中顯示、另存為', async () => {
      const { go, fake } = setup()
      useMenu = (action, dir) => {
        fake.emit('menu.action', dir === undefined ? { action } : { action, dir })
      }
      await screen.findByText('貓的故事')

      pick('new')
      expect(await screen.findByTestId('new-project-dialog')).toBeTruthy()
      // 視窗開著時，又選了選單：不會疊出第二個視窗
      pick('saveAs')
      expect(screen.queryByTestId('save-as-dialog')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await waitFor(() => {
        expect(screen.queryByTestId('new-project-dialog')).toBeNull()
      })

      pick('save')
      expect((await screen.findByTestId('toast')).textContent).toContain(
        '專案會自動儲存，最後一次 12:03',
      )

      pick('rename')
      expect(await screen.findByTestId('project-rename')).toBeTruthy()
      fireEvent.keyDown(screen.getByTestId('project-rename'), { key: 'Escape' })

      pick('saveAs')
      expect(await screen.findByTestId('save-as-dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '取消' }))

      pick('home')
      expect(go).toHaveBeenLastCalledWith('home')

      pick('open')
      await waitFor(() => {
        expect(go).toHaveBeenLastCalledWith('canvas')
      })
      go.mockClear()
      pick('openRecent', '/p/狗.svsproj')
      await waitFor(() => {
        expect(fake.payloadsOf('project.openRecent')).toEqual([{ dir: '/p/狗.svsproj' }])
      })
      await waitFor(() => {
        expect(go).toHaveBeenCalledWith('canvas')
      })
      pick('reveal')
      await waitFor(() => {
        expect(fake.payloadsOf('project.reveal')).toEqual([{}])
      })
    })

    it('沒有專案：另存為、改名、在資料夾中顯示都只說「還沒有專案…」，不去呼叫；儲存也說一聲', async () => {
      const { fake } = setup(null)
      useMenu = (action, dir) => {
        fake.emit('menu.action', dir === undefined ? { action } : { action, dir })
      }
      await waitFor(() => {
        expect(fake.payloadsOf('project.status')).toHaveLength(1)
      })
      for (const [action, text] of [
        ['saveAs', '還沒有專案可以另存'],
        ['rename', '還沒有專案可以改名'],
        ['reveal', '還沒有專案可以在資料夾中顯示'],
        ['save', '還沒有專案'],
      ] as const) {
        pick(action)
        expect((await screen.findByTestId('toast')).textContent).toContain(text)
      }
      expect(fake.payloadsOf('project.reveal')).toEqual([])
      expect(screen.queryByTestId('save-as-dialog')).toBeNull()
    })
  })
})
