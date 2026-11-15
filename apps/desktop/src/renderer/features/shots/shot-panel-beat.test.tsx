import type { ShotView, TakeView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { choose } from '../../test/select'
import { ShotPanel } from './shot-panel'

afterEach(cleanup)

const shot = (extra: Partial<ShotView> = {}): ShotView => ({
  id: 's2',
  number: 2,
  description: '貓跳上窗台',
  action: '',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: '貓跳上窗台。日系動畫風格',
  status: 'draft',
  firstFrames: [],
  videos: [],
  ...extra,
})

const localTake: TakeView = {
  id: 'v1',
  kind: 'video',
  version: 1,
  assetHash: 'a'.repeat(64),
  adopted: true,
  modelId: 'local-card',
  seed: 0,
  createdAt: '2026-11-12T08:30:00.000Z',
}

describe('鏡頭面板：格子種類（會動／不動／字卡）', () => {
  it('一般鏡頭：選單是「會動」，沒有字卡欄位；沒改就沒有任何存檔內容', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot()} />)
    expect(screen.getByTestId('shot-beat').textContent).toContain('會動')
    expect(screen.queryByTestId('shot-card-text')).toBeNull()
    expect(screen.getByTestId('shot-description')).toBeTruthy()
    expect(screen.queryByTestId('shot-over-max')).toBeNull()
  })

  it('選「字卡」：出現字卡的字與小字，畫面描述／運鏡／Prompt／「只重生影片」收起來；沒有字不能存', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot()} />)
    choose('shot-beat', 'card')
    expect(screen.getByTestId('shot-card-text')).toBeTruthy()
    expect(screen.getByTestId('shot-card-subtext')).toBeTruthy()
    expect(screen.queryByTestId('shot-description')).toBeNull()
    expect(screen.queryByTestId('shot-camera')).toBeNull()
    expect(screen.queryByTestId('shot-prompt')).toBeNull()
    expect(screen.queryByTestId('shot-regen-video')).toBeNull()
    expect(screen.getByTestId('shot-apply').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('shot-save').hasAttribute('disabled')).toBe(true)
  })

  it('字卡填了字：存檔送出 beatKind 與 card，再重新生成', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot(), 'shots.regenerate': () => shot() })
    render(<ShotPanel shot={shot()} />)
    choose('shot-beat', 'card')
    fireEvent.change(screen.getByTestId('shot-card-text'), {
      target: { value: '有些光，要有人陪你一起守' },
    })
    fireEvent.click(screen.getByTestId('shot-apply'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        {
          shotId: 's2',
          patch: { beatKind: 'card', card: { text: '有些光，要有人陪你一起守', subtext: '' } },
        },
      ])
    })
    expect(svs.payloadsOf('shots.regenerate')).toEqual([{ shotId: 's2', mode: 'apply' }])
  })

  it('選「不動」：只存種類，畫面描述與運鏡還在', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    render(<ShotPanel shot={shot()} />)
    choose('shot-beat', 'still')
    expect(screen.getByTestId('shot-description')).toBeTruthy()
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        { shotId: 's2', patch: { beatKind: 'still' } },
      ])
    })
  })

  it('字卡的字改了：只送 card；片名卡不能在這裡改種類，只有說明', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot({ beatKind: 'card', card: { text: '原來的字', subtext: '' } })} />)
    expect(screen.getByTestId<HTMLInputElement>('shot-card-text').value).toBe('原來的字')
    cleanup()
    render(<ShotPanel shot={shot({ beatKind: 'title' })} />)
    expect(screen.queryByTestId('shot-beat')).toBeNull()
    expect(screen.getByTestId('shot-beat-title-note').textContent).toContain('片名卡')
  })

  it('格長超過影片模型上限：面板寫出幾秒對幾秒；沒超過就沒有這行', () => {
    installFakeSvs()
    render(
      <ShotPanel shot={shot({ durationSec: 20, lengthOverMax: { wantSec: 20, maxSec: 15 } })} />,
    )
    const warn = screen.getByTestId('shot-over-max').textContent
    expect(warn).toContain('20 秒')
    expect(warn).toContain('15 秒')
  })

  it('本機做的版本（字卡、不動）的生成紀錄寫「本機・不花錢」，不是模型代號', () => {
    installFakeSvs()
    render(
      <ShotPanel
        shot={shot({
          beatKind: 'card',
          card: { text: '字', subtext: '' },
          videos: [localTake],
          status: 'done',
        })}
      />,
    )
    expect(screen.getByText(/本機・不花錢/)).toBeTruthy()
    expect(screen.queryByText(/local-card/)).toBeNull()
  })

  it('字卡：沒有入點出點、影片原聲、「會再花一次費用」那句；影片格都還在', async () => {
    installFakeSvs()
    const card = shot({
      beatKind: 'card',
      card: { text: '有些光', subtext: '' },
      videos: [localTake],
      status: 'done',
    })
    const first = render(<ShotPanel shot={card} />)
    expect(screen.queryByTestId('trim-player')).toBeNull()
    expect(screen.queryByTestId('shot-sound')).toBeNull()
    expect(screen.queryByText(/會再花一次這個鏡頭的費用/)).toBeNull()
    expect(screen.getByTestId('shot-preview')).toBeTruthy()
    first.unmount()
    // 會動的格子：照舊（影片原聲那一區要有這一格的聲音資料才畫）
    installFakeSvs({
      'sound.get': () => ({
        settings: {
          nativeAudio: true,
          nativeGainDb: 0,
          muteNativeShotIds: [],
          duck: true,
          narrationGainDb: 0,
          musicGainDb: -18,
        },
        shots: [{ shotId: 's2', number: 2, dialogue: '', nativeMuted: false, durationSec: 2 }],
        totalSec: 2,
        warnings: [],
        models: {},
      }),
    })
    render(
      <ShotPanel shot={shot({ videos: [{ ...localTake, modelId: 'kling' }], status: 'done' })} />,
    )
    expect(screen.getByTestId('trim-player')).toBeTruthy()
    expect(await screen.findByTestId('shot-sound')).toBeTruthy()
    expect(screen.getByText(/會再花一次這個鏡頭的費用/)).toBeTruthy()
  })

  it('不動：也不寫「會再花一次費用」（在這台電腦上做）', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot({ beatKind: 'still' })} />)
    expect(screen.queryByText(/會再花一次這個鏡頭的費用/)).toBeNull()
  })
})

describe('鏡頭面板：疊在不動畫面上的字', () => {
  it('只有「不動」的格子有疊字欄位；會動與字卡沒有', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot()} />)
    expect(screen.queryByTestId('shot-overlay-text')).toBeNull()
    choose('shot-beat', 'still')
    expect(screen.getByTestId('shot-overlay-text')).toBeTruthy()
    expect(screen.getByTestId('shot-overlay-subtext')).toBeTruthy()
    choose('shot-beat', 'card')
    expect(screen.queryByTestId('shot-overlay-text')).toBeNull()
  })

  it('填字：字數寫「用掉／上限」（中文 24 字）；存檔只送 overlay，改字不重生成', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    render(<ShotPanel shot={shot({ beatKind: 'still' })} />)
    expect(screen.getByTestId('shot-overlay-count').textContent).toBe('0/24')
    fireEvent.change(screen.getByTestId('shot-overlay-text'), { target: { value: '寵辱不驚' } })
    fireEvent.change(screen.getByTestId('shot-overlay-subtext'), {
      target: { value: '——《菜根譚》' },
    })
    expect(screen.getByTestId('shot-overlay-count').textContent).toBe('4/24')
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        { shotId: 's2', patch: { overlay: { text: '寵辱不驚', subtext: '——《菜根譚》' } } },
      ])
    })
    expect(svs.payloadsOf('shots.regenerate')).toEqual([])
  })

  it('超過上限：字數變警告色（不擋存檔）；英文數單字', () => {
    installFakeSvs()
    render(<ShotPanel shot={shot({ beatKind: 'still' })} />)
    fireEvent.change(screen.getByTestId('shot-overlay-text'), {
      target: { value: '字'.repeat(25) },
    })
    expect(screen.getByTestId('shot-overlay-count').className).toContain('text-warning')
    fireEvent.change(screen.getByTestId('shot-overlay-text'), {
      target: { value: 'Some light, and someone to keep it' },
    })
    expect(screen.getByTestId('shot-overlay-count').textContent).toBe('7/12')
    expect(screen.getByTestId('shot-overlay-count').className).not.toContain('text-warning')
  })

  it('原本有字：欄位帶出來；清空存檔 → overlay 為 null', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    render(
      <ShotPanel
        shot={shot({ beatKind: 'still', overlay: { text: '寵辱不驚', subtext: '出處' } })}
      />,
    )
    expect(screen.getByTestId<HTMLInputElement>('shot-overlay-text').value).toBe('寵辱不驚')
    expect(screen.getByTestId<HTMLInputElement>('shot-overlay-subtext').value).toBe('出處')
    fireEvent.change(screen.getByTestId('shot-overlay-text'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([{ shotId: 's2', patch: { overlay: null } }])
    })
  })
})
