import type { OutlineView, ShotView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { segmentName, startClock, StoryboardTable, visibleColumns } from './storyboard-table'

afterEach(cleanup)

const shot = (id: string, number: number, extra: Partial<ShotView> = {}): ShotView => ({
  id,
  number,
  description: `鏡頭 ${String(number)}`,
  action: '',
  cameraMove: null,
  durationSec: 2.5,
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
const outline: OutlineView = { acts: [], locations: [] }

const shots = [
  shot('a', 1, { segment: 'hook', dialogue: '一句旁白' }),
  shot('b', 2, { segment: 'world' }),
  shot('c', 3, { segment: 'world', beatKind: 'card', card: { text: '有些光', subtext: '' } }),
  shot('d', 4, { segment: 'title', beatKind: 'title' }),
]

const renderTable = (trailer: boolean) => {
  installFakeSvs()
  return render(
    <StoryboardTable
      shots={shots}
      outline={outline}
      selected={{}}
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onReorder={vi.fn()}
      trailer={trailer}
    />,
  )
}

const headers = (): string[] =>
  within(screen.getByTestId('storyboard-table'))
    .getAllByRole('columnheader')
    .map((h) => h.textContent)
    .filter((text) => text !== '')

describe('分鏡表：預告片專案的預設欄位', () => {
  it('預設只有時間、段落、種類、畫面或字、旁白、秒數（加選取與鏡號）；「場」「景別」「角度」收起來', () => {
    renderTable(true)
    expect(headers()).toEqual(['選取', '鏡號', '時間', '段落', '種類', '畫面或字', '旁白', '秒數'])
    expect(screen.queryByText('景別')).toBeNull()
  })

  it('按「更多欄位」才全部出現；再按收回去', () => {
    renderTable(true)
    fireEvent.click(screen.getByTestId('storyboard-more-columns'))
    expect(headers()).toEqual(expect.arrayContaining(['場', '景別', '角度', '時間', '段落']))
    expect(screen.getByTestId('storyboard-more-columns').textContent).toBe('收起更多欄位')
    fireEvent.click(screen.getByTestId('storyboard-more-columns'))
    expect(screen.queryByText('景別')).toBeNull()
  })

  it('時間是這一格的開始（前面各格秒數的和）；段落寫名字；字卡寫字卡上的字、片名卡寫「片名卡」', () => {
    renderTable(true)
    expect(screen.getAllByTestId('shot-start').map((n) => n.textContent)).toEqual([
      '0:00.0',
      '0:02.5',
      '0:05.0',
      '0:07.5',
    ])
    expect(screen.getAllByTestId('shot-segment').map((n) => n.textContent)).toEqual([
      '鉤子',
      '世界',
      '世界',
      '片名',
    ])
    expect(screen.getAllByTestId('shot-card-text').map((n) => n.textContent)).toEqual([
      '有些光',
      '片名卡',
    ])
  })

  it('一般專案：跟以前一樣，沒有時間、段落欄，也沒有「更多欄位」', () => {
    renderTable(false)
    expect(screen.queryByTestId('storyboard-more-columns')).toBeNull()
    expect(screen.queryAllByTestId('shot-start')).toHaveLength(0)
    expect(screen.queryAllByTestId('shot-segment')).toHaveLength(0)
    expect(screen.getByText('景別')).toBeTruthy()
  })
})

describe('分鏡表的小算術', () => {
  it('開始時間：一分鐘以上寫分:秒', () => {
    expect(startClock(0)).toBe('0:00.0')
    expect(startClock(8.5)).toBe('0:08.5')
    expect(startClock(75.25)).toBe('1:15.3')
  })

  it('段落名：不認得的代號原樣、沒有段落留空', () => {
    expect(segmentName('escalate')).toBe('升高')
    expect(segmentName('pull_quote')).toBe('pull_quote')
    expect(segmentName(undefined)).toBe('')
  })

  it('visibleColumns：一般專案藏時間與段落；預告片專案預設六欄', () => {
    const ids = ['number', 'start', 'segment', 'scene', 'beat', 'size']
    expect(visibleColumns(ids, { trailer: false, showMore: false, showBeat: false })).toEqual({
      number: true,
      start: false,
      segment: false,
      scene: true,
      beat: false,
      size: true,
    })
    expect(visibleColumns(ids, { trailer: true, showMore: false, showBeat: false })).toEqual({
      number: true,
      start: true,
      segment: true,
      scene: false,
      beat: true,
      size: false,
    })
  })
})

describe('分鏡表：改一格內容時，其他格的輸入框不重新長出來（焦點才留得住）', () => {
  it('shots 換了新的陣列（某一格的畫面描述變了）：同一個輸入框元素還在、焦點沒掉', () => {
    installFakeSvs()
    const props = {
      outline,
      selected: {},
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onReorder: vi.fn(),
      trailer: true,
    }
    const view = render(<StoryboardTable shots={shots} {...props} />)
    const inputs = screen.getAllByTestId('cell-description')
    const second = inputs[1] as HTMLInputElement
    second.focus()
    expect(document.activeElement).toBe(second)

    // 第一格的描述被存下去、鏡頭清單換成新陣列（跟 Enter 存好之後的畫面一樣）
    view.rerender(
      <StoryboardTable
        shots={shots.map((s) => (s.id === 'a' ? { ...s, description: '甲' } : s))}
        {...props}
      />,
    )
    expect(screen.getAllByTestId('cell-description')[1]).toBe(second)
    expect(document.activeElement).toBe(second)
  })
})
