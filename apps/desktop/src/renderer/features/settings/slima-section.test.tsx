import type { SlimaStatus } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { SlimaSection } from './slima-section'

afterEach(cleanup)

const READY: SlimaStatus = { state: 'ready', toolCount: 9, last4: 'abcd' }

describe('SlimaSection', () => {
  it('還沒連線：顯示「尚未連線」，沒有輸入前不能按連線，也沒有中斷按鈕', async () => {
    installFakeSvs()
    render(<SlimaSection storageAvailable />)
    await waitFor(() => {
      expect(screen.getByTestId('slima-status').textContent).toBe('尚未連線')
    })
    expect(screen.getByTestId('slima-token').getAttribute('type')).toBe('password')
    expect(screen.getByTestId('slima-connect').hasAttribute('disabled')).toBe(true)
    expect(screen.queryByTestId('slima-disconnect')).toBeNull()
  })

  it('貼上 Token 連線：送到主行程、清空輸入框；連上後列出書名與類型', async () => {
    const svs = installFakeSvs({
      'slima.connect': () => READY,
      'slima.books': () => ({
        books: [
          { token: 'bk_1', title: '雨夜的貓', kind: 'writing', author: '小林', words: 12345 },
          { token: 'bk_2', title: '鐵與花', kind: 'script', words: 3200 },
        ],
      }),
    })
    render(<SlimaSection storageAvailable />)
    await screen.findByTestId('slima-status')
    fireEvent.change(screen.getByTestId('slima-token'), { target: { value: 'slima_token_123456' } })
    fireEvent.click(screen.getByTestId('slima-connect'))
    await waitFor(() => {
      expect(svs.payloadsOf('slima.connect')).toEqual([{ token: 'slima_token_123456' }])
    })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('slima-token').value).toBe('')
    })

    act(() => {
      svs.emit('slima.status', READY)
    })
    expect(screen.getByTestId('slima-status').textContent).toBe('已連線（Token 結尾 abcd）')
    const books = await screen.findAllByTestId('slima-book')
    expect(books.map((b) => b.textContent)).toEqual([
      '雨夜的貓小說・12,345 字',
      '鐵與花劇本・3,200 字',
    ])
  })

  it('Token 無效：顯示原因；出現在事件裡的錯誤狀態也會更新；可以中斷連線', async () => {
    const svs = installFakeSvs({
      'slima.status': () => ({ state: 'error', message: 'Slima 不接受這組 Token' }),
      'slima.disconnect': () => ({ state: 'no_token' }),
    })
    render(<SlimaSection storageAvailable />)
    await waitFor(() => {
      expect(screen.getByTestId('slima-status').textContent).toBe('Slima 不接受這組 Token')
    })
    expect(screen.queryByTestId('slima-books')).toBeNull()

    fireEvent.click(screen.getByTestId('slima-disconnect'))
    await waitFor(() => {
      expect(svs.payloadsOf('slima.disconnect')).toHaveLength(1)
    })
    act(() => {
      svs.emit('slima.status', { state: 'no_token' })
    })
    expect(screen.getByTestId('slima-status').textContent).toBe('尚未連線')
    expect(screen.queryByTestId('slima-disconnect')).toBeNull()
  })

  it('連線失敗（例如 Token 格式不對）顯示錯誤；金鑰庫不能用時整個輸入區停用', async () => {
    installFakeSvs({
      'slima.connect': () => {
        throw appError('API Key 格式不正確')
      },
    })
    render(<SlimaSection storageAvailable />)
    await screen.findByTestId('slima-status')
    fireEvent.change(screen.getByTestId('slima-token'), { target: { value: 'bad token' } })
    fireEvent.click(screen.getByTestId('slima-connect'))
    expect((await screen.findByRole('alert')).textContent).toContain('格式不正確')
    cleanup()

    installFakeSvs()
    render(<SlimaSection storageAvailable={false} />)
    expect(screen.getByTestId('slima-token').hasAttribute('disabled')).toBe(true)
  })
})
