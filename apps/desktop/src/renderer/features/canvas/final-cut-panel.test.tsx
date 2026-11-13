import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { FinalCutPanel } from './final-cut-panel'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(cleanup)

const TRAILER = (filmSec: number | undefined) => ({
  exists: true,
  settings: { targetSec: 30 },
  targetSec: 30,
  scriptSec: 30,
  beatCount: 9,
  matches: true,
  errors: [],
  warnings: [],
  ...(filmSec === undefined ? {} : { filmSec }),
})

describe('FinalCutPanel：預告片的成品長度', () => {
  it('預告片專案：對得上目標就只寫「成品 30 秒」；差超過一格才多寫目標、用警示色', async () => {
    installFakeSvs({ 'trailer.status': () => TRAILER(30) })
    const first = render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    const line = await screen.findByTestId('final-cut-length')
    expect(line.textContent).toBe('成品 30 秒')
    expect(line.className).not.toContain('text-warning')
    first.unmount()

    installFakeSvs({ 'trailer.status': () => TRAILER(31.5) })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    const off = await screen.findByTestId('final-cut-length')
    expect(off.textContent).toBe('成品 31.5 秒（目標 30 秒）')
    expect(off.className).toContain('text-warning')
  })

  it('一般專案、或還沒接過成品：不顯示這一行', async () => {
    installFakeSvs()
    const first = render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-panel')).toBeTruthy()
    })
    expect(screen.queryByTestId('final-cut-length')).toBeNull()
    first.unmount()
    installFakeSvs({ 'trailer.status': () => TRAILER(undefined) })
    render(<FinalCutPanel finalVideoHash={undefined} canRejoin={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('final-cut-length')).toBeNull()
  })
})

describe('FinalCutPanel：預告片專案的標註併進片名卡', () => {
  it('預告片專案：勾選寫「片名卡標註 AI 服務（建議）」，沒有「多 3 秒」的說明；一般專案維持「片尾 AI 服務標註」', async () => {
    installFakeSvs({ 'trailer.status': () => TRAILER(30) })
    const first = render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await screen.findByTestId('final-cut-length')
    const label = screen.getByTestId('final-cut-credits').closest('label')
    expect(label?.textContent).toBe('片名卡標註 AI 服務（建議）')
    expect(label?.getAttribute('title')).toBeNull()
    first.unmount()

    installFakeSvs()
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-credits').closest('label')?.textContent).toBe(
        '片尾 AI 服務標註',
      )
    })
  })

  it('預告片專案要了標註但沒加成功：說「標註沒有加成功」，不是「片尾字卡」', async () => {
    installFakeSvs({
      'trailer.status': () => TRAILER(30),
      'quickstart.export': () => ({ path: '/p/exports/短片.mp4', credits: false }),
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await screen.findByTestId('final-cut-length')
    fireEvent.click(screen.getByTestId('final-cut-export'))
    await waitFor(() => {
      expect(screen.getByTestId('final-cut-exported').textContent).toContain('標註沒有加成功')
    })
    expect(screen.getByTestId('final-cut-exported').textContent).not.toContain('字卡')
  })
})

describe('FinalCutPanel：匯出的片尾字卡', () => {
  it('預設勾著「片尾 AI 服務標註」，匯出時帶 credits: true', async () => {
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

  it('以前匯出過：面板一打開不寫「最近一次匯出」（只在剛匯出完才顯示路徑）', async () => {
    installFakeSvs({
      'files.list': () => ({
        files: [],
        exports: [
          {
            name: '短片-新.mp4',
            path: '/p/exports/短片-新.mp4',
            bytes: 10,
            modifiedAt: '2026-10-20T08:00:00.000Z',
          },
        ],
        totalBytes: 10,
      }),
    })
    render(<FinalCutPanel finalVideoHash={'a'.repeat(64)} canRejoin={false} />)
    await screen.findByTestId('final-cut-export')
    expect(screen.queryByTestId('final-cut-last-export')).toBeNull()
    expect(screen.queryByText(/最近一次匯出/)).toBeNull()
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
