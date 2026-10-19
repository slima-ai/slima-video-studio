import type { SoundState } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { ShotSound } from './shot-sound'
import { SoundTimeline } from './sound-timeline'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SETTINGS = {
  nativeAudio: true,
  nativeGainDb: 0,
  muteNativeShotIds: [] as string[],
  duck: true,
  narrationGainDb: 0,
  musicGainDb: -18,
}

const narration = (shotId: string, durationSec = 2) => ({
  id: `n-${shotId}`,
  kind: 'narration' as const,
  shotId,
  assetHash: 'a'.repeat(64),
  durationSec,
  offsetSec: 0.4,
  text: '',
  modelId: 'mock/tts',
  costEstimated: false,
  version: 2,
  adopted: true,
  createdAt: '2026-10-19T08:00:00.000Z',
})

const view = (n: number, extra: Record<string, unknown> = {}) => ({
  shotId: `s${String(n)}`,
  number: n,
  startSec: (n - 1) * 5,
  durationSec: 5,
  hasVideo: true,
  dialogue: '',
  nativeMuted: false,
  sfx: [],
  ...extra,
})

const state = (extra: Partial<SoundState> = {}): SoundState => ({
  settings: SETTINGS,
  shots: [view(1, { dialogue: '一句話', narration: narration('s1') }), view(2)],
  totalSec: 10,
  warnings: [],
  models: { tts: 'mock/tts', music: 'mock/music' },
  final: { version: 1, hasSound: false, soundStale: false },
  ...extra,
})

describe('ShotSound：一個鏡頭的聲音', () => {
  it('有旁白：顯示長度與版本；有台詞可以「重新念」；沒有台詞的鏡頭說明為什麼沒有旁白', async () => {
    installFakeSvs({ 'sound.get': () => state() })
    render(<ShotSound shotId="s1" />)
    expect((await screen.findByTestId('shot-sound-narration')).textContent).toContain('2.0 秒')
    expect(screen.getByTestId('shot-sound-narration').textContent).toContain('第 2 版')
    expect(screen.getByTestId('shot-sound-narrate').textContent).toBe('重新念')
    cleanup()
    render(<ShotSound shotId="s2" />)
    expect((await screen.findByTestId('shot-sound-no-dialogue')).textContent).toContain('沒有台詞')
    expect(screen.queryByTestId('shot-sound-narrate')).toBeNull()
  })

  it('重新念：先給預估，確認才花錢；取消什麼都不做；念完自動重混', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls: string[] = []
    installFakeSvs({
      'sound.get': () => state(),
      'sound.plan': () => ({
        ok: true,
        totalUsd: 0.0018,
        items: [{ kind: 'narration', shotId: 's1', modelId: 'm', estimatedUsd: 0.0018 }],
      }),
      'sound.generateNarration': () => {
        calls.push('narration')
        return { clip: narration('s1') }
      },
      'sound.mix': () => {
        calls.push('mix')
        return { videoHash: 'h', version: 2 }
      },
    })
    render(<ShotSound shotId="s1" />)
    fireEvent.click(await screen.findByTestId('shot-sound-narrate'))
    expect((await screen.findByTestId('shot-sound-confirm')).textContent).toContain('US$0.0018')
    fireEvent.click(screen.getByTestId('shot-sound-cancel'))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByTestId('shot-sound-narrate'))
    fireEvent.click(await screen.findByTestId('shot-sound-go'))
    await vi.advanceTimersByTimeAsync(700)
    await waitFor(() => {
      expect(calls).toEqual(['narration', 'mix'])
    })
  })

  it('「用影片原聲」取消勾選就把這一鏡加進靜音名單；再勾回來就移除；然後自動重混', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const updates: unknown[] = []
    const mix = vi.fn(() => ({ videoHash: 'h', version: 2 }))
    installFakeSvs({
      'sound.get': () => state({ settings: { ...SETTINGS, muteNativeShotIds: ['s2'] } }),
      'sound.updateSettings': (p: unknown) => {
        updates.push(p)
        return SETTINGS
      },
      'sound.mix': mix,
    })
    render(<ShotSound shotId="s1" />)
    fireEvent.click(await screen.findByTestId('shot-sound-native'))
    await vi.advanceTimersByTimeAsync(700)
    // 原本只有 s2 被靜音，現在 s1 也加進去
    expect(updates).toEqual([{ muteNativeShotIds: ['s2', 's1'] }])
    await waitFor(() => {
      expect(mix).toHaveBeenCalledTimes(1)
    })
  })

  it('「用影片原聲」一點就換狀態，不用等主程序回應（回應慢的時候不會先彈回去）；設定沒存成功才退回來', async () => {
    let finish: (ok: boolean) => void = () => undefined
    installFakeSvs({
      'sound.get': () => state(),
      'sound.updateSettings': () =>
        new Promise((resolve, reject) => {
          finish = (ok) => {
            if (ok) resolve(SETTINGS)
            else reject(appError('存不進去'))
          }
        }),
    })
    render(<ShotSound shotId="s1" />)
    const box = await screen.findByTestId<HTMLInputElement>('shot-sound-native')
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    // 主程序還沒回：畫面上已經是取消勾選
    expect(box.checked).toBe(false)
    finish(false)
    await waitFor(() => {
      expect(box.checked).toBe(true)
    })
    expect(screen.getByRole('alert').textContent).toContain('存不進去')
  })

  it('點掉之後主程序變成靜音、別處又改回來：勾選要跟著主程序回到勾著（暫存不能復活）', async () => {
    const fake = installFakeSvs({
      'sound.get': () => state(),
      'sound.updateSettings': () => SETTINGS,
    })
    render(<ShotSound shotId="s1" />)
    const box = await screen.findByTestId<HTMLInputElement>('shot-sound-native')
    fireEvent.click(box)
    expect(box.checked).toBe(false)
    // 主程序存好了：這一鏡靜音
    act(() => {
      fake.emit('sound.changed', state({ shots: [view(1, { nativeMuted: true }), view(2)] }))
    })
    expect(box.checked).toBe(false)
    // 別處（例如 MCP 的聲音設定）把它改回來：以主程序為準
    act(() => {
      fake.emit('sound.changed', state({ shots: [view(1, { nativeMuted: false }), view(2)] }))
    })
    expect(box.checked).toBe(true)
  })

  it('資料剛載入、畫面剛出現就點「用影片原聲」：不會被載入那一刻留下的重設蓋回去', async () => {
    // 不包 act：載入那次 commit 的 passive effect 要等下一個排程才跑，
    // 這裡偏偏在 commit 一出現的同一個 microtask 就點，把 CI 機器忙時才會碰到的順序固定下來
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined }
    const before = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      installFakeSvs({
        'sound.get': () => state(),
        'sound.updateSettings': () => new Promise(() => undefined),
      })
      const { container } = render(<ShotSound shotId="s1" />)
      const checkedAfterClick = await new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          const box = container.querySelector<HTMLInputElement>('[data-testid="shot-sound-native"]')
          if (!box) return
          observer.disconnect()
          box.click()
          setTimeout(() => {
            resolve(box.checked)
          }, 50)
        })
        observer.observe(container, { childList: true, subtree: true })
      })
      expect(checkedAfterClick).toBe(false)
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before
    }
  })

  it('沒台詞 → 在聲音區寫入並儲存（走 shots.update）→ 出現「念出這句台詞」；沒存之前不能念', async () => {
    let dialogue = ''
    const updates: unknown[] = []
    installFakeSvs({
      'sound.get': () => state({ shots: [view(1, { dialogue }), view(2)] }),
      'shots.update': (p: unknown) => {
        updates.push(p)
        dialogue = (p as { patch: { dialogue: string } }).patch.dialogue
        return {}
      },
    })
    render(<ShotSound shotId="s1" />)
    expect((await screen.findByTestId('shot-sound-no-dialogue')).textContent).toContain('沒有台詞')
    expect(screen.queryByTestId('shot-sound-narrate')).toBeNull()
    expect(screen.queryByTestId('shot-sound-dialogue-save')).toBeNull()
    fireEvent.change(screen.getByTestId('shot-sound-dialogue'), {
      target: { value: '  黑藤爬滿了斷橋。 ' },
    })
    fireEvent.click(await screen.findByTestId('shot-sound-dialogue-save'))
    await waitFor(() => {
      expect(updates).toEqual([{ shotId: 's1', patch: { dialogue: '黑藤爬滿了斷橋。' } }])
    })
    expect((await screen.findByTestId('shot-sound-narrate')).textContent).toBe('念出這句台詞')
    expect(screen.queryByTestId('shot-sound-no-dialogue')).toBeNull()
    expect(screen.queryByTestId('shot-sound-dialogue-save')).toBeNull()
    // 改到一半還沒存：不能用舊台詞去念
    fireEvent.change(screen.getByTestId('shot-sound-dialogue'), { target: { value: '改一下' } })
    expect(screen.getByTestId<HTMLButtonElement>('shot-sound-narrate').disabled).toBe(true)
  })

  it('預估說不能做（超過預算）時顯示原因，不跳確認', async () => {
    installFakeSvs({
      'sound.get': () => state(),
      'sound.plan': () => ({ ok: false, totalUsd: 1, items: [], issue: '超過單次花費上限。' }),
    })
    render(<ShotSound shotId="s1" />)
    fireEvent.click(await screen.findByTestId('shot-sound-narrate'))
    expect((await screen.findByTestId('shot-sound-error')).textContent).toContain(
      '超過單次花費上限',
    )
    expect(screen.queryByTestId('shot-sound-confirm')).toBeNull()
  })
})

describe('SoundTimeline：整支片子的聲音時間軸', () => {
  it('每一鏡一格，旁白依位置與長度畫、超出的標警示、靜音的原聲標淡色、有配樂才畫配樂', () => {
    render(
      <SoundTimeline
        state={state({
          shots: [
            view(1, { narration: narration('s1', 2) }),
            view(2, { nativeMuted: true, narration: narration('s2', 8) }),
          ],
          music: { ...narration('s1'), kind: 'music', shotId: undefined, durationSec: 10 } as never,
          warnings: [{ kind: 'narration_too_long', shotId: 's2', message: '第 2 鏡太長' }],
        })}
      />,
    )
    expect(screen.getByTestId('timeline-shot-1').style.width).toBe('50%')
    expect(screen.getByTestId('timeline-shot-2').style.left).toBe('50%')
    // 第 1 鏡旁白從 0.4 秒開始、長 2 秒（佔 10 秒的 4%、20%）
    expect(screen.getByTestId('timeline-narration-1').style.left).toBe('4%')
    expect(screen.getByTestId('timeline-narration-1').style.width).toBe('20%')
    expect(screen.getByTestId('timeline-narration-1').dataset.overflow).toBe('false')
    expect(screen.getByTestId('timeline-narration-2').dataset.overflow).toBe('true')
    expect(screen.getByTestId('timeline-native-2').dataset.muted).toBe('true')
    expect(screen.getByTestId('timeline-native-1').dataset.muted).toBe('false')
    expect(screen.getByTestId('timeline-music').style.width).toBe('100%')
  })

  it('沒有鏡頭或總長是 0：不畫；沒有配樂就沒有配樂那一格', () => {
    const empty = render(<SoundTimeline state={state({ shots: [], totalSec: 0 })} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()
    render(<SoundTimeline state={state()} />)
    expect(screen.queryByTestId('timeline-music')).toBeNull()
  })
})
