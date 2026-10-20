import type { SoundState } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { HistoryProvider } from '../../lib/history'
import { appError, installFakeSvs } from '../../test/fake-svs'
import { SoundPanel } from './sound-panel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SETTINGS = {
  nativeAudio: true,
  nativeGainDb: 0,
  muteNativeShotIds: [],
  duck: true,
  narrationGainDb: 0,
  musicGainDb: -18,
}

const clip = (kind: 'narration' | 'music', shotId?: string) => ({
  id: `c-${kind}-${shotId ?? 'all'}`,
  kind,
  ...(shotId ? { shotId } : {}),
  assetHash: 'a'.repeat(64),
  offsetSec: 0,
  text: '',
  modelId: 'mock/tts',
  costEstimated: false,
  version: 1,
  adopted: true,
  createdAt: '2026-10-19T08:00:00.000Z',
})

const shot = (n: number, narrated: boolean) => ({
  shotId: `s${String(n)}`,
  number: n,
  startSec: (n - 1) * 3,
  durationSec: 3,
  hasVideo: true,
  dialogue: `第 ${String(n)} 句`,
  nativeMuted: false,
  ...(narrated ? { narration: clip('narration', `s${String(n)}`) } : {}),
  sfx: [],
})

const state = (extra: Partial<SoundState> = {}): SoundState => ({
  settings: SETTINGS,
  shots: [shot(1, false), shot(2, false)],
  totalSec: 6,
  warnings: [],
  models: { tts: 'mock/tts', music: 'mock/music' },
  final: { version: 1, hasSound: false, soundStale: false },
  ...extra,
})

describe('SoundPanel：加聲音', () => {
  it('還沒有成品：只說先接成成品', async () => {
    installFakeSvs({ 'sound.get': () => state({ final: undefined }) })
    render(<SoundPanel />)
    expect(await screen.findByText(/先把鏡頭接成成品/)).toBeTruthy()
    expect(screen.queryByTestId('sound-add')).toBeNull()
  })

  it('沒有可用的旁白與配樂模型：說明要去設定', async () => {
    installFakeSvs({ 'sound.get': () => state({ models: {} }) })
    render(<SoundPanel />)
    expect(await screen.findByText(/請到設定填入 OpenRouter 的金鑰/)).toBeTruthy()
  })

  it('兩下就有聲音：按「加上旁白與配樂」看到預估花費，按「開始」依序生成旁白、配樂、混音', async () => {
    const calls: string[] = []
    installFakeSvs({
      'sound.get': () => state(),
      'sound.plan': () => ({
        ok: true,
        totalUsd: 0.093,
        items: [
          { kind: 'narration', shotId: 's1', modelId: 'mock/tts', estimatedUsd: 0.001 },
          { kind: 'narration', shotId: 's2', modelId: 'mock/tts', estimatedUsd: 0.002 },
          { kind: 'music', modelId: 'mock/music', estimatedUsd: 0.09 },
        ],
      }),
      'sound.generateNarration': (p: { shotId: string }) => {
        calls.push(`narration:${p.shotId}`)
        return { clip: clip('narration', p.shotId) }
      },
      'sound.generateMusic': () => {
        calls.push('music')
        return { clip: clip('music') }
      },
      'sound.mix': () => {
        calls.push('mix')
        return { videoHash: 'h', version: 2 }
      },
    })
    render(<SoundPanel />)
    fireEvent.click(await screen.findByTestId('sound-add'))
    const confirm = await screen.findByTestId('sound-add-confirm')
    expect(confirm.textContent).toContain('約 US$0.093')
    expect(confirm.textContent).toContain('旁白 2 句')
    expect(confirm.textContent).toContain('配樂 1 首')
    // 確認之前什麼都還沒花
    expect(calls).toEqual([])
    fireEvent.click(screen.getByTestId('sound-add-go'))
    await waitFor(() => {
      expect(calls).toEqual(['narration:s1', 'narration:s2', 'music', 'mix'])
    })
  })

  it('取消就什麼都不做；預估說不能做（超過預算）時顯示原因', async () => {
    const generate = vi.fn()
    installFakeSvs({
      'sound.get': () => state(),
      'sound.plan': () => ({
        ok: true,
        totalUsd: 0.2,
        items: [{ kind: 'music', modelId: 'm', estimatedUsd: 0.2 }],
      }),
      'sound.generateMusic': generate,
    })
    render(<SoundPanel />)
    fireEvent.click(await screen.findByTestId('sound-add'))
    fireEvent.click(await screen.findByTestId('sound-add-cancel'))
    expect(screen.getByTestId('sound-add')).toBeTruthy()
    expect(generate).not.toHaveBeenCalled()

    cleanup()
    installFakeSvs({
      'sound.get': () => state(),
      'sound.plan': () => ({ ok: false, totalUsd: 1, items: [], issue: '超過單次花費上限。' }),
    })
    render(<SoundPanel />)
    fireEvent.click(await screen.findByTestId('sound-add'))
    expect((await screen.findByTestId('sound-error')).textContent).toContain('超過單次花費上限')
  })
})

describe('SoundPanel：調音量', () => {
  const withSound = (): SoundState =>
    state({
      shots: [shot(1, true), shot(2, true)],
      music: clip('music'),
      final: { version: 2, hasSound: true, soundStale: false },
    })

  it('三排「小／中／大」顯示目前的音量；改了就存設定、等一下自動重混（連按只混一次）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const updates: unknown[] = []
    const mix = vi.fn(() => ({ videoHash: 'h', version: 3 }))
    installFakeSvs({
      'sound.get': () => withSound(),
      'sound.updateSettings': (p: unknown) => {
        updates.push(p)
        return SETTINGS
      },
      'sound.mix': mix,
    })
    render(<SoundPanel />)
    expect((await screen.findByTestId('sound-music-mid')).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sound-native-mid').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('sound-music-low'))
    fireEvent.click(screen.getByTestId('sound-narration-high'))
    await vi.advanceTimersByTimeAsync(700)
    expect(updates).toEqual([{ musicGainDb: -24 }, { narrationGainDb: 4 }])
    await waitFor(() => {
      expect(mix).toHaveBeenCalledTimes(1)
    })
  })

  it('影片原聲「關」：每一鏡都靜音；再選「中」就全部恢復', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const updates: unknown[] = []
    installFakeSvs({
      'sound.get': () => withSound(),
      'sound.updateSettings': (p: unknown) => {
        updates.push(p)
        return SETTINGS
      },
      'sound.mix': () => ({ videoHash: 'h', version: 3 }),
    })
    render(<SoundPanel />)
    fireEvent.click(await screen.findByTestId('sound-native-off'))
    fireEvent.click(screen.getByTestId('sound-native-mid'))
    await vi.advanceTimersByTimeAsync(700)
    expect(updates).toEqual([
      { muteNativeShotIds: ['s1', 's2'] },
      { muteNativeShotIds: [], nativeGainDb: 0 },
    ])
  })

  it('旁白警示直接顯示；聲音變了但還沒重混時有「重新混音（不花錢）」', async () => {
    installFakeSvs({
      'sound.get': () => ({
        ...withSound(),
        warnings: [{ kind: 'narration_too_long', shotId: 's1', message: '第 1 鏡的旁白太長了。' }],
        final: { version: 2, hasSound: true, soundStale: true },
      }),
      'sound.mix': () => ({ videoHash: 'h', version: 3 }),
    })
    render(<SoundPanel />)
    expect(await screen.findByText('第 1 鏡的旁白太長了。')).toBeTruthy()
    expect(screen.getByTestId('sound-remix').textContent).toContain('不花錢')
    expect(screen.getByTestId('sound-summary').textContent).toContain('2 個鏡頭有旁白')
  })

  it('沒有任何鏡頭有旁白時：不顯示旁白音量那一排，改成一句說明', async () => {
    installFakeSvs({
      'sound.get': () =>
        state({ music: clip('music'), final: { version: 2, hasSound: true, soundStale: false } }),
    })
    render(<SoundPanel />)
    expect((await screen.findByTestId('sound-no-narration')).textContent).toContain(
      '鏡頭沒有台詞，所以沒有旁白',
    )
    expect(screen.queryByTestId('sound-narration-mid')).toBeNull()
    expect(screen.getByTestId('sound-music-mid')).toBeTruthy()
  })
})

describe('SoundPanel：刪除旁白與配樂', () => {
  const withSound = (): SoundState =>
    state({
      shots: [shot(1, true), shot(2, true)],
      music: clip('music'),
      final: { version: 2, hasSound: true, soundStale: false },
    })
  const renderPanel = () =>
    render(
      <ToastProvider>
        <HistoryProvider enabled>
          <SoundPanel />
        </HistoryProvider>
      </ToastProvider>,
    )

  it('刪除旁白：不跳確認框，直接刪全部鏡頭的旁白，提示說台詞還在並附「復原」；之後自動重混', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const removes: unknown[] = []
    const mix = vi.fn(() => ({ videoHash: 'h', version: 3 }))
    const undo = vi.fn(() => ({
      applied: true,
      label: '刪除旁白',
      state: { canUndo: false, canRedo: true },
    }))
    installFakeSvs({
      'sound.get': () => withSound(),
      'sound.remove': (p: unknown) => {
        removes.push(p)
        return { removed: 2 }
      },
      'sound.mix': mix,
      'history.undo': undo,
    })
    renderPanel()
    fireEvent.click(await screen.findByTestId('sound-narration-delete'))
    await waitFor(() => {
      expect(removes).toEqual([{ kind: 'narration' }])
    })
    const toast = await screen.findByText(/已刪除 2 句旁白，台詞還在，可以再念/)
    expect(toast).toBeTruthy()
    await vi.advanceTimersByTimeAsync(700)
    await waitFor(() => {
      expect(mix).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('button', { name: '復原' }))
    await waitFor(() => {
      expect(undo).toHaveBeenCalledTimes(1)
    })
  })

  it('刪除配樂：只刪配樂（旁白不動）；沒有配樂時沒有這顆鈕', async () => {
    const removes: unknown[] = []
    installFakeSvs({
      'sound.get': () => withSound(),
      'sound.remove': (p: unknown) => {
        removes.push(p)
        return { removed: 1 }
      },
      'sound.mix': () => ({ videoHash: 'h', version: 3 }),
    })
    renderPanel()
    fireEvent.click(await screen.findByTestId('sound-music-delete'))
    await waitFor(() => {
      expect(removes).toEqual([{ kind: 'music' }])
    })
    expect(await screen.findByText('已刪除配樂。')).toBeTruthy()
    cleanup()
    installFakeSvs({ 'sound.get': () => ({ ...withSound(), music: undefined }) })
    renderPanel()
    await screen.findByTestId('sound-narration-delete')
    expect(screen.queryByTestId('sound-music-delete')).toBeNull()
  })

  it('刪除失敗：顯示白話錯誤，不跳「已刪除」', async () => {
    installFakeSvs({
      'sound.get': () => withSound(),
      'sound.remove': () => {
        throw appError('現在沒辦法刪除聲音。')
      },
    })
    renderPanel()
    fireEvent.click(await screen.findByTestId('sound-music-delete'))
    expect((await screen.findByTestId('sound-error')).textContent).toContain('沒辦法刪除聲音')
    expect(screen.queryByText('已刪除配樂。')).toBeNull()
  })
})
