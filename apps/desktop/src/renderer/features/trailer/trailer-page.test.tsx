import type { ShotView, TrailerStatus } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { ChatProvider } from '../chat/chat-context'
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
  it('標題列：書名 · 類型 · 長度；對不上目標時長度標警示', () => {
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

  it('腳本是空的：中間放「做預告片」那張卡，不是空白一片', () => {
    open([])
    render(<TrailerPage status={status({ beatCount: 0 })} />)
    expect(screen.getByTestId('trailer-start')).toBeTruthy()
    expect(screen.queryByTestId('script-strip')).toBeNull()
  })

  it('只取預告片那個場的格子、依鏡號排；沒放進成品的不列', () => {
    const list = [
      inScene(3),
      beat(2, { sceneId: 'other' }),
      inScene(1),
      inScene(4, { inCut: false }),
    ]
    expect(trailerBeats(list, 'scene1').map((b) => b.number)).toEqual([1, 3])
    expect(trailerBeats(list, undefined)).toHaveLength(3)
  })

  it('點一格選它（播放器換成那一格）；← → 換格；打字時不搶按鍵', async () => {
    open([
      inScene(1, { description: '第一格描述' }),
      inScene(2, { description: '第二格描述' }),
      inScene(3, { description: '第三格描述' }),
    ])
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('strip-cell-0')).toBeTruthy()
    })
    expect(screen.getByTestId('trailer-player-text').textContent).toBe('第一格描述')
    fireEvent.click(screen.getByTestId('strip-cell-1'))
    expect(screen.getByTestId('trailer-player-text').textContent).toBe('第二格描述')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('trailer-player-text').textContent).toBe('第三格描述')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('trailer-player-text').textContent).toBe('第一格描述')
    // 設定欄的輸入框裡按 ←：不換格
    fireEvent.keyDown(screen.getByTestId('trailer-panel-title'), { key: 'ArrowRight' })
    expect(screen.getByTestId('trailer-player-text').textContent).toBe('第一格描述')
  })

  it('播放器：沒有成品時，有影片播那一格的影片、只有首幀顯示圖、字卡用文字排出並標「示意」', async () => {
    open([
      inScene(1, { videos: [take('v1')] }),
      inScene(2, { firstFrames: [take('f2')] }),
      inScene(3, { beatKind: 'card', card: { text: '有些光', subtext: '要有人陪你' } }),
    ])
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-player-video').getAttribute('src')).toContain('v1')
    })
    expect(screen.getByTestId('trailer-player').dataset.source).toBe('beat')
    fireEvent.click(screen.getByTestId('strip-cell-1'))
    expect(screen.getByTestId('trailer-player-image').getAttribute('src')).toContain('f2')
    fireEvent.click(screen.getByTestId('strip-cell-2'))
    expect(screen.getByTestId('trailer-player-mock').textContent).toContain('有些光')
    expect(screen.getByTestId('trailer-player-mock').textContent).toContain('示意')
  })

  it('有成品：播成品，腳本條上有播放線', async () => {
    open([inScene(1), inScene(2)], { finalVideoHash: 'final9' })
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-player').dataset.source).toBe('final')
    })
    expect(screen.getByTestId('trailer-player-video').getAttribute('src')).toContain('final9')
    fireEvent.timeUpdate(screen.getByTestId('trailer-player-video'), { target: { currentTime: 3 } })
    expect(screen.getByTestId('strip-playhead')).toBeTruthy()
    // 播到第 2 格（2 秒起）：選取跟著走
    expect(screen.getByTestId('strip-cell-1').getAttribute('aria-pressed')).toBe('true')
  })

  it('直式專案：播放器 9:16，置中', async () => {
    open([inScene(1)], {}, '9:16')
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('trailer-player').dataset.aspect).toBe('9:16')
    })
  })

  it('右邊是設定欄：同一份內容（書名、旁白、配樂），沒有「關閉」鈕也沒有浮出的標籤', async () => {
    open([inScene(1)])
    render(<TrailerPage status={status()} />)
    const panel = await screen.findByTestId('trailer-panel')
    expect(panel.closest('[data-testid="trailer-page-settings"]')).toBeTruthy()
    expect(screen.getByTestId('trailer-panel-narration')).toBeTruthy()
    expect(screen.queryByTestId('trailer-badge')).toBeNull()
    expect(screen.queryByText('關閉')).toBeNull()
  })

  it('右上角有 Claude 的入口（跟畫布頁同一個，功能打開時才出現）', async () => {
    installFakeSvs({
      'shots.list': () => ({ shots: [inScene(1)] }),
      'app.getInfo': () => ({ name: 'x', version: '0', platform: 'darwin', packaged: false }),
      'chat.status': () => ({ state: 'ready', version: '2.1.304' }),
      'chat.list': () => ({ conversations: [] }),
    })
    render(
      <ChatProvider>
        <TrailerPage status={status()} />
      </ChatProvider>,
    )
    expect(await screen.findByTestId('chat-launcher')).toBeTruthy()
  })

  it('選到哪一格，下面的編輯區就是那一格（字卡格沒有畫面描述與旁白）', async () => {
    open([
      inScene(1, { description: '第一格描述' }),
      inScene(2, { beatKind: 'card', card: { text: '有些光', subtext: '' } }),
    ])
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLTextAreaElement>('beat-description').value).toBe('第一格描述')
    })
    fireEvent.click(screen.getByTestId('strip-cell-1'))
    expect(screen.getByTestId('beat-editor').dataset.kind).toBe('card')
    expect(screen.getByTestId<HTMLInputElement>('beat-card-text').value).toBe('有些光')
    expect(screen.queryByTestId('beat-description')).toBeNull()
    expect(screen.queryByTestId('beat-narration')).toBeNull()
  })

  it('在格子上按右鍵：選單的動作各打對的通道；加字卡之後選到新的那一格', async () => {
    const update = vi.fn(() => beat(1))
    const addCard = vi.fn(() => inScene(9, { beatKind: 'card' }))
    const remove = vi.fn(() => ({ shots: [] }))
    installFakeSvs({
      'shots.list': () => ({ shots: [inScene(1), inScene(2)] }),
      'shots.update': update,
      'trailer.addCard': addCard,
      'shots.delete': remove,
    })
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('strip-cell-1')).toBeTruthy()
    })
    const open = (): void => {
      fireEvent.contextMenu(screen.getByTestId('strip-cell-1'))
    }
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /不動/ }))
    expect(update).toHaveBeenCalledWith({ shotId: 's2', patch: { beatKind: 'still' } })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /在後面加一張字卡/ }))
    expect(addCard).toHaveBeenCalledWith({ afterShotId: 's2', text: '新字卡' })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /刪掉這一格/ }))
    expect(remove).toHaveBeenCalledWith({ shotIds: ['s2'] })
  })

  it('選單的動作失敗：那句白話寫在腳本條下面', async () => {
    installFakeSvs({
      'shots.list': () => ({ shots: [inScene(1), inScene(2)] }),
      'shots.delete': () => {
        throw appError('刪不掉。')
      },
    })
    render(<TrailerPage status={status()} />)
    await waitFor(() => {
      expect(screen.getByTestId('strip-cell-1')).toBeTruthy()
    })
    fireEvent.contextMenu(screen.getByTestId('strip-cell-1'))
    fireEvent.click(screen.getByRole('menuitem', { name: /刪掉這一格/ }))
    expect((await screen.findByTestId('strip-menu-error')).textContent).toBe('刪不掉。')
  })
})
