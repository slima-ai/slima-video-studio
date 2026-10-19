import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { installFakeSvs } from '../../test/fake-svs'
import { ModelNotices } from './model-notices'

afterEach(cleanup)

const NOTICE = '「Veo 3.1 Lite」已經下架，影片改用「Kling 3.0 Standard」。可以到設定換別的。'

describe('ModelNotices', () => {
  it('打開時取走通知、用提示說一次；按「到設定」帶過去', async () => {
    const pending = [NOTICE]
    const svs = installFakeSvs({ 'models.notices': () => ({ notices: pending.splice(0) }) })
    const onOpenSettings = vi.fn()
    render(
      <ToastProvider>
        <ModelNotices onOpenSettings={onOpenSettings} />
      </ToastProvider>,
    )
    const toast = await screen.findByTestId('toast')
    expect(toast.textContent).toContain(NOTICE)
    fireEvent.click(screen.getByRole('button', { name: '到設定' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(svs.payloadsOf('models.notices')).toHaveLength(1)
  })

  it('主行程說有新的通知時再取一次', async () => {
    const pending: string[] = []
    const svs = installFakeSvs({ 'models.notices': () => ({ notices: pending.splice(0) }) })
    render(
      <ToastProvider>
        <ModelNotices onOpenSettings={vi.fn()} />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(svs.payloadsOf('models.notices')).toHaveLength(1)
    })
    expect(screen.queryByTestId('toast')).toBeNull()
    pending.push(NOTICE)
    svs.emit('models.noticed', {})
    expect((await screen.findByTestId('toast')).textContent).toContain(NOTICE)
  })
})
