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

  it('還沒有成品時不顯示這個勾選', () => {
    installFakeSvs()
    render(<FinalCutPanel finalVideoHash={undefined} canRejoin={false} />)
    expect(screen.queryByTestId('final-cut-credits')).toBeNull()
  })
})
