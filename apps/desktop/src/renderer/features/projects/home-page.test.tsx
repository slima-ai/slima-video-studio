import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { HomePage } from './home-page'

afterEach(cleanup)

const at = (hour: number): string => new Date(2026, 9, 20, hour, 0, 0).toISOString()
const row = (name: string, extra: { current?: boolean; missing?: boolean } = {}) => ({
  dir: `/p/${name}.svsproj`,
  name,
  lastOpenedAt: at(10),
  updatedAt: extra.missing ? null : at(11),
  current: extra.current ?? false,
  missing: extra.missing ?? false,
})
const info = (name: string) => ({
  id: 'p1',
  name,
  dir: `/p/${name}.svsproj`,
  aspectRatio: '16:9' as const,
})

describe('HomePage：新專案、開啟舊專案、最近的專案', () => {
  it('三件事一眼看到：新專案、開啟舊專案…、最近的專案；還沒有專案時說明、也可以直接進畫布', async () => {
    const go = vi.fn()
    installFakeSvs({ 'project.recent': () => ({ projects: [] }) })
    render(<HomePage onNavigate={go} />)
    expect(screen.getByTestId('home-new')).toBeTruthy()
    expect(screen.getByTestId('home-open')).toBeTruthy()
    expect(await screen.findByTestId('home-recent-empty')).toBeTruthy()
    expect(screen.queryByTestId('home-current')).toBeNull()
    fireEvent.click(screen.getByTestId('home-skip'))
    expect(go).toHaveBeenCalledWith('canvas')
  })

  it('新專案：跳出問名字的視窗，建好進畫布', async () => {
    const go = vi.fn()
    const fake = installFakeSvs({
      'project.recent': () => ({ projects: [] }),
      'project.list': () => ({ folder: '/p', projects: [] }),
      'project.createAt': (payload: { name: string }) => info(payload.name),
    })
    render(<HomePage onNavigate={go} />)
    fireEvent.click(screen.getByTestId('home-new'))
    expect(await screen.findByTestId('new-project-dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('new-project-create'))
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })
    expect(fake.payloadsOf('project.createAt')).toEqual([{ name: '我的短片' }])
  })

  it('最近的專案：現在開著的另外標出來；點「打開」進畫布', async () => {
    const go = vi.fn()
    const fake = installFakeSvs({
      'project.recent': () => ({
        projects: [row('貓', { current: true }), row('狗'), row('鳥')],
      }),
      'project.openRecent': (payload: { dir: string }) => info(payload.dir),
    })
    render(<HomePage onNavigate={go} />)
    expect((await screen.findByTestId('home-current')).textContent).toContain('貓')
    const items = await screen.findAllByTestId('home-recent')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('狗'),
      expect.stringContaining('鳥'),
    ])
    const [firstOpen] = screen.getAllByTestId('home-recent-open')
    if (!firstOpen) throw new Error('沒有打開鈕')
    fireEvent.click(firstOpen)
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })
    expect(fake.payloadsOf('project.openRecent')).toEqual([{ dir: '/p/狗.svsproj' }])
  })

  it('找不到的專案：標「找不到」、不能打開、可以從清單移除，清單重新讀', async () => {
    let projects = [row('還在'), row('搬走了', { missing: true })]
    const fake = installFakeSvs({
      'project.recent': () => ({ projects }),
      'project.forgetRecent': () => {
        projects = projects.filter((p) => !p.missing)
        return {}
      },
    })
    render(<HomePage onNavigate={vi.fn()} />)
    const items = await screen.findAllByTestId('home-recent')
    const gone = items.find((item) => item.getAttribute('data-missing') === 'true')
    expect(gone?.textContent).toContain('找不到')
    expect(gone?.querySelector('[data-testid=home-recent-open]')).toBeNull()
    fireEvent.click(screen.getByTestId('home-forget'))
    await waitFor(() => {
      expect(screen.getAllByTestId('home-recent')).toHaveLength(1)
    })
    expect(fake.payloadsOf('project.forgetRecent')).toEqual([{ dir: '/p/搬走了.svsproj' }])
  })

  it('開啟舊專案…：選到進畫布；取消留在首頁；選錯顯示原因', async () => {
    const go = vi.fn()
    let picked: ReturnType<typeof info> | null = null
    let fail = false
    installFakeSvs({
      'project.recent': () => ({ projects: [] }),
      'project.pickAndOpen': () => {
        if (fail) throw appError('這個資料夾不是 Slima Video Studio 的專案。')
        return picked
      },
    })
    render(<HomePage onNavigate={go} />)
    await screen.findByTestId('home-recent-empty')

    fireEvent.click(screen.getByTestId('home-open'))
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('home-open').disabled).toBe(false)
    })
    expect(go).not.toHaveBeenCalled()

    fail = true
    fireEvent.click(screen.getByTestId('home-open'))
    expect((await screen.findByTestId('home-error')).textContent).toBe(
      '這個資料夾不是 Slima Video Studio 的專案。',
    )

    fail = false
    picked = info('舊的')
    fireEvent.click(screen.getByTestId('home-open'))
    await waitFor(() => {
      expect(go).toHaveBeenCalledWith('canvas')
    })
  })
})
