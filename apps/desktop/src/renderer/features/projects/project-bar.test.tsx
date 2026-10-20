import type { ProjectStatus } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('沒有專案：寫「未命名專案」，不能改名，沒有存檔狀態也沒有花費', async () => {
    const fake = installFakeSvs({ 'project.status': () => null })
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    await waitFor(() => {
      expect(fake.payloadsOf('project.status')).toHaveLength(1)
    })
    const name = screen.getByTestId('project-name')
    expect(name.textContent).toBe('未命名專案')
    expect((name as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('save-status')).toBeNull()
    expect(screen.queryByTestId('spent')).toBeNull()
  })

  it('狀態問不到也不壞：照樣畫出這一列', () => {
    installFakeSvs()
    render(<ProjectBar onNavigate={vi.fn()} demoMode />)
    expect(screen.getByTestId('project-bar')).toBeTruthy()
    expect(screen.getByTestId('project-name').textContent).toBe('未命名專案')
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
})
