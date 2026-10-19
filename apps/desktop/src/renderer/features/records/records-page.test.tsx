import type { GenerationRecord, RecordsSnapshot } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { RecordsPage } from './records-page'

afterEach(cleanup)

const HASH = (c: string): string => c.repeat(64)

const record = (extra: Partial<GenerationRecord> = {}): GenerationRecord => ({
  id: 'j1',
  createdAt: '2026-10-12T08:30:00.000Z',
  kind: 'image',
  status: 'succeeded',
  modelId: 'fal/nano-banana-2',
  modelName: 'Nano Banana 2',
  prompt: '貓走進雨裡，日系動畫風格',
  params: ['16:9', '變化 0'],
  durationMs: 3200,
  costUsd: 0.25,
  result: { kind: 'image', hash: HASH('a') },
  target: { type: 'shot', id: 's1', label: '第 1 鏡' },
  canRedo: true,
  ...extra,
})

const snapshot = (records: GenerationRecord[], total = records.length): RecordsSnapshot => ({
  records,
  total,
  totalCostUsd: records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
})

describe('RecordsPage', () => {
  it('沒有紀錄 → 說明怎麼會有紀錄', async () => {
    installFakeSvs()
    render(<RecordsPage onNavigate={vi.fn()} />)
    expect((await screen.findByTestId('records-empty')).textContent).toContain('到畫布寫一句話')
  })

  it('每筆顯示對象、模型、設定、耗時花費與縮圖；總花費在上方', async () => {
    installFakeSvs({
      'records.list': () =>
        snapshot([
          record(),
          record({
            id: 'j2',
            status: 'failed',
            kind: 'video',
            result: undefined,
            costUsd: undefined,
            durationMs: undefined,
            error: '影片模型暫時忙碌',
            canRedo: false,
          }),
        ]),
    })
    render(<RecordsPage onNavigate={vi.fn()} />)
    const rows = await screen.findAllByTestId('record')
    expect(rows).toHaveLength(2)

    const first = rows[0]
    if (!first) throw new Error('沒有第一筆')
    expect(within(first).getByTestId('record-target').textContent).toBe('第 1 鏡')
    expect(within(first).getByText(/Nano Banana 2・16:9・變化 0/)).toBeTruthy()
    expect(within(first).getByTestId('record-usage').textContent).toBe('3.2 秒・約 US$0.25')
    expect(within(first).getByRole('img').getAttribute('src')).toContain(HASH('a'))

    expect(rows[1]?.getAttribute('data-status')).toBe('failed')
    expect(within(rows[1] ?? first).getByRole('alert').textContent).toBe('影片模型暫時忙碌')
    expect(screen.getByTestId('records-summary').textContent).toContain('共 2 筆・花了約 US$0.25')
  })

  it('篩選會帶進查詢', async () => {
    const fake = installFakeSvs()
    render(<RecordsPage onNavigate={vi.fn()} />)
    await screen.findByTestId('records-empty')
    fireEvent.click(screen.getByTestId('records-kind-video'))
    fireEvent.click(screen.getByTestId('records-outcome-failed'))
    expect(screen.getByTestId('records-kind-video').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => {
      expect(fake.payloadsOf('records.list').at(-1)).toEqual({ kind: 'video', outcome: 'failed' })
    })
    expect((await screen.findByTestId('records-empty')).textContent).toBe('沒有符合的紀錄。')
  })

  it('有任務結束或鏡頭有新結果就重新讀取；進行中的更新不會', async () => {
    const fake = installFakeSvs()
    render(<RecordsPage onNavigate={vi.fn()} />)
    await screen.findByTestId('records-empty')
    const base = fake.payloadsOf('records.list').length
    const job = {
      id: 'j9',
      provider: 'fal',
      modelId: 'fal/x',
      kind: 'image' as const,
      attempt: 1,
      maxAttempts: 3,
      createdAt: '2026-10-12T08:30:00.000Z',
      updatedAt: '2026-10-12T08:30:00.000Z',
    }
    act(() => {
      fake.emit('queue.changed', { ...job, status: 'running' })
    })
    expect(fake.payloadsOf('records.list')).toHaveLength(base)
    act(() => {
      fake.emit('queue.changed', { ...job, status: 'succeeded' })
    })
    await waitFor(() => {
      expect(fake.payloadsOf('records.list')).toHaveLength(base + 1)
    })
  })

  it('展開看完整 prompt，可以複製；不能重生的（文字、角色圖）沒有重新生成鈕', async () => {
    installFakeSvs({
      'records.list': () => snapshot([record({ canRedo: false, target: undefined })]),
    })
    render(<RecordsPage onNavigate={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('record-toggle'))
    expect(screen.getByTestId<HTMLTextAreaElement>('record-draft').value).toBe(
      '貓走進雨裡，日系動畫風格',
    )
    expect(screen.getByTestId('record-copy')).toBeTruthy()
    expect(screen.queryByTestId('record-redo')).toBeNull()
  })

  it('用同一段 prompt 再生成：先確認，確認後才送出，沒改就不帶 prompt', async () => {
    const fake = installFakeSvs({
      'records.list': () => snapshot([record()]),
      'records.redo': () => ({ shotId: 's1' }),
    })
    const navigate = vi.fn()
    render(<RecordsPage onNavigate={navigate} />)
    fireEvent.click(await screen.findByTestId('record-toggle'))
    fireEvent.click(screen.getByTestId('record-redo'))
    expect(fake.payloadsOf('records.redo')).toHaveLength(0)
    expect(screen.getByTestId('record-confirm-note').textContent).toContain('US$0.25')
    fireEvent.click(screen.getByTestId('record-redo-confirm'))

    expect((await screen.findByTestId('records-notice')).textContent).toContain(
      '已開始重新生成第 1 鏡',
    )
    expect(fake.payloadsOf('records.redo')).toEqual([{ jobId: 'j1' }])
    fireEvent.click(screen.getByTestId('records-go-storyboard'))
    expect(navigate).toHaveBeenCalledWith('storyboard')
  })

  it('改過 prompt 再生成：帶改過的內容；按鈕文字跟著變', async () => {
    const fake = installFakeSvs({
      'records.list': () => snapshot([record()]),
      'records.redo': () => ({ shotId: 's1' }),
    })
    render(<RecordsPage onNavigate={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('record-toggle'))
    fireEvent.change(screen.getByTestId('record-draft'), { target: { value: '貓在屋頂上，夕陽' } })
    expect(screen.getByTestId('record-redo').textContent).toBe('用改過的 prompt 重新生成')
    fireEvent.click(screen.getByTestId('record-redo'))
    fireEvent.click(screen.getByTestId('record-redo-confirm'))
    await screen.findByTestId('records-notice')
    expect(fake.payloadsOf('records.redo')).toEqual([{ jobId: 'j1', prompt: '貓在屋頂上，夕陽' }])
  })

  it('重新生成失敗：顯示主行程給的白話原因', async () => {
    installFakeSvs({
      'records.list': () => snapshot([record()]),
      'records.redo': () => {
        throw appError('這個鏡頭已經不在了。')
      },
    })
    render(<RecordsPage onNavigate={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('record-toggle'))
    fireEvent.click(screen.getByTestId('record-redo'))
    fireEvent.click(screen.getByTestId('record-redo-confirm'))
    expect((await screen.findByTestId('records-problem')).textContent).toBe('這個鏡頭已經不在了。')
  })
})
