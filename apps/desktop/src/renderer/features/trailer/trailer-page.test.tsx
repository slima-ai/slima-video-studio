import type { ShotView, TrailerStatus } from '@svs/schema'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { beat, take } from './shots.fixture'
import { trailerBeats, TrailerPage } from './trailer-page'

afterEach(cleanup)

const status = (patch: Partial<TrailerStatus> = {}, settings: object = {}): TrailerStatus => ({
  exists: true,
  settings: {
    kind: 'story',
    targetSec: 30,
    title: '畫皮',
    author: '',
    tagline: '',
    endLine: '',
    narration: true,
    music: true,
    musicMood: '',
    musicBrief: '',
    sourceText: '',
    claims: [],
    sceneId: 'scene1',
    ...settings,
  },
  targetSec: 30,
  scriptSec: 30,
  beatCount: 3,
  matches: true,
  errors: [],
  warnings: [],
  ...patch,
})

const inScene = (n: number, patch: Partial<ShotView> = {}) =>
  beat(n, { sceneId: 'scene1', ...patch })

const open = (shots: ShotView[], extra: Record<string, unknown> = {}, aspect = '16:9') =>
  installFakeSvs({
    'shots.list': () => ({ shots, ...extra }),
    'project.current': () => ({ id: 'p', name: '我的專案', dir: '/tmp/p', aspectRatio: aspect }),
  })

describe('TrailerPage：預告片整頁', () => {
  it('標題列：書名 · 類型 · 長度；對不上目標時長度標警示', async () => {
    open([inScene(1)])
    const view = render(<TrailerPage status={status()} />)
    expect(screen.getByTestId('trailer-page-title').textContent).toBe('畫皮')
    expect(screen.getByTestId('trailer-page-kind').textContent).toBe('劇情')
    expect(screen.getByTestId('trailer-page-length').textContent).toBe('30／30 秒')
    expect(screen.getByTestId('trailer-page-length').dataset.matches).toBe('true')
    view.unmount()
    open([inScene(1)])
    render(<TrailerPage status={status({ matches: false, scriptSec: 28 })} />)
    expect(screen.getByTestId('trailer-page-length').dataset.matches).toBe('false')
  })

  it('書名沒填就用專案名', async () => {
    open([inScene(1)])
    render(<TrailerPage status={status({}, { title: '' })} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-page-title').textContent).toBe('我的專案')
    })
  })

  it('腳本是空的：中間放「做預告片」那張卡，不是空白一片', async () => {
    open([])
    render(<TrailerPage status={status({ beatCount: 0 })} />)
    expect(screen.getByTestId('trailer-start')).toBeTruthy()
  })

  it('只取預告片那個場的格子、依鏡號排；沒放進成品的不列', () => {
    const list = [
      inScene(3),
      beat(2, { sceneId: 'other' }),
      inScene(1),
      inScene(4, { inCut: false }),
    ]
    expect(trailerBeats(list, 'scene1').map((b) => b.number)).toEqual([1, 3])
    expect(trailerBeats(list, undefined)).toHaveLength(4)
  })

  it('播放器：沒有成品時顯示第一格：有影片播影片；只有首幀顯示圖；字卡用文字排出並標「示意」；什麼都沒有寫畫面描述', async () => {
    const check = async (first: Partial<ShotView>, testId: string) => {
      open([inScene(1, first)])
      const view = render(<TrailerPage status={status()} />)
      await waitFor(() => {
        expect(screen.getByTestId(testId)).toBeTruthy()
      })
      expect(screen.getByTestId('trailer-player').dataset.source).toBe('beat')
      const shown = screen.getByTestId(testId)
      view.unmount()
      return shown
    }
    expect(
      (await check({ videos: [take('v1')] }, 'trailer-player-video')).getAttribute('src'),
    ).toContain('v1')
    expect(
      (await check({ firstFrames: [take('f2')] }, 'trailer-player-image')).getAttribute('src'),
    ).toContain('f2')
    const mock = await check(
      { beatKind: 'card', card: { text: '有些光', subtext: '要有人陪你' } },
      'trailer-player-mock',
    )
    expect(mock.textContent).toContain('有些光')
    expect(mock.textContent).toContain('示意')
    expect((await check({ description: '一座斷橋' }, 'trailer-player-text')).textContent).toBe(
      '一座斷橋',
    )
  })

  it('有成品：播成品', async () => {
    open([inScene(1), inScene(2)], { finalVideoHash: 'final9' })
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-player').dataset.source).toBe('final')
    })
    expect(screen.getByTestId('trailer-player-video').getAttribute('src')).toContain('final9')
  })

  it('直式專案：播放器 9:16，置中', async () => {
    open([inScene(1)], {}, '9:16')
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-player').dataset.aspect).toBe('9:16')
    })
  })

  it('右邊是設定欄：同一份內容（書名、旁白、配樂），沒有「關閉」鈕也沒有浮出的標籤', () => {
    open([inScene(1)])
    render(<TrailerPage status={status()} />)
    const panel = screen.getByTestId('trailer-panel')
    expect(panel.closest('[data-testid="trailer-page-settings"]')).toBeTruthy()
    expect(screen.getByTestId('trailer-panel-narration')).toBeTruthy()
    expect(screen.queryByTestId('trailer-badge')).toBeNull()
    expect(screen.queryByText('關閉')).toBeNull()
  })
})
