import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { FinalCutPanel } from './final-cut-panel'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(cleanup)

describe('FinalCutPanel：匯出的片尾字卡', () => {
  it('預設勾著「片尾加上 AI 服務標註（建議）」，匯出時帶 credits: true', async () => {
    const calls: unknown[] = []
    installFakeSvs({
      'quickstart.export': (p: unknown) => {
        calls.push(p)
        return { path: '/p/exports/短片.mp4', credits: true }
      },
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    expect(screen.getByTestId<HTMLInputElement>('final-cut-credits').checked).toBe(true)
    fireEvent.click(screen.getByTestId('final-cut-export'))
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-exported').textContent).toContain('已匯出到')
    })
    expect(calls).toEqual([{ credits: true }])
    expect(screen.getByTestId('final-cut-exported').textContent).not.toContain('字卡')
  })

  it('取消勾選會記住（下次還是取消），匯出就帶 credits: false', async () => {
    const calls: unknown[] = []
    installFakeSvs({
      'quickstart.export': (p: unknown) => {
        calls.push(p)
        return { path: '/p/exports/短片.mp4', credits: false }
      },
    })
    const first = render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    fireEvent.click(screen.getByTestId('final-cut-credits'))
    fireEvent.click(screen.getByTestId('final-cut-export'))
    await waitFor(() => {
      expect(calls).toEqual([{ credits: false }])
    })
    // 沒要字卡，所以沒有「字卡沒加成功」的說明
    expect(screen.getByTestId('final-cut-exported').textContent).not.toContain('字卡')
    first.unmount()
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    expect(screen.getByTestId<HTMLInputElement>('final-cut-credits').checked).toBe(false)
  })

  it('要了字卡但沒加成功：匯出完成並說明匯出的是沒有字卡的版本', async () => {
    installFakeSvs({
      'quickstart.export': () => ({ path: '/p/exports/短片.mp4', credits: false }),
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    fireEvent.click(screen.getByTestId('final-cut-export'))
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-exported').textContent).toContain(
        '片尾字卡沒有加成功，匯出的是沒有字卡的版本',
      )
    })
  })

  it('以前匯出過：面板一打開就寫「最近一次匯出：檔名」，附「在資料夾顯示」，按下去帶檔名', async () => {
    const svs = installFakeSvs({
      'files.list': () => ({
        files: [],
        exports: [
          {
            name: '短片-新.mp4',
            path: '/p/exports/短片-新.mp4',
            bytes: 10,
            modifiedAt: '2026-10-20T08:00:00.000Z',
          },
          {
            name: '短片-舊.mp4',
            path: '/p/exports/短片-舊.mp4',
            bytes: 10,
            modifiedAt: '2026-10-19T08:00:00.000Z',
          },
        ],
        totalBytes: 20,
      }),
      'files.reveal': () => ({}),
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-last-export').textContent).toContain(
        '最近一次匯出：短片-新.mp4',
      )
    })
    fireEvent.click(screen.getByTestId('final-cut-reveal'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.reveal')).toEqual([{ exportName: '短片-新.mp4' }])
    })
  })

  it('沒匯出過就不顯示；剛匯出完顯示完整路徑，也能在資料夾顯示', async () => {
    const svs = installFakeSvs({
      'quickstart.export': () => ({ path: '/p/exports/短片.mp4', credits: true }),
      'files.reveal': () => ({}),
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    expect(screen.queryByTestId('final-cut-last-export')).toBeNull()
    fireEvent.click(screen.getByTestId('final-cut-export'))
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-exported').textContent).toBe(
        '已匯出到 /p/exports/短片.mp4',
      )
    })
    fireEvent.click(screen.getByTestId('final-cut-reveal'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.reveal')).toEqual([{ exportName: '短片.mp4' }])
    })
  })

  it('還沒有成品時不顯示這個勾選', () => {
    installFakeSvs()
    render(<FinalCutPanel finalVideoHash={undefined} canRejoin={false} />)
    expect(screen.queryByTestId('final-cut-credits')).toBeNull()
  })
})
