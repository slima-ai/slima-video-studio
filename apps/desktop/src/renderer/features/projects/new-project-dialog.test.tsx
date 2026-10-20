import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { NewProjectDialog } from './new-project-dialog'

afterEach(cleanup)

const created = (name: string, dir = '/p/new.svsproj') => ({
  id: 'p1',
  name,
  dir,
  aspectRatio: '16:9' as const,
})

const library = () => ({ folder: '/Users/me/文件/Slima Video Studio', projects: [] })

describe('NewProjectDialog：新專案只問名字', () => {
  it('名字預設「我的短片」並已選取；顯示存在哪；Enter 就建，沒指定位置就不送 parentDir', async () => {
    const onCreated = vi.fn()
    const fake = installFakeSvs({
      'project.list': library,
      'project.createAt': (payload: { name: string }) => created(payload.name),
    })
    render(<NewProjectDialog onClose={vi.fn()} onCreated={onCreated} />)
    const input = screen.getByTestId<HTMLInputElement>('new-project-name')
    expect(input.value).toBe('我的短片')
    expect(await screen.findByText('存在：/Users/me/文件/Slima Video Studio')).toBeTruthy()

    fireEvent.change(input, { target: { value: '  貓的故事  ' } })
    const form = input.closest('form')
    if (!form) throw new Error('找不到表單')
    fireEvent.submit(form)
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })
    expect(fake.payloadsOf('project.createAt')).toEqual([{ name: '貓的故事' }])
  })

  it('名字空白：不能建', () => {
    const fake = installFakeSvs({ 'project.list': library })
    render(<NewProjectDialog onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: '   ' } })
    const button = screen.getByTestId<HTMLButtonElement>('new-project-create')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(fake.payloadsOf('project.createAt')).toEqual([])
  })

  it('「更改…」選了別的資料夾：顯示新位置，建的時候帶 parentDir；取消選擇就維持原樣', async () => {
    let picked: string | null = '/Volumes/外接/影片'
    const fake = installFakeSvs({
      'project.list': library,
      'project.pickFolder': () => ({ dir: picked }),
      'project.createAt': (payload: { name: string }) => created(payload.name),
    })
    render(<NewProjectDialog onClose={vi.fn()} onCreated={vi.fn()} />)
    await screen.findByText(/存在：\/Users\/me/)
    fireEvent.click(screen.getByTestId('new-project-change-folder'))
    expect(await screen.findByText('存在：/Volumes/外接/影片')).toBeTruthy()

    picked = null
    fireEvent.click(screen.getByTestId('new-project-change-folder'))
    await waitFor(() => {
      expect(fake.payloadsOf('project.pickFolder')).toHaveLength(2)
    })
    expect(screen.getByText('存在：/Volumes/外接/影片')).toBeTruthy()

    fireEvent.click(screen.getByTestId('new-project-create'))
    await waitFor(() => {
      expect(fake.payloadsOf('project.createAt')).toEqual([
        { name: '我的短片', parentDir: '/Volumes/外接/影片' },
      ])
    })
  })

  it('建失敗：顯示原因、視窗還在、可以再試', async () => {
    const onCreated = vi.fn()
    installFakeSvs({
      'project.list': library,
      'project.createAt': () => {
        throw appError('找不到這個資料夾，請重新選一個存放的位置。')
      },
    })
    render(<NewProjectDialog onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.click(screen.getByTestId('new-project-create'))
    expect((await screen.findByTestId('new-project-error')).textContent).toBe(
      '找不到這個資料夾，請重新選一個存放的位置。',
    )
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.getByTestId<HTMLButtonElement>('new-project-create').disabled).toBe(false)
  })

  it('取消：關掉，不建', () => {
    const onClose = vi.fn()
    const fake = installFakeSvs({ 'project.list': library })
    render(<NewProjectDialog onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(fake.payloadsOf('project.createAt')).toEqual([])
  })

  it('另存為模式：說明複製的是什麼、名字用給的預設、送 project.saveAs（有選位置才帶 parentDir）', async () => {
    const onCreated = vi.fn()
    const fake = installFakeSvs({
      'project.list': library,
      'project.pickFolder': () => ({ dir: '/Volumes/外接' }),
      'project.saveAs': (payload: { name: string }) => created(payload.name),
    })
    render(
      <NewProjectDialog
        mode="saveAs"
        initialName="貓 副本"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    )
    expect(screen.getByTestId('save-as-dialog')).toBeTruthy()
    expect(screen.getByText(/連同圖片、影片/)).toBeTruthy()
    expect(screen.getByTestId<HTMLInputElement>('new-project-name').value).toBe('貓 副本')
    fireEvent.click(screen.getByTestId('new-project-change-folder'))
    await screen.findByText('存在：/Volumes/外接')
    fireEvent.click(screen.getByRole('button', { name: '另存' }))
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })
    expect(fake.payloadsOf('project.saveAs')).toEqual([
      { name: '貓 副本', parentDir: '/Volumes/外接' },
    ])
    expect(fake.payloadsOf('project.createAt')).toEqual([])
  })
})
