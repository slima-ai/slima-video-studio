import type { ShotView, TakeView } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { choose, optionLabels } from '../../test/select'
import { ShotPanel } from './shot-panel'

afterEach(cleanup)

const HASH = (c: string): string => c.repeat(64)

const take = (
  kind: TakeView['kind'],
  version: number,
  extra: Partial<TakeView> = {},
): TakeView => ({
  id: `${kind}-${String(version)}`,
  kind,
  version,
  assetHash: HASH(kind === 'video' ? String(version) : 'f'),
  adopted: false,
  modelId: 'fal/kling-3.0-standard',
  seed: version - 1,
  createdAt: '2026-10-12T08:30:00.000Z',
  ...extra,
})

const shot = (extra: Partial<ShotView> = {}): ShotView => ({
  id: 's2',
  number: 2,
  description: '貓跳上窗台',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: '貓跳上窗台。日系動畫風格',
  status: 'done',
  firstFrames: [take('first_frame', 1, { adopted: true })],
  videos: [take('video', 1, { adopted: true })],
  ...extra,
})

const renderPanel = (value: ShotView = shot(), onClose = vi.fn()) => {
  render(<ShotPanel shot={value} onClose={onClose} />)
  return onClose
}

const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

describe('ShotPanel 內容', () => {
  it('顯示目前使用的影片、描述、自動組出的 Prompt 與版本', () => {
    installFakeSvs()
    renderPanel()
    expect(screen.getByRole('heading', { name: '第 2 鏡' })).toBeTruthy()
    expect(screen.getByTestId('shot-preview').getAttribute('src')).toBe(
      `svs-asset://asset/${HASH('1')}`,
    )
    expect(screen.getByTestId<HTMLTextAreaElement>('shot-description').value).toBe('貓跳上窗台')
    expect(screen.getByTestId<HTMLTextAreaElement>('shot-prompt').value).toBe(
      '貓跳上窗台。日系動畫風格',
    )
    expect(screen.getByText('（自動組出的）')).toBeTruthy()
    expect(screen.queryByTestId('shot-prompt-reset')).toBeNull()
    const version = screen.getByTestId('shot-version-1')
    expect(version.getAttribute('data-adopted')).toBe('true')
    expect(within(version).getByText('（目前使用）')).toBeTruthy()
  })

  it('還沒有影片時顯示首幀圖；什麼都沒有時說明還沒有畫面', () => {
    installFakeSvs()
    renderPanel(shot({ videos: [] }))
    expect(screen.queryByTestId('shot-preview')).toBeNull()
    expect(screen.getByTestId('shot-preview-image')).toBeTruthy()
    cleanup()
    renderPanel(shot({ videos: [], firstFrames: [] }))
    expect(screen.getByText('還沒有畫面')).toBeTruthy()
  })

  it('模型用白話名稱顯示', async () => {
    installFakeSvs({
      'models.list': () => ({
        models: [
          {
            id: 'fal/kling-3.0-standard',
            displayName: 'Kling 3.0 標準版',
            provider: 'fal',
            providerName: 'fal.ai',
            capabilities: ['i2v'],
            tier: 'balanced',
            recommended: true,
            priceLabel: '約 US$0.3／5 秒',
            priceShort: '每 5 秒約 US$1.5',
            priceVerified: true,
          },
        ],
        selected: {},
      }),
    })
    renderPanel()
    expect(await screen.findByText(/Kling 3.0 標準版/)).toBeTruthy()
  })

  it('手動改過的 Prompt 有標示，可以還原成自動組出的內容', () => {
    installFakeSvs()
    renderPanel(shot({ prompt: 'a cat leaps' }))
    expect(screen.getByText('（你改過的版本）')).toBeTruthy()
    expect(screen.getByTestId<HTMLTextAreaElement>('shot-prompt').value).toBe('a cat leaps')
    fireEvent.click(screen.getByTestId('shot-prompt-reset'))
    expect(screen.getByTestId<HTMLTextAreaElement>('shot-prompt').value).toBe(
      '貓跳上窗台。日系動畫風格',
    )
  })

  it('關閉鈕通知上層', () => {
    installFakeSvs()
    const onClose = renderPanel()
    fireEvent.click(screen.getByTestId('shot-panel-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('上一次失敗的原因會顯示；生成中時顯示進行到哪一步並可取消', () => {
    const svs = installFakeSvs()
    renderPanel(shot({ error: '內容被拒絕' }))
    expect(screen.getByTestId('shot-error').textContent).toContain('內容被拒絕')
    cleanup()

    renderPanel(shot({ activity: { step: 'video' }, status: 'generating' }))
    expect(screen.getByTestId('shot-activity').textContent).toContain('正在生成影片')
    expect(screen.queryByTestId('shot-error')).toBeNull()
    expect(screen.getByTestId('shot-apply').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('shot-regen-video').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('shot-cancel'))
    expect(svs.payloadsOf('shots.cancel')).toEqual([{ shotId: 's2' }])
  })
})

describe('ShotPanel 修改與重新生成', () => {
  it('沒改東西：不能只儲存；套用修改直接重新生成（不送 update）', async () => {
    const svs = installFakeSvs({ 'shots.regenerate': () => ({}) })
    renderPanel()
    expect(screen.getByTestId('shot-save').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('shot-apply'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.regenerate')).toEqual([{ shotId: 's2', mode: 'apply' }])
    })
    expect(svs.payloadsOf('shots.update')).toEqual([])
  })

  it('改了描述、運鏡、秒數 → 套用時先存只有改的欄位，再重新生成', async () => {
    const svs = installFakeSvs({
      'shots.update': () => shot(),
      'shots.regenerate': () => ({}),
    })
    renderPanel()
    type('shot-description', '貓跳上屋頂')
    choose('shot-camera', 'push_in')
    choose('shot-duration', '5')
    fireEvent.click(screen.getByTestId('shot-apply'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.regenerate')).toHaveLength(1)
    })
    expect(svs.payloadsOf('shots.update')).toEqual([
      {
        shotId: 's2',
        patch: { description: '貓跳上屋頂', cameraMove: 'push_in', durationSec: 5 },
      },
    ])
    expect(svs.payloadsOf('shots.regenerate')).toEqual([{ shotId: 's2', mode: 'apply' }])
  })

  it('只儲存修改：只送 update，不重新生成', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    renderPanel()
    type('shot-prompt', 'a cat on the roof')
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        { shotId: 's2', patch: { prompt: 'a cat on the roof' } },
      ])
    })
    expect(svs.payloadsOf('shots.regenerate')).toEqual([])
  })

  it('運鏡用選單：預設清單的中文名稱，選了顯示白話說明；選「不指定」存成 null', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    renderPanel(shot({ cameraMove: 'orbit' }))
    expect(screen.getByTestId('shot-camera').dataset.value).toBe('orbit')
    expect(optionLabels('shot-camera')).toEqual([
      '不指定',
      '固定',
      '推近',
      '拉遠',
      '左右搖',
      '上下搖',
      '環繞',
      '跟拍',
      '手持',
      '升降',
      '慢動作',
    ])
    expect(screen.getByTestId('shot-camera-hint').textContent).toBe('鏡頭繞著主體轉。')
    choose('shot-camera', 'pan')
    expect(screen.getByTestId('shot-camera-hint').textContent).toBe(
      '鏡頭站在原地，向左或向右轉動。',
    )
    choose('shot-camera', '')
    expect(screen.getByTestId('shot-camera-hint').textContent).toContain('由模型自己決定')
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        { shotId: 's2', patch: { cameraMove: null } },
      ])
    })
  })

  it('舊資料裡不在清單的運鏡（自己打的字）也看得到，不會被默默改掉', () => {
    installFakeSvs()
    renderPanel(shot({ cameraMove: '慢慢往右邊搖' }))
    expect(screen.getByTestId('shot-camera').dataset.value).toBe('慢慢往右邊搖')
    expect(optionLabels('shot-camera')).toContain('自訂：慢慢往右邊搖')
    expect(screen.getByTestId('shot-save').hasAttribute('disabled')).toBe(true)
  })

  it('描述清空不能儲存或重新生成', () => {
    installFakeSvs()
    renderPanel()
    type('shot-description', '   ')
    expect(screen.getByTestId('shot-save').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('shot-apply').hasAttribute('disabled')).toBe(true)
  })

  it('只換一支影片 / 整個鏡頭重做：各自用對應的方式', async () => {
    const svs = installFakeSvs({ 'shots.regenerate': () => ({}) })
    renderPanel()
    fireEvent.click(screen.getByTestId('shot-regen-video'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.regenerate')).toHaveLength(1)
    })
    fireEvent.click(screen.getByTestId('shot-regen-all'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.regenerate')).toHaveLength(2)
    })
    expect(svs.payloadsOf('shots.regenerate')).toEqual([
      { shotId: 's2', mode: 'video' },
      { shotId: 's2', mode: 'all' },
    ])
  })

  it('重新生成被拒絕（例如超過花費上限）→ 面板顯示原因，按鈕恢復可按', async () => {
    installFakeSvs({
      'shots.regenerate': () => {
        throw appError('預估花費超過單次執行的上限。')
      },
    })
    renderPanel()
    fireEvent.click(screen.getByTestId('shot-regen-all'))
    expect((await screen.findByTestId('shot-action-error')).textContent).toBe(
      '預估花費超過單次執行的上限。',
    )
    await waitFor(() => {
      expect(screen.getByTestId('shot-regen-all').hasAttribute('disabled')).toBe(false)
    })
  })

  it('存檔後內容更新，草稿跟著重設（不再顯示「有未儲存的修改」）', async () => {
    const svs = installFakeSvs({ 'shots.update': () => shot() })
    const { rerender } = render(<ShotPanel shot={shot()} onClose={vi.fn()} />)
    type('shot-description', '貓跳上屋頂')
    fireEvent.click(screen.getByTestId('shot-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toHaveLength(1)
    })
    act(() => {
      rerender(<ShotPanel shot={shot({ description: '貓跳上屋頂' })} onClose={vi.fn()} />)
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('shot-description').value).toBe('貓跳上屋頂')
    expect(screen.getByTestId('shot-save').hasAttribute('disabled')).toBe(true)
  })
})

describe('ShotPanel 版本', () => {
  const twoVersions = shot({
    videos: [take('video', 1), take('video', 2, { adopted: true })],
    firstFrames: [take('first_frame', 1), take('first_frame', 2, { adopted: true })],
  })

  it('新的版本排在前面；目前使用的不能再「使用」；舊版本可以切回去', async () => {
    const svs = installFakeSvs({ 'shots.adopt': () => shot() })
    renderPanel(twoVersions)
    const rows = within(screen.getByTestId('shot-versions')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'shot-version-2',
      'shot-version-1',
    ])
    expect(screen.getByTestId('shot-adopt-2').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('shot-adopt-1'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.adopt')).toEqual([{ takeId: 'video-1' }])
    })
  })

  it('預覽舊版本：播放器換成那一版，不會改動使用中的版本', () => {
    const svs = installFakeSvs()
    renderPanel(twoVersions)
    expect(screen.getByTestId('shot-preview').getAttribute('src')).toContain(HASH('2'))
    fireEvent.click(
      within(screen.getByTestId('shot-version-1')).getByRole('button', { name: '預覽' }),
    )
    expect(screen.getByTestId('shot-preview').getAttribute('src')).toContain(HASH('1'))
    expect(svs.payloadsOf('shots.adopt')).toEqual([])
  })

  it('首幀圖有多個版本時列出來，目前使用的有標示', () => {
    installFakeSvs()
    renderPanel(twoVersions)
    expect(within(screen.getByTestId('shot-frames')).getAllByRole('img')).toHaveLength(2)
  })

  it('切換版本失敗 → 顯示原因', async () => {
    installFakeSvs({
      'shots.adopt': () => {
        throw appError('找不到這個版本。')
      },
    })
    renderPanel(twoVersions)
    fireEvent.click(screen.getByTestId('shot-adopt-1'))
    expect((await screen.findByTestId('shot-action-error')).textContent).toBe('找不到這個版本。')
  })
})
