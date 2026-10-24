import type {
  OutlineView,
  ShotBatchCheck,
  ShotBatchResult,
  ShotView,
  ShotsSnapshot,
} from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { HistoryProvider } from '../../lib/history'
import { installFakeSvs } from '../../test/fake-svs'
import { parseNames } from './labels'
import { StoryboardPage } from './storyboard-page'

afterEach(cleanup)

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
    {
      id: 'a1',
      title: '開場',
      summary: '',
      scenes: [
        { id: 'sc1', title: '街角', summary: '' },
        { id: 'sc2', title: '紙箱', summary: '' },
      ],
    },
  ],
  locations: [{ id: 'l1', name: '舊街', description: '' }],
}

const snapshot = (...shots: ShotView[]): ShotsSnapshot => ({ shots })

describe('parseNames', () => {
  it('用頓號、逗號分開，去掉空白與空項目', () => {
    expect(parseNames('阿鐵、小花, 路人，')).toEqual(['阿鐵', '小花', '路人'])
    expect(parseNames('  ')).toEqual([])
  })
})

describe('StoryboardPage', () => {
  it('沒有鏡頭時說明怎麼開始；新增後接在最後一個鏡頭後面並沿用它的場', async () => {
    const created = shot('s1', 1)
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.create': () => created,
    })
    render(<StoryboardPage />)
    expect(await screen.findByTestId('storyboard-empty')).toBeTruthy()

    svs.emit('shots.changed', snapshot(shot('s1', 1, { sceneId: 'sc1' })))
    expect(await screen.findAllByTestId('shot-row')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('storyboard-add'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.create')).toEqual([{ sceneId: 'sc1', afterShotId: 's1' }])
    })
  })

  it('「成品用到」唯讀欄：沒有影片是「—」、沒裁是整支、裁過是留下的那一段；不能編輯', async () => {
    const video = (extra: Record<string, unknown> = {}) => ({
      id: `v${String(Math.random())}`,
      kind: 'video' as const,
      version: 1,
      assetHash: 'a'.repeat(64),
      adopted: true,
      modelId: 'm',
      createdAt: '2026-10-24T00:00:00.000Z',
      videoSec: 5.041667,
      ...extra,
    })
    installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () =>
        snapshot(
          shot('s1', 1),
          shot('s2', 2, { videos: [video()] }),
          shot('s3', 3, { videos: [video({ trim: { outSec: 3.5 } })] }),
          shot('s4', 4, { videos: [video({ trim: { inSec: 1, outSec: 3.5 } })] }),
        ),
    })
    render(<StoryboardPage />)
    await screen.findAllByTestId('shot-row')
    const cells = (await screen.findAllByTestId('shot-used')).map((c) => c.textContent)
    expect(cells).toEqual(['—', '0.0–5.042', '0.0–3.5', '1.0–3.5'])
    expect(screen.getAllByTestId('shot-used')[0]?.tagName).toBe('SPAN')
    expect(screen.getByRole('columnheader', { name: '成品用到' })).toBeTruthy()
  })

  it('欄位離開才存；沒改不送出；Enter 存並跳到下一列同一欄；Esc 放棄', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1), shot('s2', 2)),
      'shots.update': () => shot('s1', 1),
    })
    render(<StoryboardPage />)
    const cells = await screen.findAllByTestId('cell-description')
    const [first, second] = cells
    if (!first || !second) throw new Error('沒有欄位')

    fireEvent.blur(first)
    expect(svs.payloadsOf('shots.update')).toEqual([])

    fireEvent.change(first, { target: { value: '改過的描述' } })
    expect(svs.payloadsOf('shots.update')).toEqual([])
    first.focus()
    fireEvent.keyDown(first, { key: 'Enter' })
    await waitFor(() => {
      expect(svs.payloadsOf('shots.update')).toEqual([
        { shotId: 's1', patch: { description: '改過的描述' } },
      ])
    })
    expect(document.activeElement).toBe(second)

    fireEvent.change(second, { target: { value: '不要了' } })
    fireEvent.keyDown(second, { key: 'Escape' })
    expect((second as HTMLInputElement).value).toBe('鏡頭 2')
    fireEvent.blur(second)
    expect(svs.payloadsOf('shots.update')).toHaveLength(1)
  })

  it('下拉選單與文字欄位送出對應的欄位：景別、角度、運鏡、場、地點、角色、光線、時段', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1, { sceneId: 'sc1', cameraMove: 'push_in' })),
      'shots.update': () => shot('s1', 1),
    })
    render(<StoryboardPage />)
    const row = await screen.findByTestId('shot-row')
    const cell = (name: string): HTMLElement => within(row).getByTestId(`cell-${name}`)

    fireEvent.change(cell('size'), { target: { value: 'close_up' } })
    fireEvent.change(cell('angle'), { target: { value: 'side' } })
    fireEvent.change(cell('camera'), { target: { value: '' } })
    fireEvent.change(cell('scene'), { target: { value: 'sc2' } })
    fireEvent.change(cell('location'), { target: { value: 'l1' } })
    fireEvent.change(cell('characters'), { target: { value: '阿鐵、小花' } })
    fireEvent.blur(cell('characters'))
    fireEvent.change(cell('lighting'), { target: { value: '逆光' } })
    fireEvent.blur(cell('lighting'))
    fireEvent.change(cell('time'), { target: { value: '黃昏' } })
    fireEvent.blur(cell('time'))
    fireEvent.change(cell('duration'), { target: { value: '5' } })
    fireEvent.blur(cell('duration'))
    fireEvent.change(cell('duration'), { target: { value: '99' } })
    fireEvent.blur(cell('duration'))

    await waitFor(() => {
      expect(svs.payloadsOf('shots.update').map((p) => p.patch)).toEqual([
        { size: 'close_up' },
        { angle: 'side' },
        { cameraMove: null },
        { sceneId: 'sc2' },
        { locationId: 'l1' },
        { characters: ['阿鐵', '小花'] },
        { lighting: '逆光' },
        { timeOfDay: '黃昏' },
        { durationSec: 5 },
      ])
    })
  })

  it('選取多列：生成前先看預估與略過幾個，勾選「略過已生成」會重新檢查；刪除也要先確認', async () => {
    const check = (skipGenerated: boolean): ShotBatchCheck => ({
      ok: true,
      willGenerate: skipGenerated ? 1 : 2,
      skippedGenerated: skipGenerated ? 1 : 0,
      skippedBusy: 0,
      skippedNoFrame: 0,
      estimatedUsd: skipGenerated ? 0.5 : 1,
      estimateIsLowerBound: false,
      demoMode: false,
      models: { image: '圖片模型', video: '影片模型' },
    })
    const batchCheck = vi.fn((payload: { skipGenerated: boolean }) => check(payload.skipGenerated))
    const result: ShotBatchResult = {
      started: 1,
      skippedGenerated: 1,
      skippedBusy: 0,
      failed: [{ shotId: 's2', number: 2, error: '還沒有可用的圖片或影片模型' }],
    }
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1), shot('s2', 2), shot('s3', 3)),
      'shots.batchCheck': batchCheck,
      'shots.generateBatch': () => result,
      'shots.delete': () => snapshot(shot('s3', 1)),
    })
    render(<StoryboardPage />)
    const boxes = await screen.findAllByTestId('row-select')
    expect(screen.getByTestId('storyboard-generate').hasAttribute('disabled')).toBe(true)

    for (const box of boxes.slice(0, 2)) fireEvent.click(box)
    expect(screen.getByTestId('storyboard-generate').textContent).toContain('（2）')

    fireEvent.click(screen.getByTestId('storyboard-generate'))
    const info = screen.getByTestId('storyboard-batch-info')
    await waitFor(() => {
      expect(info.textContent).toContain('會生成 1 個鏡頭（略過 1 個已經生成過）')
    })
    expect(info.textContent).toContain('US$0.50')
    expect(svs.payloadsOf('shots.generateBatch')).toEqual([])

    fireEvent.click(screen.getByTestId('storyboard-batch-skip'))
    await waitFor(() => {
      expect(screen.getByTestId('storyboard-batch-info').textContent).toContain('會生成 2 個鏡頭')
    })
    expect(svs.payloadsOf('shots.batchCheck').map((p) => p.skipGenerated)).toEqual([true, false])

    // 先出草稿：整批用經濟組的模型，重新估價
    fireEvent.click(screen.getByTestId('storyboard-batch-draft'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.batchCheck').map((p) => p.draft)).toEqual([false, false, true])
    })

    fireEvent.click(await screen.findByTestId('storyboard-generate-confirm'))
    await waitFor(() => {
      expect(screen.getByTestId('storyboard-notice').textContent).toBe('已開始生成 1 個鏡頭。')
    })
    expect(svs.payloadsOf('shots.generateBatch')).toEqual([
      { shotIds: ['s1', 's2'], skipGenerated: false, draft: true },
    ])
    expect((await screen.findByRole('alert')).textContent).toContain('第 2 鏡')
    expect(screen.getByRole('alert').textContent).toContain('還沒有可用的圖片或影片模型')

    fireEvent.click(screen.getByTestId('storyboard-delete'))
    expect(svs.payloadsOf('shots.delete')).toEqual([])
    fireEvent.click(screen.getByTestId('storyboard-delete-confirm'))
    await waitFor(() => {
      expect(svs.payloadsOf('shots.delete')).toEqual([{ shotIds: ['s1', 's2'] }])
    })
  })

  it('讓 AI 拆這個場：已有鏡頭要先確認，並說明有幾個生成過；沒有場時引導去大綱', async () => {
    const split = vi.fn(() => snapshot(shot('n1', 1)))
    const svs = installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1)),
      'storyboard.splitCheck': () => ({
        ok: true,
        estimatedUsd: 0.02,
        demoMode: false,
        existingShots: 3,
        generatedShots: 2,
        modelName: 'Test LLM',
      }),
      'storyboard.splitScene': split,
    })
    render(<StoryboardPage />)
    await waitFor(() => {
      expect(screen.getByTestId('storyboard-split-cost').textContent).toBe(
        '預估約 US$0.02（Test LLM）',
      )
    })
    fireEvent.click(screen.getByTestId('storyboard-split-run'))
    const confirm = await screen.findByTestId('storyboard-split-confirm')
    expect(confirm.textContent).toContain('這個場目前有 3 個鏡頭，其中 2 個已經生成過')
    expect(split).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('storyboard-split-confirm-yes'))
    await waitFor(() => {
      expect(svs.payloadsOf('storyboard.splitScene')).toEqual([{ sceneId: 'sc1' }])
    })
    cleanup()

    installFakeSvs({ 'shots.list': () => snapshot() })
    render(<StoryboardPage />)
    expect(await screen.findByTestId('storyboard-no-scenes')).toBeTruthy()
  })
})

describe('StoryboardPage：批次生成不能開始時', () => {
  it('檢查沒過就只顯示原因，不出現開始按鈕；按「先不要」收起', async () => {
    installFakeSvs({
      'outline.get': () => outline,
      'shots.list': () => snapshot(shot('s1', 1)),
      'shots.batchCheck': (): ShotBatchCheck => ({
        ok: false,
        issue: '選取的鏡頭都已經生成過了。',
        willGenerate: 0,
        skippedGenerated: 1,
        skippedBusy: 0,
        skippedNoFrame: 0,
        estimatedUsd: 0,
        estimateIsLowerBound: false,
        demoMode: false,
        models: {},
      }),
    })
    render(<StoryboardPage />)
    fireEvent.click(await screen.findByTestId('row-select'))
    fireEvent.click(screen.getByTestId('storyboard-generate'))
    await waitFor(() => {
      expect(screen.getByTestId('storyboard-batch-info').textContent).toBe(
        '選取的鏡頭都已經生成過了。',
      )
    })
    expect(screen.queryByTestId('storyboard-generate-confirm')).toBeNull()
    fireEvent.click(screen.getByTestId('storyboard-batch-cancel'))
    expect(screen.queryByTestId('storyboard-batch')).toBeNull()
  })

  it('刪除選取的確認：按 Esc 等於「不刪」', async () => {
    const svs = installFakeSvs({
      'shots.list': () => snapshot(shot('s1', 1)),
      'outline.get': () => outline,
    })
    render(<StoryboardPage />)
    fireEvent.click(await screen.findByTestId('row-select'))
    fireEvent.click(screen.getByTestId('storyboard-delete'))
    expect(screen.getByTestId('storyboard-delete-confirm')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('storyboard-delete-confirm')).toBeNull()
    expect(svs.payloadsOf('shots.delete')).toEqual([])
  })

  it('標題旁有復原／重做；復原之後（revision 變了）重新載入鏡頭清單', async () => {
    let current = snapshot(shot('s1', 1), shot('s2', 2))
    const svs = installFakeSvs({ 'shots.list': () => current, 'outline.get': () => outline })
    render(
      <ToastProvider>
        <HistoryProvider enabled>
          <StoryboardPage />
        </HistoryProvider>
      </ToastProvider>,
    )
    expect(await screen.findAllByTestId('shot-row')).toHaveLength(2)
    expect(screen.getByTestId('history-undo')).toBeTruthy()

    current = snapshot(shot('s1', 1))
    act(() => {
      svs.emit('history.changed', { canUndo: false, canRedo: true, revision: 1 })
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('shot-row')).toHaveLength(1)
    })
  })
})
