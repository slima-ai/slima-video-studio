import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { choose } from '../../test/select'
import { TRAILER_TEXT_MAX, TrailerStartCard, clipTrailerText } from './trailer-start'

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
  it('沒貼文字：按鈕停用（不另外寫原因）；也不去問估價', () => {
    const check = vi.fn(() => CHECK_DEMO)
    installFakeSvs({ 'trailer.check': check })
    render(<TrailerStartCard />)
    expect(screen.getByTestId<HTMLButtonElement>('trailer-go').disabled).toBe(true)
    expect(screen.queryByTestId('trailer-reason')).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('示範模式：按鈕只寫「先產生腳本」；真的模型：按鈕上寫預估的美元（卡片上沒有另外的說明行）', async () => {
    installFakeSvs({ 'trailer.check': () => CHECK_DEMO })
    const first = render(<TrailerStartCard />)
    fill('一座斷橋，一個老人。')
    await waitFor(() => {
      expect(screen.getByTestId('trailer-go').textContent).toBe('先產生腳本')
    })
    expect(screen.queryByTestId('trailer-start-cost')).toBeNull()
    first.unmount()

    installFakeSvs({
      'trailer.check': () => ({ ...CHECK_DEMO, demoMode: false, estimatedUsd: 0.05 }),
    })
    render(<TrailerStartCard />)
    fill('一座斷橋，一個老人。')
    await waitFor(() => {
      expect(screen.getByTestId('trailer-go').textContent).toBe('先產生腳本（約 US$0.05）')
    })
    expect(screen.queryByTestId('trailer-start-cost')).toBeNull()
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

describe('TrailerStartCard：貼的文字超過 60,000 字', () => {
  it('有字就在輸入框下面寫字數；沒貼字不寫；沒超過就沒有「只會用前 …」', () => {
    installFakeSvs({ 'trailer.check': () => CHECK_DEMO })
    render(<TrailerStartCard />)
    expect(screen.queryByTestId('trailer-count')).toBeNull()
    fill('黑藤爬滿了斷橋。')
    expect(screen.getByTestId('trailer-count').textContent).toBe('8／60,000 字')
    fill('甲'.repeat(60_000))
    expect(screen.getByTestId('trailer-count').textContent).toBe('60,000／60,000 字')
  })

  it('超過：不默默截掉，字數照實寫、加一句「只會用前 60,000 字。」；估價與寫腳本只送前 60,000 字', async () => {
    const check = vi.fn(() => CHECK_DEMO)
    const plan = vi.fn(() => RESULT)
    installFakeSvs({ 'trailer.check': check, 'trailer.plan': plan })
    render(<TrailerStartCard />)
    const long = `${'甲'.repeat(60_000)}${'乙'.repeat(2_310)}`
    fill(long)
    expect(screen.getByTestId<HTMLTextAreaElement>('trailer-text').value).toHaveLength(62_310)
    expect(screen.getByTestId('trailer-count').textContent).toBe(
      '62,310／60,000 字只會用前 60,000 字。',
    )
    fireEvent.click(screen.getByTestId('trailer-go'))
    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1)
    })
    const sent = (plan.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(sent).toHaveLength(TRAILER_TEXT_MAX)
    expect(sent).toBe('甲'.repeat(60_000))
  })

  it('clipTrailerText：不到上限原樣；超過就切到上限，不把表情符號從中間切開', () => {
    expect(clipTrailerText('abc')).toBe('abc')
    const edge = `${'甲'.repeat(TRAILER_TEXT_MAX - 1)}😀後面`
    const clipped = clipTrailerText(edge)
    expect(clipped).toBe('甲'.repeat(TRAILER_TEXT_MAX - 1))
  })

  it('英文：「62,310 / 60,000 characters」與「Only the first 60,000 characters will be used.」', async () => {
    const { setLocale, DEFAULT_LOCALE } = await import('@svs/schema')
    installFakeSvs({ 'trailer.check': () => CHECK_DEMO })
    setLocale('en')
    try {
      render(<TrailerStartCard />)
      fill('a'.repeat(62_310))
      expect(screen.getByTestId('trailer-count').textContent).toBe(
        '62,310 / 60,000 charactersOnly the first 60,000 characters will be used.',
      )
    } finally {
      setLocale(DEFAULT_LOCALE)
    }
  })
})
