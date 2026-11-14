import { describe, expect, it, vi } from 'vitest'

import { beatMenuEntries } from './beat-menu'
import { beat } from './shots.fixture'

const actions = () => ({ setKind: vi.fn(), addCardAfter: vi.fn(), remove: vi.fn() })
const labels = (entries: { label: string }[]) => entries.map((e) => e.label)

describe('腳本條的右鍵選單', () => {
  it('會動的格子：會動（打勾）｜不動｜字卡（沒有字，標淡並說原因）｜在後面加一張字卡｜刪掉這一格', () => {
    const a = actions()
    const entries = beatMenuEntries(beat(2), a)
    expect(labels(entries)).toEqual(['會動', '不動', '字卡', '在後面加一張字卡', '刪掉這一格'])
    expect(entries[0]?.hint).toBe('✓')
    expect(entries[2]?.disabled).toBe(true)
    expect(entries[2]?.why).toContain('還沒有字卡的字')
    entries[0]?.onSelect()
    expect(a.setKind).not.toHaveBeenCalled() // 已經是會動，不重複送
    entries[1]?.onSelect()
    expect(a.setKind).toHaveBeenCalledWith('still')
    entries[3]?.onSelect()
    expect(a.addCardAfter).toHaveBeenCalledTimes(1)
    entries[4]?.onSelect()
    expect(a.remove).toHaveBeenCalledTimes(1)
  })

  it('字卡格：字卡打勾，可以改回會動、不動', () => {
    const entries = beatMenuEntries(
      beat(2, { beatKind: 'card', card: { text: '字', subtext: '' } }),
      actions(),
    )
    expect(entries[2]?.hint).toBe('✓')
    expect(entries[0]?.disabled).toBeUndefined()
  })

  it('片名卡：只能在後面加字卡，不能改種類、不能刪', () => {
    const a = actions()
    const entries = beatMenuEntries(beat(9, { beatKind: 'title' }), a)
    expect(labels(entries)).toEqual(['在後面加一張字卡', '刪掉這一格'])
    expect(entries[1]?.disabled).toBe(true)
    entries[1]?.onSelect()
    expect(a.remove).not.toHaveBeenCalled()
  })
})
