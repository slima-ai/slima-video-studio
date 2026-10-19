import type { OutlineView } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/toast'
import { HistoryProvider } from '../../lib/history'
import { appError, installFakeSvs } from '../../test/fake-svs'
import { OutlinePage } from './outline-page'

afterEach(cleanup)

const outline = (extra: Partial<OutlineView> = {}): OutlineView => ({
  acts: [
    {
      id: 'a1',
      title: '開場',
      summary: '雨夜',
      scenes: [
        { id: 's1', title: '街角', summary: '撐傘', locationId: 'l1', mood: '安靜' },
        { id: 's2', title: '紙箱', summary: '' },
      ],
    },
    { id: 'a2', title: '回家', summary: '', scenes: [{ id: 's3', title: '公寓', summary: '' }] },
  ],
  locations: [{ id: 'l1', name: '舊街', description: '濕漉漉' }],
  ...extra,
})

describe('OutlinePage', () => {
  it('沒有大綱時說明怎麼開始；新增第一幕後出現卡片', async () => {
    const edit = vi.fn(() => ({
      acts: [{ id: 'a1', title: '第 1 幕', summary: '', scenes: [] }],
      locations: [],
    }))
    const svs = installFakeSvs({ 'outline.edit': edit })
    render(<OutlinePage />)
    expect(await screen.findByTestId('outline-empty')).toBeTruthy()

    fireEvent.click(screen.getByTestId('act-add'))
    expect(await screen.findByTestId('act-card')).toBeTruthy()
    expect(screen.queryByTestId('outline-empty')).toBeNull()
    expect(svs.payloadsOf('outline.edit')).toEqual([{ op: 'addAct' }])
  })

  it('離開輸入框才儲存；沒改的欄位不送出', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline(),
      'outline.edit': () => outline(),
    })
    render(<OutlinePage />)
    const [first] = await screen.findAllByTestId('scene-title')
    if (!first) throw new Error('沒有場')

    fireEvent.change(first, { target: { value: '街角咖啡店' } })
    expect(svs.payloadsOf('outline.edit')).toEqual([])
    fireEvent.blur(first)
    await waitFor(() => {
      expect(svs.payloadsOf('outline.edit')).toEqual([
        { op: 'updateScene', sceneId: 's1', patch: { title: '街角咖啡店' } },
      ])
    })

    // 沒有改動就失焦：不送出
    const [summary] = screen.getAllByTestId('scene-summary')
    if (!summary) throw new Error('沒有摘要')
    fireEvent.blur(summary)
    expect(svs.payloadsOf('outline.edit')).toHaveLength(1)
  })

  it('地點下拉選單、清掉時間／氣氛、搬動與刪除都送出對應的動作', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline(),
      'outline.edit': () => outline(),
    })
    render(<OutlinePage />)
    const cards = await screen.findAllByTestId('scene-card')
    const card = cards[0]
    if (!card) throw new Error('沒有場')

    fireEvent.change(within(card).getByTestId('scene-location'), { target: { value: '' } })
    fireEvent.change(within(card).getByTestId('scene-mood'), { target: { value: ' ' } })
    fireEvent.blur(within(card).getByTestId('scene-mood'))
    fireEvent.click(within(card).getByTestId('scene-move-down'))
    fireEvent.click(within(card).getByTestId('scene-delete'))

    await waitFor(() => {
      expect(svs.payloadsOf('outline.edit')).toEqual([
        { op: 'updateScene', sceneId: 's1', patch: { locationId: null } },
        { op: 'updateScene', sceneId: 's1', patch: { mood: null } },
        { op: 'moveScene', sceneId: 's1', direction: 'down' },
        { op: 'deleteScene', sceneId: 's1' },
      ])
    })
    // 第一個場不能再往前移、最後一個場不能再往後移
    expect(within(card).getByTestId('scene-move-up').hasAttribute('disabled')).toBe(true)
    const last = screen.getAllByTestId('scene-card')[2]
    expect(last && within(last).getByTestId('scene-move-down').hasAttribute('disabled')).toBe(true)
  })

  it('刪除一幕要先確認；只有一幕時不顯示「屬於哪一幕」', async () => {
    const svs = installFakeSvs({
      'outline.get': () => outline(),
      'outline.edit': () => outline(),
    })
    render(<OutlinePage />)
    const [first] = await screen.findAllByTestId('act-card')
    if (!first) throw new Error('沒有幕')
    expect(within(first).getAllByTestId('scene-act')).toHaveLength(2)

    fireEvent.click(within(first).getByTestId('act-delete'))
    expect(within(first).getByText('確定刪除這一幕和它的 2 個場？')).toBeTruthy()
    expect(svs.payloadsOf('outline.edit')).toEqual([])
    fireEvent.click(within(first).getByTestId('act-delete-confirm'))
    await waitFor(() => {
      expect(svs.payloadsOf('outline.edit')).toEqual([{ op: 'deleteAct', actId: 'a1' }])
    })
  })

  it('AI 拆成分場：顯示預估花費；已有大綱要先確認；完成後列出新增的角色與地點', async () => {
    const split = vi.fn(() => ({
      outline: outline(),
      newCharacters: ['阿鐵'],
      newLocations: ['舊街'],
    }))
    const svs = installFakeSvs({
      'outline.get': () => outline(),
      'outline.splitCheck': () => ({
        ok: true,
        estimatedUsd: 0.03,
        demoMode: false,
        replacesExisting: true,
        modelName: 'Test LLM',
      }),
      'outline.split': split,
    })
    render(<OutlinePage />)
    await screen.findAllByTestId('act-card')
    expect(screen.getByTestId('outline-split').hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByTestId('outline-split-text'), { target: { value: '一個故事' } })
    await waitFor(() => {
      expect(screen.getByTestId('outline-split-cost').textContent).toBe(
        '預估約 US$0.03（Test LLM）',
      )
    })
    fireEvent.click(screen.getByTestId('outline-split'))
    // 已經有大綱：先確認，還沒呼叫
    expect(await screen.findByTestId('outline-split-confirm')).toBeTruthy()
    expect(split).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('outline-split-confirm-yes'))
    await waitFor(() => {
      expect(screen.getByTestId('outline-split-result').textContent).toContain('阿鐵')
    })
    expect(screen.getByTestId('outline-split-result').textContent).toContain('舊街')
    expect(svs.payloadsOf('outline.split')).toEqual([{ text: '一個故事' }])
    expect(screen.getByTestId<HTMLTextAreaElement>('outline-split-text').value).toBe('')
  })

  it('不能拆時按鈕停用並說明原因；拆失敗時顯示白話錯誤', async () => {
    installFakeSvs({
      'outline.splitCheck': () => ({
        ok: false,
        issue: '還沒有可用的文字模型',
        estimatedUsd: 0,
        demoMode: false,
        replacesExisting: false,
      }),
    })
    render(<OutlinePage />)
    fireEvent.change(await screen.findByTestId('outline-split-text'), { target: { value: '故事' } })
    await waitFor(() => {
      expect(screen.getByTestId('outline-split-cost').textContent).toBe('還沒有可用的文字模型')
    })
    expect(screen.getByTestId('outline-split').hasAttribute('disabled')).toBe(true)
    cleanup()

    installFakeSvs({
      'outline.split': () => {
        throw appError('文字太長了')
      },
    })
    render(<OutlinePage />)
    fireEvent.change(await screen.findByTestId('outline-split-text'), { target: { value: '故事' } })
    await waitFor(() => {
      expect(screen.getByTestId('outline-split').hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByTestId('outline-split'))
    expect((await screen.findByRole('alert')).textContent).toContain('文字太長了')
  })

  it('載入中先顯示骨架，載入好就換成內容', async () => {
    let finish: (value: OutlineView) => void = () => undefined
    installFakeSvs({
      'outline.get': () =>
        new Promise<OutlineView>((resolve) => {
          finish = resolve
        }),
    })
    render(<OutlinePage />)
    expect(screen.getByTestId('outline-loading').getAttribute('role')).toBe('status')
    await act(async () => {
      finish(outline())
      await Promise.resolve()
    })
    expect(await screen.findAllByTestId('act-card')).toHaveLength(2)
    expect(screen.queryByTestId('outline-loading')).toBeNull()
  })

  it('刪除一幕的確認：按 Esc 等於「不刪」，不會送出任何東西', async () => {
    const svs = installFakeSvs({ 'outline.get': () => outline() })
    render(<OutlinePage />)
    const [first] = await screen.findAllByTestId('act-card')
    if (!first) throw new Error('沒有幕')
    fireEvent.click(within(first).getByTestId('act-delete'))
    expect(within(first).getByTestId('act-delete-confirm')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(within(first).queryByTestId('act-delete-confirm')).toBeNull()
    expect(svs.payloadsOf('outline.edit')).toEqual([])
  })

  it('復原／重做之後（history.changed 的 revision 變了）重新載入大綱', async () => {
    let current = outline()
    const svs = installFakeSvs({ 'outline.get': () => current })
    render(
      <ToastProvider>
        <HistoryProvider enabled>
          <OutlinePage />
        </HistoryProvider>
      </ToastProvider>,
    )
    expect(await screen.findAllByTestId('act-card')).toHaveLength(2)
    current = { acts: [], locations: [] }
    act(() => {
      svs.emit('history.changed', { canUndo: false, canRedo: true, revision: 1 })
    })
    expect(await screen.findByTestId('outline-empty')).toBeTruthy()
  })
})
