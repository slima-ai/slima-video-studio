import type { ModelOption } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS, installFakeSvs } from '../../test/fake-svs'
import { VideoNegativeSection } from './video-negative-section'

afterEach(cleanup)

const BUILT_IN = 'extra face features, mouth, arms, legs'

const kling: ModelOption = {
  id: 'openrouter/kling-3.0-standard',
  displayName: 'Kling 3.0 Standard',
  provider: 'openrouter',
  providerName: 'OpenRouter',
  capabilities: ['i2v'],
  tier: 'balanced',
  recommended: true,
  priceLabel: '約 US$0.084／秒',
  priceShort: '每 5 秒約 US$0.42',
  priceVerified: true,
  badges: [],
  voices: [],
  otherChannels: [],
  negativePromptDefault: BUILT_IN,
}
const veo: ModelOption = { ...kling, id: 'openrouter/veo-3.1-lite', displayName: 'Veo' }
delete veo.negativePromptDefault

/** 編輯區收在卡片的「更多」裡：畫出來後先展開。 */
const show = (ui: ReactElement): void => {
  render(ui)
  fireEvent.click(screen.getByTestId('setting-card-more'))
}
const box = (): HTMLTextAreaElement => screen.getByTestId<HTMLTextAreaElement>('video-negative')

describe('VideoNegativeSection：影片的負面提示', () => {
  it('沒改過：顯示目前影片模型內建的清單，儲存與恢復都是停用的', () => {
    installFakeSvs()
    show(<VideoNegativeSection settings={SETTINGS} videoModel={kling} onChanged={vi.fn()} />)
    expect(box().value).toBe(BUILT_IN)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢復內建' }).disabled).toBe(true)
  })

  it('改了內容才能儲存，送出修改後的文字', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    show(<VideoNegativeSection settings={SETTINGS} videoModel={kling} onChanged={onChanged} />)
    fireEvent.change(box(), { target: { value: 'mouth only' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ videoNegativePrompt: 'mouth only' }])
  })

  it('改回跟內建一樣再儲存，存成空字串（之後內建更新才會跟著更新）', async () => {
    const svs = installFakeSvs()
    show(
      <VideoNegativeSection
        settings={{ ...SETTINGS, videoNegativePrompt: 'mouth only' }}
        videoModel={kling}
        onChanged={vi.fn()}
      />,
    )
    expect(box().value).toBe('mouth only')
    fireEvent.change(box(), { target: { value: BUILT_IN } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ videoNegativePrompt: '' }])
    })
  })

  it('恢復內建：輸入框換回內建並送出空字串', async () => {
    const svs = installFakeSvs()
    show(
      <VideoNegativeSection
        settings={{ ...SETTINGS, videoNegativePrompt: 'mouth only' }}
        videoModel={kling}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '恢復內建' }))
    await waitFor(() => {
      expect(svs.payloadsOf('settings.update')).toEqual([{ videoNegativePrompt: '' }])
    })
    expect(box().value).toBe(BUILT_IN)
  })

  it('目前的影片模型不接受負面提示：說明這份清單不會送出，輸入框停用（沒改過時）', () => {
    installFakeSvs()
    show(<VideoNegativeSection settings={SETTINGS} videoModel={veo} onChanged={vi.fn()} />)
    expect(screen.getByTestId('video-negative-section').textContent).toContain('不接受負面提示')
    expect(box().disabled).toBe(true)
  })
})
