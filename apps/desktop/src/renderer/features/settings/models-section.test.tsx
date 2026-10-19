import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODELS, SETTINGS, appError, installFakeSvs } from '../../test/fake-svs'
import { ModelsSection } from './models-section'

afterEach(cleanup)

describe('ModelsSection', () => {
  it('沒有任何模型 → 提示先填 Key 或開示範模式', () => {
    installFakeSvs()
    render(<ModelsSection models={[]} selected={{}} onChanged={vi.fn()} onGoToKeys={vi.fn()} />)
    expect(screen.getByTestId('models-empty').textContent).toContain('示範模式')
  })

  it('沒有任何模型 → 「去填金鑰」會通知上層', () => {
    installFakeSvs()
    const onGoToKeys = vi.fn()
    render(<ModelsSection models={[]} selected={{}} onChanged={vi.fn()} onGoToKeys={onGoToKeys} />)
    fireEvent.click(screen.getByRole('button', { name: '去填金鑰' }))
    expect(onGoToKeys).toHaveBeenCalledOnce()
  })

  it('選單按等級由貴到便宜排；每個選項有等級色塊、推薦小標、估算標籤與靠右的短價格', () => {
    installFakeSvs()
    render(
      <ModelsSection
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    const trigger = screen.getByTestId('model-t2i')
    expect(trigger.dataset.value).toBe('fal/nano-banana-2')
    // 收起時按鈕上就是目前的選擇
    expect(trigger.textContent).toContain('Nano Banana 2')
    expect(trigger.textContent).toContain('推薦')

    fireEvent.click(trigger)
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      'Nano Banana 2（推薦）・每張約 US$0.08（估算）',
      'Seedream 5.0・每張約 US$0.04',
    ])
    const [first, second] = options
    if (!first || !second) throw new Error('應該有兩個選項')
    const nano = within(first)
    expect(nano.getByText('平衡')).toBeTruthy()
    expect(nano.getByText('推薦')).toBeTruthy()
    expect(nano.getByText('估算')).toBeTruthy()
    expect(nano.getByText('每張約 US$0.08')).toBeTruthy()
    const seedream = within(second)
    expect(seedream.getByText('經濟實惠')).toBeTruthy()
    expect(seedream.queryByText('估算')).toBeNull()
  })

  it('選項上有模型的小標籤；選單下方寫走哪一家，好幾家都有時說會自動走便宜的', () => {
    installFakeSvs()
    const models = MODELS.map((m) =>
      m.id === 'fal/nano-banana-2'
        ? { ...m, badges: ['多圖參考'], otherChannels: ['OpenRouter'] }
        : m,
    )
    const { rerender } = render(
      <ModelsSection
        models={models}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    expect(screen.getByTestId('model-t2i-channel').textContent).toBe(
      '透過 fal.ai（OpenRouter 也有，會自動走比較便宜的那家）',
    )
    fireEvent.click(screen.getByTestId('model-t2i'))
    expect(
      within(screen.getByTestId('model-t2i-option-fal/nano-banana-2')).getByText('多圖參考'),
    ).toBeTruthy()
    rerender(
      <ModelsSection
        models={models}
        selected={{ t2i: 'fal/seedream-5.0' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    expect(screen.getByTestId('model-t2i-channel').textContent).toBe('透過 fal.ai')
  })

  it('同一種用途有好幾個模型標推薦時，只亮第一個（就是沒選時會用的那個）', () => {
    installFakeSvs()
    const models = MODELS.map((m) => ({ ...m, recommended: true }))
    render(
      <ModelsSection
        models={models}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('model-t2i'))
    const list = within(screen.getByRole('listbox'))
    expect(list.getAllByText('推薦')).toHaveLength(1)
    expect(
      within(screen.getByTestId('model-t2i-option-fal/nano-banana-2')).getByText('推薦'),
    ).toBeTruthy()
  })

  it('高品質和平衡都有標推薦時，推薦標在平衡那個（沒選時實際會用的）', () => {
    installFakeSvs()
    const models = MODELS.map((m) =>
      m.id === 'fal/seedream-5.0' ? { ...m, tier: 'premium' as const, recommended: true } : m,
    )
    render(
      <ModelsSection
        models={[...models].reverse()}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('model-t2i'))
    const list = within(screen.getByRole('listbox'))
    expect(list.getAllByText('推薦')).toHaveLength(1)
    expect(
      within(screen.getByTestId('model-t2i-option-fal/nano-banana-2')).getByText('推薦'),
    ).toBeTruthy()
  })

  it('選單下方只放這個模型的特色說明（價格已經在選項上）', () => {
    installFakeSvs()
    render(
      <ModelsSection
        models={[
          {
            ...MODELS[0],
            notes: '2026-10-19 實測的工程備註',
            userNote: '適合畫角色三視圖。',
          } as (typeof MODELS)[number],
        ]}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    expect(screen.getByTestId('model-t2i-detail').textContent).toBe('適合畫角色三視圖。')
  })

  it('某種用途沒有可用模型 → 說明要填哪邊的 Key（不顯示空白選單）', () => {
    installFakeSvs()
    render(<ModelsSection models={MODELS} selected={{}} onChanged={vi.fn()} onGoToKeys={vi.fn()} />)
    expect(screen.queryByTestId('model-llm')).toBeNull()
    expect(screen.getByText(/目前沒有可用的文字模型/)).toBeTruthy()
    expect(screen.getByText(/目前沒有可用的影片模型/)).toBeTruthy()
    expect(screen.getByText(/目前沒有可用的旁白模型/)).toBeTruthy()
    expect(screen.getByText(/目前沒有可用的配樂模型/)).toBeTruthy()
    // 文字、影片、旁白、配樂四種用途各一顆
    expect(screen.getAllByRole('button', { name: '去填金鑰' })).toHaveLength(4)
  })

  it('還沒填金鑰的模型排在最後、灰色不能選，寫要填哪家；選單下面說填了還能用哪些、一鍵去填', () => {
    installFakeSvs()
    const onGoToKeys = vi.fn()
    const [, seedream] = MODELS
    if (!seedream) throw new Error('示範資料應該有兩個模型')
    const flux = {
      ...seedream,
      id: 'fal/flux-2',
      displayName: 'FLUX.2',
      tier: 'premium',
      needsKey: 'fal.ai',
    } satisfies (typeof MODELS)[number]
    render(
      <ModelsSection
        models={[seedream]}
        locked={[flux, { ...flux, id: 'fal/x', displayName: 'X', capabilities: ['i2v'] }]}
        selected={{ t2i: 'fal/seedream-5.0' }}
        onChanged={vi.fn()}
        onGoToKeys={onGoToKeys}
      />,
    )
    // 只列在相同用途：圖片的選單下面只說 FLUX.2
    expect(screen.getByTestId('model-t2i-unlock').textContent).toContain(
      '填 fal.ai 的金鑰還能用：FLUX.2',
    )
    fireEvent.click(within(screen.getByTestId('model-t2i-unlock')).getByRole('button'))
    expect(onGoToKeys).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTestId('model-t2i'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      'Seedream 5.0・每張約 US$0.04',
      'FLUX.2・需要 fal.ai 金鑰',
    ])
    const [, lockedOption] = options
    if (!lockedOption) throw new Error('應該有灰色的選項')
    expect(lockedOption.getAttribute('aria-disabled')).toBe('true')
    expect(within(lockedOption).getByText('需要 fal.ai 金鑰')).toBeTruthy()
  })

  it('全部都能用時，選單下面不出現「填金鑰還能用」', () => {
    installFakeSvs()
    render(
      <ModelsSection
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('model-t2i-unlock')).toBeNull()
  })

  it('換模型 → 更新設定並通知上層', async () => {
    const svs = installFakeSvs()
    const onChanged = vi.fn()
    render(
      <ModelsSection
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={onChanged}
        onGoToKeys={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('model-t2i'))
    fireEvent.click(screen.getByTestId('model-t2i-option-fal/seedream-5.0'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(svs.payloadsOf('settings.update')).toEqual([{ models: { t2i: 'fal/seedream-5.0' } }])
  })

  it('主行程拒絕時顯示訊息', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw appError('這個模型沒辦法用在這個用途，請重新選擇。')
      },
    })
    render(
      <ModelsSection
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
        onGoToKeys={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('model-t2i'))
    fireEvent.click(screen.getByTestId('model-t2i-option-fal/seedream-5.0'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('沒辦法用在這個用途')
    })
  })

  it('旁白與配樂各有一列；旁白底下可以選聲音，選了會存到設定', async () => {
    const calls: unknown[] = []
    const tts0 = MODELS[0]
    if (!tts0) throw new Error('fake-svs 應該有模型')
    installFakeSvs({
      'settings.update': (payload) => {
        calls.push(payload)
        return SETTINGS
      },
    })
    const tts = {
      ...tts0,
      id: 'openrouter/minimax-speech-2.8-hd',
      displayName: 'MiniMax Speech 2.8 HD',
      capabilities: ['tts' as const],
      voices: [
        { id: 'male-qn-qingse', label: '青澀青年男聲', language: 'zh' as const },
        { id: 'female-x', label: '另一個聲音', language: 'zh' as const },
      ],
    }
    const music = {
      ...tts,
      id: 'openrouter/lyria-3-pro',
      displayName: 'Lyria 3 Pro',
      capabilities: ['music' as const],
      voices: [],
    }
    const onChanged = vi.fn()
    render(
      <ModelsSection
        models={[tts, music]}
        selected={{ tts: tts.id, music: music.id }}
        voices={{ [tts.id]: 'male-qn-qingse' }}
        onChanged={onChanged}
        onGoToKeys={vi.fn()}
      />,
    )
    expect(screen.getByTestId('model-tts').textContent).toContain('MiniMax Speech 2.8 HD')
    expect(screen.getByTestId('model-music').textContent).toContain('Lyria 3 Pro')
    // 配樂沒有聲音可選
    expect(screen.queryByTestId('voice-music')).toBeNull()
    const voice = screen.getByTestId('voice-tts')
    expect(voice.textContent).toContain('青澀青年男聲')
    fireEvent.click(voice)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /另一個聲音/ }))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
    })
    expect(calls).toEqual([{ audio: { voices: { [tts.id]: 'female-x' } } }])
  })
})
