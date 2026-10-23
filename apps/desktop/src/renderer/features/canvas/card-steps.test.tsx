import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CanvasActionsContext, type CanvasActions } from './canvas-actions'
import type { CanvasNode, CanvasNodeData } from './canvas-model'
import { CardNode } from './nodes'

afterEach(cleanup)

// jsdom 沒有 ResizeObserver，React Flow 需要
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

const shot = (tags: string[]): CanvasNodeData => ({
  kind: 'shot',
  title: '第 7 鏡',
  summary: 'Medium shot at the end of a broken bridge',
  action: 'The small yellow dome snaps up',
  dialogue: '小饅頭縱身一躍',
  meta: 'Medium · Low · 5 sec',
  tags,
  lockedTags: Object.fromEntries(tags.map((tag) => [tag, 2])),
})

function renderShot(tags: string[]) {
  const actions: CanvasActions = { focusNode: vi.fn(), toggleInCut: vi.fn(), toggleSteps: vi.fn() }
  const node: CanvasNode = {
    id: 'shot:7',
    type: 'card',
    position: { x: 0, y: 0 },
    data: shot(tags),
  }
  return render(
    <CanvasActionsContext.Provider value={actions}>
      <ReactFlowProvider>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ card: CardNode }} />
      </ReactFlowProvider>
    </CanvasActionsContext.Provider>,
  )
}

describe('鏡頭卡的「展開步驟」', () => {
  // 以前它浮在卡片右下角（absolute），角色標籤排到最後一排時兩個疊在一起（中英文都會，鏡頭有兩個以上角色就中）。
  // jsdom 量不到版面，所以檢查結構：它在卡片最下面自己的一行（shrink-0，內文放不下時被裁的是內文），
  // 跟角色標籤不在同一塊內文裡，也不是浮在內文上面。
  const TAG_SETS = [
    ['小饅頭（Little Bun）'],
    ['小饅頭（Little Bun）', '獸人史萊姆（Orc Slime）'],
    [
      '小饅頭（Little Bun）',
      '獸人史萊姆（Orc Slime）',
      '黑藤長老（Elder Black Vine）',
      '紅光（Red Light）',
    ],
  ]

  for (const tags of TAG_SETS) {
    it(`${String(tags.length)} 個角色標籤：按鈕在最下面自己的一行，不蓋到任何一個標籤`, () => {
      renderShot(tags)
      const toggle = screen.getByTestId('steps-toggle-shot:7')
      const footer = screen.getByTestId('steps-footer-shot:7')
      expect(footer.contains(toggle), '按鈕在自己的一行裡').toBe(true)
      expect(footer.className, '這一行不被內文擠掉').toMatch(/\bshrink-0\b/)
      expect(toggle.className).not.toMatch(/\babsolute\b/)
      const chips = screen.getAllByTestId('shot-character-tag')
      expect(chips).toHaveLength(tags.length)
      for (const chip of chips) {
        const content = chip.closest('div.min-h-0')
        expect(content, '標籤在內文裡').not.toBeNull()
        expect(content?.contains(toggle), '按鈕不在內文裡').toBe(false)
      }
    })
  }

  it('按一下呼叫 toggleSteps；展開時字變「收合步驟」', () => {
    const toggleSteps = vi.fn()
    const actions: CanvasActions = { focusNode: vi.fn(), toggleInCut: vi.fn(), toggleSteps }
    const node: CanvasNode = {
      id: 'shot:7',
      type: 'card',
      position: { x: 0, y: 0 },
      data: { ...shot(['小饅頭（Little Bun）']), expanded: true },
    }
    render(
      <CanvasActionsContext.Provider value={actions}>
        <ReactFlowProvider>
          <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ card: CardNode }} />
        </ReactFlowProvider>
      </CanvasActionsContext.Provider>,
    )
    const toggle = screen.getByTestId('steps-toggle-shot:7')
    expect(toggle.textContent).toBe('收合步驟')
    fireEvent.click(toggle)
    expect(toggleSteps).toHaveBeenCalledWith('shot:7')
  })

  // 卡片高度固定，內文放不下時以前是描述、動作、台詞三行被擠扁，字只露出上半截（中英文都有）。
  // 現在：每一行都不被擠扁（shrink-0），放不下的整行被容器裁掉；角色標籤最多兩排，第三排起整排不顯示。
  it('內文每一行都不被擠扁、角色標籤最多兩排：不會切到半行', () => {
    renderShot([
      '小饅頭（Little Bun）',
      '獸人史萊姆（Orc Slime）',
      '黑藤長老（Elder）',
      '紅光（Red Light）',
    ])
    for (const testid of ['shot-desc', 'shot-action', 'shot-dialogue']) {
      expect(screen.getByTestId(testid).className, testid).toMatch(/\bshrink-0\b/)
    }
    const chips = screen.getAllByTestId('shot-character-tag')
    const row = chips[0]?.parentElement
    expect(row?.className).toMatch(/\bshrink-0\b/)
    expect(row?.className, '最多兩排：一排 18px、排距 4px').toMatch(/max-h-\[40px\]/)
    expect(row?.className).toMatch(/\boverflow-hidden\b/)
    for (const chip of chips) expect(chip.className).toMatch(/h-\[18px\]/)
    expect(row?.getAttribute('title')).toBe(
      '小饅頭（Little Bun）、獸人史萊姆（Orc Slime）、黑藤長老（Elder）、紅光（Red Light）',
    )
    expect(chips[0]?.closest('div.min-h-0')?.className, '內文容器裁掉放不下的整行').toMatch(
      /\boverflow-hidden\b/,
    )
  })
})
