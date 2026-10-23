import type { CharacterView, ChatPrereq, LocationCardView } from '@svs/schema'
import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../test/fake-svs'
import { CharactersPage } from './characters/characters-page'
import { PrereqCard } from './chat/prereq-card'
import { LocationsPage } from './locations/locations-page'

beforeEach(() => {
  setLocale('en')
})
afterEach(() => {
  cleanup()
  setLocale(DEFAULT_LOCALE)
})

// 英文介面：畫面上不能有中文字，也不能有全形標點（程式自己加的標點最容易漏）
const BAD = /[㐀-鿿，。：；（）、！？「」・]/
const around = (text: string): string | undefined =>
  new RegExp(`.{0,24}${BAD.source}.{0,24}`).exec(text)?.[0]
const visibleText = (): string => {
  const copy = document.body.cloneNode(true) as HTMLElement
  for (const el of copy.querySelectorAll('textarea, input')) el.remove()
  return copy.textContent
}

const character = (extra: Partial<CharacterView> = {}): CharacterView => ({
  id: 'c1',
  name: 'Mina',
  appearance: 'Short dark hair',
  personality: 'Calm',
  avoid: '',
  outfit: 'Yellow raincoat',
  anchorText: 'Short dark hair, yellow raincoat',
  anchorStatus: 'locked',
  version: 2,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...extra,
})

describe('角色、場景卡、Claude 對話在英文介面：畫面上沒有中文', () => {
  it('角色頁：空狀態、角色清單、已鎖定的角色詳情（概念圖、三視圖、版本紀錄）', async () => {
    installFakeSvs()
    const empty = render(<CharactersPage />)
    await screen.findByTestId('character-empty')
    expect(visibleText()).toContain('Create your first character')
    expect(around(visibleText()), '空狀態').toBeUndefined()
    empty.unmount()

    installFakeSvs({
      'characters.list': () => ({ characters: [character()] }),
    })
    render(<CharactersPage />)
    const [first] = await screen.findAllByTestId(/^character-item-(?!lock-)/)
    if (!first) throw new Error('清單是空的')
    fireEvent.click(first)
    await screen.findByTestId('character-card')
    expect(visibleText()).toContain('Locked v2')
    expect(visibleText()).toContain('Fixed appearance')
    expect(around(visibleText()), '角色詳情').toBeUndefined()
  })

  it('場景卡頁：空狀態與一張卡', async () => {
    installFakeSvs()
    const empty = render(<LocationsPage />)
    await screen.findByText(/No locations yet/)
    expect(around(visibleText()), '場景卡空狀態').toBeUndefined()
    empty.unmount()

    const card: LocationCardView = {
      id: 'l1',
      name: 'Old warehouse',
      description: 'Full of crates',
      anchorText: '',
      status: 'draft',
      angles: {},
    }
    installFakeSvs({ 'locations.list': () => ({ locations: [card] }) })
    render(<LocationsPage />)
    const [item] = await screen.findAllByText('Old warehouse')
    if (!item) throw new Error('清單是空的')
    fireEvent.click(item)
    await screen.findByText('Fixed location description')
    expect(visibleText()).toContain('Draft')
    expect(around(visibleText()), '場景卡').toBeUndefined()
  })

  it('Claude 對話的說明卡：關著、連線沒開、沒裝、太舊、沒登入', () => {
    installFakeSvs()
    const states: Exclude<ChatPrereq, { state: 'ready' }>[] = [
      { state: 'disabled' },
      { state: 'mcp_off' },
      { state: 'not_installed' },
      { state: 'too_old', version: '1.0.0', minVersion: '2.1.0' },
      { state: 'not_logged_in', version: '2.1.304' },
    ]
    for (const prereq of states) {
      const view = render(<PrereqCard prereq={prereq} onRecheck={vi.fn()} />)
      expect(around(visibleText()), prereq.state).toBeUndefined()
      view.unmount()
    }
    // 句子中間的指令（claude update）要放在對的位置
    const old = render(
      <PrereqCard
        prereq={{ state: 'too_old', version: '1.0.0', minVersion: '2.1.0' }}
        onRecheck={vi.fn()}
      />,
    )
    expect(visibleText()).toContain(
      'You have 1.0.0; 2.1.0 or newer is needed. Run claude update in a terminal to update',
    )
    old.unmount()
  })
})
