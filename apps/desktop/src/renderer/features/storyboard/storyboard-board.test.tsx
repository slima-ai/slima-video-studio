import type { OutlineView, ShotView, ShotsSnapshot, TakeView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { thumbnailHash } from './storyboard-board'
import { StoryboardPage } from './storyboard-page'

afterEach(cleanup)

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const take = (id: string, assetHash: string, adopted: boolean): TakeView => ({
  id,
  kind: 'first_frame',
  version: 1,
  assetHash,
  adopted,
  modelId: 'mock',
  createdAt: '2026-10-12T00:00:00.000Z',
})

const shot = (id: string, number: number, extra: Partial<ShotView> = {}): ShotView => ({
  id,
  number,
  description: `鏡頭 ${String(number)}`,
  action: '',
  cameraMove: null,
  durationSec: 3,
  characters: [],
  size: 'medium',
  angle: 'eye_level',
  dialogue: '',
  autoPrompt: 'p',
  status: 'draft',
  firstFrames: [],
  videos: [],
  ...extra,
})

const outline: OutlineView = {
  acts: [
    { id: 'a1', title: '開場', summary: '', scenes: [{ id: 'sc1', title: '街角', summary: '' }] },
  ],
  locations: [],
}

const snapshot = (...shots: ShotView[]): ShotsSnapshot => ({ shots })

describe('thumbnailHash', () => {
  it('優先用採用中的首幀圖，沒有採用的就用最新的，都沒有就沒有縮圖', () => {
    expect(thumbnailHash(shot('s', 1))).toBeUndefined()
    const frames = [take('t1', HASH_A, true), take('t2', HASH_B, false)]
    expect(thumbnailHash(shot('s', 1, { firstFrames: frames }))).toBe(HASH_A)
    expect(
      thumbnailHash(
        shot('s', 1, { firstFrames: [take('t1', HASH_A, false), take('t2', HASH_B, false)] }),
      ),
    ).toBe(HASH_B)
  })
})

describe('故事板檢視', () => {
  it('切換後顯示卡片：縮圖、鏡號、場、狀態；沒有畫面的寫「還沒有畫面」', async () => {
    installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () =>
        snapshot(
          shot('s1', 1, {
            sceneId: 'sc1',
            status: 'done',
            firstFrames: [take('t1', HASH_A, true)],
          }),
          shot('s2', 2, { error: '生成失敗', status: 'failed' }),
        ),
    })
    render(<StoryboardPage />)
    await screen.findAllByTestId('shot-row')
    fireEvent.click(screen.getByTestId('storyboard-view-board'))

    const cards = screen.getAllByTestId('board-card')
    expect(cards).toHaveLength(2)
    expect(screen.queryByTestId('storyboard-table')).toBeNull()
    const [first, second] = cards
    if (!first || !second) throw new Error('沒有卡片')
    expect(within(first).getByRole('img').getAttribute('src')).toContain(HASH_A)
    expect(within(first).getByTestId('board-scene').textContent).toBe('開場／街角')
    expect(within(first).getByTestId('board-status').textContent).toBe('已完成')
    expect(within(second).queryByRole('img')).toBeNull()
    expect(second.textContent).toContain('還沒有畫面')
    expect(within(second).getByTestId('board-status').textContent).toBe('失敗')
  })

  it('在卡片上改描述、景別、角度、秒數會送出；描述清空或秒數超出範圍不送', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1)),
      'shots.update': () => shot('s1', 1),
    })
    render(<StoryboardPage />)
    await screen.findByTestId('shot-row')
    fireEvent.click(screen.getByTestId('storyboard-view-board'))
    const card = screen.getByTestId('board-card')
    const text = within(card).getByTestId('board-description')

    fireEvent.change(text, { target: { value: '   ' } })
    fireEvent.blur(text)
    fireEvent.change(text, { target: { value: '阿鐵回頭' } })
    fireEvent.blur(text)
    fireEvent.change(within(card).getByTestId('cell-board-size'), { target: { value: 'close_up' } })
    fireEvent.change(within(card).getByTestId('cell-board-angle'), { target: { value: 'low' } })
    const seconds = within(card).getByTestId('cell-board-duration')
    fireEvent.change(seconds, { target: { value: '99' } })
    fireEvent.blur(seconds)
    fireEvent.change(seconds, { target: { value: '6' } })
    fireEvent.blur(seconds)

    await waitFor(() => {
      expect(svs.payloadsOf('shots.update').map((p) => p.patch)).toEqual([
        { description: '阿鐵回頭' },
        { size: 'close_up' },
        { angle: 'low' },
        { durationSec: 6 },
      ])
    })
  })

  it('跟表格共用資料與勾選：事件推來的新內容兩邊都看得到，勾選切換檢視後還在', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1), shot('s2', 2)),
    })
    render(<StoryboardPage />)
    await screen.findAllByTestId('shot-row')

    const [, secondRow] = screen.getAllByTestId('row-select')
    if (!secondRow) throw new Error('沒有第二列')
    fireEvent.click(secondRow)
    fireEvent.click(screen.getByTestId('storyboard-view-board'))
    const boxes = screen.getAllByTestId<HTMLInputElement>('board-select')
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
    expect(screen.getByTestId('storyboard-generate').textContent).toContain('（1）')

    // 在故事板勾第一張，回表格也要是勾著的
    const [firstBox] = boxes
    if (!firstBox) throw new Error('沒有勾選框')
    fireEvent.click(firstBox)
    expect(screen.getByTestId('storyboard-generate').textContent).toContain('（2）')

    // 別處（例如 AI 或表格）改了描述：推送後故事板與表格都更新
    svs.emit('shots.changed', snapshot(shot('s1', 1, { description: '新描述' }), shot('s2', 2)))
    await waitFor(() => {
      expect(screen.getAllByTestId<HTMLTextAreaElement>('board-description')[0]?.value).toBe(
        '新描述',
      )
    })
    fireEvent.click(screen.getByTestId('storyboard-view-table'))
    expect(screen.getAllByTestId<HTMLInputElement>('cell-description')[0]?.value).toBe('新描述')
    expect(screen.getAllByTestId<HTMLInputElement>('row-select').map((b) => b.checked)).toEqual([
      true,
      true,
    ])
  })
})
