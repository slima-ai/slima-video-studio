import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { choose } from '../../test/select'
import { TrailerStartCard } from './trailer-start'

afterEach(cleanup)

const CHECK_DEMO = {
  ok: true,
  estimatedUsd: 0,
  demoMode: true,
  existingBeats: 0,
  generatedBeats: 0,
}

const RESULT = {
  exists: true,
  settings: {},
  targetSec: 30,
  scriptSec: 30,
  beatCount: 9,
  matches: true,
  errors: [],
  warnings: [],
  retried: false,
  fixes: [],
}

function fill(text: string): void {
  fireEvent.change(screen.getByTestId('trailer-text'), { target: { value: text } })
}

describe('TrailerStartCard：做預告片', () => {
  it('沒貼文字：按鈕停用，並寫出原因；也不去問估價', () => {
    const check = vi.fn(() => CHECK_DEMO)
    installFakeSvs({ 'trailer.check': check })
    render(<TrailerStartCard />)
    expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(true)
    expect(screen.getByTestId('trailer-reason').textContent).toBe('先貼上文字，才能寫腳本。')
    expect(check).not.toHaveBeenCalled()
  })

  it('示範模式：按鈕與說明都寫「不花錢」；真的模型：寫出預估的美元', async () => {
    installFakeSvs({ 'trailer.check': () => CHECK_DEMO })
    const first = render(<TrailerStartCard />)
    fill('一座斷橋，一個老人。')
    await waitFor(() => {
      expect(screen.getByTestId('trailer-go').textContent).toBe('先產生腳本（示範模式不花錢）')
    })
    expect(screen.getByTestId('trailer-start-cost').textContent).toContain('不會花錢')
    first.unmount()

    installFakeSvs({
      'trailer.check': () => ({ ...CHECK_DEMO, demoMode: false, estimatedUsd: 0.05 }),
    })
    render(<TrailerStartCard />)
    fill('一座斷橋，一個老人。')
    await waitFor(() => {
      expect(screen.getByTestId('trailer-go').textContent).toBe('先產生腳本（約 US$0.05）')
    })
    expect(screen.getByTestId('trailer-start-cost').textContent).toContain('約 US$0.05')
    expect(screen.getByTestId('trailer-start-cost').textContent).toContain('只用文字模型')
  })

  it('沒有文字模型：按鈕停用，原因照 trailer.check 的話寫', async () => {
    installFakeSvs({
      'trailer.check': () => ({ ...CHECK_DEMO, ok: false, issue: '還沒有可用的文字模型。' }),
    })
    render(<TrailerStartCard />)
    fill('一座斷橋。')
    await waitFor(() => {
      expect(screen.getByTestId('trailer-reason').textContent).toBe('還沒有可用的文字模型。')
    })
    expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(true)
  })

  it('預設 30 秒、劇情；按下去帶文字、長度、類型與書名；寫好了通知畫布重讀', async () => {
    const plan = vi.fn(() => RESULT)
    installFakeSvs({ 'trailer.check': () => CHECK_DEMO, 'trailer.plan': plan })
    const onDone = vi.fn()
    render(<TrailerStartCard onDone={onDone} />)
    fill('  一座斷橋，一個老人。 ')
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('trailer-go'))
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
    expect(plan).toHaveBeenCalledWith({
      text: '一座斷橋，一個老人。',
      targetSec: 30,
      kind: 'story',
    })

    choose('trailer-length', '60')
    choose('trailer-kind', 'teaser')
    fireEvent.change(screen.getByTestId('trailer-title'), { target: { value: ' 斷橋 ' } })
    fireEvent.click(screen.getByTestId('trailer-go'))
    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(2)
    })
    expect(plan).toHaveBeenLastCalledWith({
      text: '一座斷橋，一個老人。',
      targetSec: 60,
      kind: 'teaser',
      title: '斷橋',
    })
  })

  it('檢查器擋下：卡片上直接寫出那則錯誤（原文），不只是一閃而過的提示；不會叫人縮短文本', async () => {
    const message =
      '腳本沒有通過檢查，專案沒有被改：第 1 格是字卡，預告片的第一格不能是字卡。 請再試一次。'
    installFakeSvs({
      'trailer.check': () => CHECK_DEMO,
      'trailer.plan': () => {
        throw appError(message)
      },
    })
    const onDone = vi.fn()
    render(<TrailerStartCard onDone={onDone} />)
    fill('一座斷橋。')
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('trailer-go'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('腳本沒寫成')
    expect(alert.textContent).toContain(message)
    expect(alert.textContent).not.toContain('縮短')
    expect(onDone).not.toHaveBeenCalled()
    // 按鈕回來了，可以再試一次
    expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(false)
  })

  it('文字太長的錯誤訊息會原樣顯示（「縮短」是後端只在太長時才加的）', async () => {
    const message = '腳本沒有通過檢查，專案沒有被改。 請再試一次。 文本很長，也可以縮短一點再試。'
    installFakeSvs({
      'trailer.check': () => CHECK_DEMO,
      'trailer.plan': () => {
        throw appError(message)
      },
    })
    render(<TrailerStartCard />)
    fill('字'.repeat(50))
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('trailer-go'))
    expect((await screen.findByTestId('trailer-error')).textContent).toContain('縮短一點再試')
  })
})
