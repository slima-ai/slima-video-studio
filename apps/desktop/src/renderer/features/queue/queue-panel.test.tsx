import type { JobSummary } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { QueuePanel } from './queue-panel'
import { upsertJob } from './use-queue'

afterEach(cleanup)

const job = (id: string, extra: Partial<JobSummary> = {}): JobSummary => ({
  id,
  provider: 'fal',
  modelId: 'fal/nano-banana-2',
  kind: 'image',
  status: 'queued',
  attempt: 0,
  maxAttempts: 3,
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T08:00:00.000Z',
  ...extra,
})

describe('upsertJob', () => {
  it('新任務放最前面；已存在的就地更新、位置不變', () => {
    const a = job('a')
    const b = job('b')
    expect(upsertJob([a], b).map((j) => j.id)).toEqual(['b', 'a'])
    const updated = upsertJob([b, a], { ...a, status: 'running' })
    expect(updated.map((j) => j.id)).toEqual(['b', 'a'])
    expect(updated[1]?.status).toBe('running')
  })

  it('比手上的舊的更新不採用：晚到的「送出中」不會蓋掉「完成」', () => {
    const done = job('a', { status: 'succeeded', updatedAt: '2026-10-12T08:00:02.000Z' })
    const late = job('a', { status: 'running', updatedAt: '2026-10-12T08:00:01.000Z' })
    expect(upsertJob([done], late)[0]?.status).toBe('succeeded')
    // 時間一樣：後面的階段比較新
    const sameTime = job('a', { status: 'running', updatedAt: done.updatedAt })
    expect(upsertJob([done], sameTime)[0]?.status).toBe('succeeded')
    // 重試：時間比較新，即使回到排隊也採用
    const retried = job('a', { status: 'queued', updatedAt: '2026-10-12T08:00:03.000Z' })
    expect(upsertJob([done], retried)[0]?.status).toBe('queued')
  })
})

describe('QueuePanel', () => {
  it('沒有任務 → 顯示空狀態', async () => {
    installFakeSvs()
    render(<QueuePanel />)
    expect(await screen.findByTestId('queue-empty')).toBeTruthy()
  })

  it('載入既有任務：新的在前，顯示種類、描述、狀態與花費', async () => {
    installFakeSvs({
      'queue.list': () => ({
        jobs: [
          job('old', {
            kind: 'llm',
            status: 'succeeded',
            promptPreview: '拆鏡頭',
            costUsd: 0.0042,
          }),
          job('new', { kind: 'video', status: 'polling', promptPreview: '貓在雨中走' }),
        ],
      }),
    })
    render(<QueuePanel />)
    const items = await screen.findAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual(['job-new', 'job-old'])
    const newer = within(screen.getByTestId('job-new'))
    const older = within(screen.getByTestId('job-old'))
    expect(newer.getByText('影片')).toBeTruthy()
    expect(newer.getByText('生成中')).toBeTruthy()
    expect(newer.getByText('貓在雨中走')).toBeTruthy()
    expect(older.getByText('完成')).toBeTruthy()
    expect(older.getByText('US$0.0042')).toBeTruthy()
    expect(screen.getByTestId('queue-active-count').textContent).toBe('執行中 1・排隊 0')
  })

  it('主行程推送進度：新增任務、更新狀態，不用重新載入', async () => {
    const svs = installFakeSvs()
    render(<QueuePanel />)
    await screen.findByTestId('queue-empty')
    act(() => {
      svs.emit('queue.changed', job('a', { promptPreview: '第一個' }))
    })
    expect(screen.getByTestId('job-a').getAttribute('data-status')).toBe('queued')
    act(() => {
      svs.emit('queue.changed', job('a', { promptPreview: '第一個', status: 'succeeded' }))
    })
    expect(screen.getByTestId('job-a').getAttribute('data-status')).toBe('succeeded')
    expect(screen.queryByTestId('queue-active-count')).toBeNull()
  })

  it('換專案（queue.reset）→ 重新載入清單', async () => {
    let jobs: JobSummary[] = [job('a')]
    const svs = installFakeSvs({ 'queue.list': () => ({ jobs }) })
    render(<QueuePanel />)
    await screen.findByTestId('job-a')
    jobs = []
    act(() => {
      svs.emit('queue.reset', {})
    })
    await screen.findByTestId('queue-empty')
  })

  it('失敗的任務顯示原因並可以重試；排隊重試中顯示第幾次', async () => {
    const svs = installFakeSvs({
      'queue.list': () => ({
        jobs: [
          job('f', {
            status: 'failed',
            attempt: 3,
            error: { userMessage: 'fal.ai 拒絕了這個請求。', retryable: false },
          }),
          job('r', { status: 'queued', attempt: 1 }),
        ],
      }),
      'queue.retry': () => job('f', { status: 'queued' }),
    })
    render(<QueuePanel />)
    const failed = await screen.findByTestId('job-f')
    expect(within(failed).getByText('fal.ai 拒絕了這個請求。')).toBeTruthy()
    expect(screen.getByTestId('job-r').textContent).toContain('第 1 次嘗試沒成功')
    fireEvent.click(within(failed).getByRole('button', { name: '重試' }))
    await waitFor(() => {
      expect(screen.getByTestId('job-f').getAttribute('data-status')).toBe('queued')
    })
    expect(svs.payloadsOf('queue.retry')).toEqual([{ jobId: 'f' }])
  })

  it('進行中的任務可以取消', async () => {
    const svs = installFakeSvs({
      'queue.list': () => ({ jobs: [job('a', { status: 'submitted' })] }),
      'queue.cancel': () => job('a', { status: 'cancelled' }),
    })
    render(<QueuePanel />)
    const row = await screen.findByTestId('job-a')
    fireEvent.click(within(row).getByRole('button', { name: '取消' }))
    await waitFor(() => {
      expect(screen.getByTestId('job-a').getAttribute('data-status')).toBe('cancelled')
    })
    expect(svs.payloadsOf('queue.cancel')).toEqual([{ jobId: 'a' }])
    expect(within(screen.getByTestId('job-a')).getByRole('button', { name: '重試' })).toBeTruthy()
  })

  it('取消失敗時顯示訊息', async () => {
    installFakeSvs({
      'queue.list': () => ({ jobs: [job('a', { status: 'running' })] }),
      'queue.cancel': () => {
        throw appError('請先開啟或建立一個專案。')
      },
    })
    render(<QueuePanel />)
    fireEvent.click(
      within(await screen.findByTestId('job-a')).getByRole('button', { name: '取消' }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe('請先開啟或建立一個專案。')
  })

  it('完成的任務沒有操作按鈕', async () => {
    installFakeSvs({ 'queue.list': () => ({ jobs: [job('a', { status: 'succeeded' })] }) })
    render(<QueuePanel />)
    const row = await screen.findByTestId('job-a')
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('平常收起（只留標題）；有新任務開始也不會自己展開，標題上看得到執行中與排隊的數量', async () => {
    const svs = installFakeSvs()
    render(<QueuePanel />)
    await screen.findByTestId('queue-empty')
    const panel = screen.getByTestId('queue-panel')
    expect(panel.dataset.collapsed).toBe('true')
    expect(screen.getByRole('button', { name: '展開生成佇列' }).getAttribute('aria-expanded')).toBe(
      'false',
    )

    act(() => {
      svs.emit('queue.changed', job('a', { status: 'polling' }))
      svs.emit('queue.changed', job('b', { status: 'queued' }))
    })
    expect(panel.dataset.collapsed).toBe('true')
    expect(screen.getByTestId('queue-active-count').textContent).toBe('執行中 1・排隊 1')
  })

  it('每一列前面標「第 N 鏡・第一張畫面／影片」（和畫布同一個名字），沒對到鏡頭的只標種類', async () => {
    installFakeSvs({
      'queue.list': () => ({
        jobs: [job('a', { kind: 'image', stepLabel: '第 2 鏡' }), job('b', { kind: 'llm' })],
      }),
    })
    render(<QueuePanel />)
    const labels = (await screen.findAllByTestId('job-label')).map((el) => el.textContent)
    // 新的在前
    expect(labels).toEqual(['文字', '第 2 鏡・第一張畫面'])
  })

  it('使用者自己展開：高度貼著內容；任務做完也維持展開，再按一次才收起', async () => {
    const svs = installFakeSvs()
    render(<QueuePanel />)
    await screen.findByTestId('queue-empty')
    const panel = screen.getByTestId('queue-panel')
    act(() => {
      svs.emit('queue.changed', job('a', { status: 'queued' }))
    })
    fireEvent.click(screen.getByRole('button', { name: '展開生成佇列' }))
    expect(panel.dataset.collapsed).toBe('false')
    // 標題 32px ＋ 一列 37px，不是固定的 160px
    expect(panel.style.height).toBe('69px')
    act(() => {
      svs.emit('queue.changed', job('a', { status: 'succeeded' }))
    })
    expect(panel.dataset.collapsed).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '收合生成佇列' }))
    expect(panel.dataset.collapsed).toBe('true')
  })
})
