import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { CardFooter } from './card-footer'

afterEach(cleanup)

const usage = {
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  durationMs: 3200,
  costUsd: 0.25,
  costEstimated: false,
  regenerateUsd: 0.75,
}

describe('CardFooter', () => {
  it('一行顯示耗時、花費與多久前；花費是估算的要標出來', () => {
    installFakeSvs()
    const { rerender } = render(<CardFooter shotId="s1" number={1} usage={usage} busy={false} />)
    expect(screen.getByTestId('card-usage').textContent).toBe('3.2 秒・約 US$0.25・5 分鐘前')
    rerender(
      <CardFooter shotId="s1" number={1} usage={{ ...usage, costEstimated: true }} busy={false} />,
    )
    expect(screen.getByTestId('card-usage').textContent).toContain('（估算）')
  })

  it('沒有耗時與花費：只顯示多久前', () => {
    installFakeSvs()
    render(
      <CardFooter shotId="s1" number={1} usage={{ createdAt: usage.createdAt }} busy={false} />,
    )
    expect(screen.getByTestId('card-usage').textContent).toBe('5 分鐘前')
  })

  it('重新生成要先確認（說明大約再花多少、舊版本保留），確定才送出', async () => {
    const svs = installFakeSvs({ 'shots.regenerate': () => ({}) })
    render(<CardFooter shotId="s1" number={2} usage={usage} busy={false} />)
    fireEvent.click(screen.getByRole('button', { name: '重新生成第 2 鏡' }))
    expect(svs.payloadsOf('shots.regenerate')).toHaveLength(0)
    expect(screen.getByTestId('card-confirm').textContent).toContain('大約再花 US$0.75')
    expect(screen.getByTestId('card-confirm').textContent).toContain('舊版本都會保留')

    fireEvent.click(screen.getByTestId('card-regenerate-cancel'))
    expect(screen.queryByTestId('card-confirm')).toBeNull()

    fireEvent.click(screen.getByTestId('card-regenerate'))
    fireEvent.click(screen.getByTestId('card-regenerate-confirm'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.regenerate')).toEqual([{ shotId: 's1', mode: 'all' }])
    })
  })

  it('鏡頭正在生成時不能按；失敗會顯示原因', async () => {
    installFakeSvs({
      'shots.regenerate': () => {
        throw appError('這個鏡頭正在生成。')
      },
    })
    const { rerender } = render(<CardFooter shotId="s1" number={1} usage={usage} busy />)
    expect(screen.getByTestId<HTMLButtonElement>('card-regenerate').disabled).toBe(true)
    rerender(<CardFooter shotId="s1" number={1} usage={usage} busy={false} />)
    fireEvent.click(screen.getByTestId('card-regenerate'))
    fireEvent.click(screen.getByTestId('card-regenerate-confirm'))
    expect((await screen.findByTestId('card-problem')).textContent).toContain('正在生成')
  })
})
