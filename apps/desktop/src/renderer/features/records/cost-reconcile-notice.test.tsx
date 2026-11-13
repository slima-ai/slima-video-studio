import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { installFakeSvs } from '../../test/fake-svs'
import { CostReconcileNotice } from './cost-reconcile-notice'

afterEach(cleanup)

describe('CostReconcileNotice', () => {
  it('打開時取走提示、說出補了多少錢；按「看明細」到生成紀錄', async () => {
    const pending = [{ usd: 1.234, count: 2 }]
    const svs = installFakeSvs({
      'costs.reconcileNotice': () => ({ notice: pending.shift() ?? null }),
    })
    const onOpenRecords = vi.fn()
    render(
      <ToastProvider>
        <CostReconcileNotice onOpenRecords={onOpenRecords} />
      </ToastProvider>,
    )
    const toast = await screen.findByTestId('toast')
    expect(toast.textContent).toContain('補記了先前漏記的 US$1.23')
    fireEvent.click(screen.getByRole('button', { name: '看明細' }))
    expect(onOpenRecords).toHaveBeenCalledOnce()
    expect(svs.payloadsOf('costs.reconcileNotice')).toHaveLength(1)
  })

  it('沒有補記就什麼都不顯示；主行程說有新的提示時才再取一次', async () => {
    const pending: { usd: number; count: number }[] = []
    const svs = installFakeSvs({
      'costs.reconcileNotice': () => ({ notice: pending.shift() ?? null }),
    })
    render(
      <ToastProvider>
        <CostReconcileNotice onOpenRecords={vi.fn()} />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(svs.payloadsOf('costs.reconcileNotice')).toHaveLength(1)
    })
    expect(screen.queryByTestId('toast')).toBeNull()
    pending.push({ usd: 0.004, count: 1 })
    svs.emit('costs.reconciled', {})
    expect((await screen.findByTestId('toast')).textContent).toContain('US$0.004')
  })
})
