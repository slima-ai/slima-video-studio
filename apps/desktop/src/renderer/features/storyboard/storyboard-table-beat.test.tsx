import type { OutlineView, ShotView } from '@svs/schema'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { StoryboardTable } from './storyboard-table'

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
const outline: OutlineView = { acts: [], locations: [] }

const renderTable = (shots: ShotView[]) => {
  installFakeSvs()
  return render(
    <StoryboardTable
      shots={shots}
      outline={outline}
      selected={{}}
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onReorder={vi.fn()}
    />,
  )
}

describe('分鏡表：唯讀的「種類」欄', () => {
  it('一般專案（鏡頭全是會動的）：沒有這一欄，表格寬度跟以前一樣', () => {
    renderTable([shot('a', 1), shot('b', 2, { beatKind: 'video' })])
    expect(screen.queryByText('種類')).toBeNull()
    expect(screen.queryAllByTestId('shot-beat-kind')).toHaveLength(0)
  })

  it('有不動的畫面或字卡：出現「種類」欄，每列寫會動／不動／字卡；唯讀', () => {
    renderTable([
      shot('a', 1),
      shot('b', 2, { beatKind: 'still' }),
      shot('c', 3, { beatKind: 'card', card: { text: '字', subtext: '' } }),
    ])
    expect(screen.getByText('種類')).toBeTruthy()
    const cells = screen.getAllByTestId('shot-beat-kind')
    expect(cells.map((c) => c.textContent)).toEqual(['會動', '不動', '字卡'])
    expect(cells.every((c) => c.tagName === 'SPAN')).toBe(true)
  })
})
