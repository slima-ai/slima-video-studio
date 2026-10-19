import type { CharacterView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { CharactersPage, diffCharacter } from './characters-page'

afterEach(cleanup)

const view = (extra: Partial<CharacterView> = {}): CharacterView => ({
  id: 'c1',
  name: '阿鐵',
  appearance: '',
  personality: '',
  outfit: '',
  anchorText: '',
  anchorStatus: 'none',
  version: 0,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...extra,
})

describe('diffCharacter', () => {
  it('只列出有改的欄位；清空年齡代表清掉', () => {
    const c = view({ age: '28' })
    const same = {
      name: '阿鐵',
      age: '28',
      appearance: '',
      personality: '',
      outfit: '',
    }
    expect(diffCharacter(c, same)).toEqual({})
    expect(diffCharacter(c, { ...same, age: ' ', outfit: '工作服' })).toEqual({
      age: null,
      outfit: '工作服',
    })
  })
})

/** 角色頁一開始不選任何角色；點清單裡的第一個，詳情面板才會出現。 */
async function openFirst(): Promise<void> {
  const items = await screen.findAllByTestId(/^character-item-(?!lock-)/)
  const [first] = items
  if (!first) throw new Error('清單是空的')
  fireEvent.click(first)
}

describe('CharactersPage', () => {
  it('一開始不選任何角色；點角色才開詳情，關閉或刪除後收起', async () => {
    installFakeSvs({ 'characters.list': () => ({ characters: [view()] }) })
    render(<CharactersPage />)
    await screen.findByTestId('character-item-阿鐵')
    expect(screen.queryByTestId('character-card')).toBeNull()
    await openFirst()
    expect(screen.getByTestId('character-card')).toBeTruthy()
    fireEvent.click(screen.getByTestId('character-panel-close'))
    expect(screen.queryByTestId('character-card')).toBeNull()
  })

  it('沒有角色 → 只有置中的空狀態（沒有上方的新增列）；按「建立第一個角色」才出現名字欄並可直接打字', async () => {
    installFakeSvs()
    render(<CharactersPage />)
    expect(await screen.findByTestId('character-empty')).toBeTruthy()
    expect(screen.queryByTestId('character-new-name')).toBeNull()
    expect(screen.queryByTestId('character-add')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '建立第一個角色' }))
    expect(screen.queryByTestId('character-empty')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('character-new-name'))
  })

  it('沒有角色時說明怎麼新增；新增後出現在清單並選起來', async () => {
    const created = view()
    const svs = installFakeSvs({ 'characters.create': () => created })
    render(<CharactersPage />)
    fireEvent.click(await screen.findByTestId('character-empty-create'))

    fireEvent.change(screen.getByTestId('character-new-name'), { target: { value: '阿鐵' } })
    fireEvent.click(screen.getByTestId('character-add'))

    expect(await screen.findByTestId('character-card')).toBeTruthy()
    expect(screen.getByTestId('character-item-阿鐵')).toBeTruthy()
    expect(screen.queryByTestId('character-empty')).toBeNull()
    expect(svs.payloadsOf('characters.create')).toEqual([{ name: '阿鐵' }])
  })

  it('編輯欄位後才能儲存，只送出改過的欄位', async () => {
    const svs = installFakeSvs({
      'characters.list': () => ({ characters: [view()] }),
      'characters.update': () =>
        view({ appearance: '短黑髮', updatedAt: '2026-10-12T00:01:00.000Z' }),
    })
    render(<CharactersPage />)
    await openFirst()
    const save = await screen.findByTestId('character-save')
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('character-appearance'), { target: { value: '短黑髮' } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('還沒儲存')).toBeTruthy()
    fireEvent.click(save)

    await waitFor(() => {
      expect(svs.payloadsOf('characters.update')).toEqual([
        { characterId: 'c1', patch: { appearance: '短黑髮' } },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByText('還沒儲存')).toBeNull()
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('character-appearance').value).toBe('短黑髮')
  })

  it('名字清空就不能儲存', async () => {
    installFakeSvs({ 'characters.list': () => ({ characters: [view()] }) })
    render(<CharactersPage />)
    await openFirst()
    fireEvent.change(await screen.findByTestId('character-name'), { target: { value: ' ' } })
    expect(screen.getByTestId<HTMLButtonElement>('character-save').disabled).toBe(true)
  })

  it('刪除要先確認；刪除後卡片消失', async () => {
    const svs = installFakeSvs({
      'characters.list': () => ({ characters: [view()] }),
      'characters.delete': () => ({}),
    })
    render(<CharactersPage />)
    await openFirst()
    fireEvent.click(await screen.findByTestId('character-delete'))
    expect(svs.payloadsOf('characters.delete')).toEqual([])
    fireEvent.click(screen.getByTestId('character-delete-confirm'))

    await waitFor(() => {
      expect(screen.queryByTestId('character-card')).toBeNull()
    })
    expect(svs.payloadsOf('characters.delete')).toEqual([{ characterId: 'c1' }])
    expect(screen.getByTestId('character-empty')).toBeTruthy()
  })

  it('選另一個角色會換卡片', async () => {
    installFakeSvs({
      'characters.list': () => ({
        characters: [view(), view({ id: 'c2', name: '小雨', appearance: '長髮' })],
      }),
    })
    render(<CharactersPage />)
    await openFirst()
    await screen.findByTestId('character-card')
    fireEvent.click(screen.getByTestId('character-item-小雨'))
    const card = screen.getByTestId('character-card')
    expect(within(card).getByTestId<HTMLInputElement>('character-name').value).toBe('小雨')
  })

  it('主行程回報錯誤時顯示白話訊息', async () => {
    installFakeSvs({
      'characters.create': () => {
        throw appError('名字不能重複')
      },
    })
    render(<CharactersPage />)
    fireEvent.click(await screen.findByTestId('character-empty-create'))
    fireEvent.change(screen.getByTestId('character-new-name'), { target: { value: '甲' } })
    fireEvent.click(screen.getByTestId('character-add'))
    expect((await screen.findByRole('alert')).textContent).toBe('名字不能重複')
  })
})

describe('固定外觀描述', () => {
  const withLooks = view({ appearance: '短黑髮、琥珀色眼睛', outfit: '深藍工作服' })

  it('沒寫長相和服裝時，不能請 AI 整理', async () => {
    installFakeSvs({ 'characters.list': () => ({ characters: [view()] }) })
    render(<CharactersPage />)
    await openFirst()
    await screen.findByTestId('character-anchor-section')
    expect(screen.getByTestId<HTMLButtonElement>('character-anchor-suggest').disabled).toBe(true)
    expect(screen.getByTestId('character-anchor-status').textContent).toContain('還沒寫')
  })

  it('請 AI 整理 → 建議填進輸入框（還沒存）→ 可以修改 → 儲存 → 鎖定', async () => {
    let state = withLooks
    const svs = installFakeSvs({
      'characters.list': () => ({ characters: [state] }),
      'characters.suggestAnchor': () => ({ text: '短黑髮、琥珀色眼睛、深藍工作服' }),
      'characters.setAnchor': (payload: { text: string }) => {
        state = { ...state, anchorText: payload.text, anchorStatus: 'draft', version: 1 }
        return state
      },
      'characters.lock': () => {
        state = { ...state, anchorStatus: 'locked' }
        return state
      },
    })
    render(<CharactersPage />)
    await openFirst()
    fireEvent.click(await screen.findByTestId('character-anchor-suggest'))

    const box = await waitFor(() => {
      const el = screen.getByTestId<HTMLTextAreaElement>('character-anchor')
      expect(el.value).toBe('短黑髮、琥珀色眼睛、深藍工作服')
      return el
    })
    expect(svs.payloadsOf('characters.setAnchor')).toEqual([])
    // 改一下再存
    fireEvent.change(box, { target: { value: '短黑髮、琥珀色眼睛' } })
    fireEvent.click(screen.getByTestId('character-anchor-save'))
    await waitFor(() => {
      expect(screen.getByTestId('character-anchor-status').getAttribute('data-status')).toBe(
        'draft',
      )
    })
    expect(svs.payloadsOf('characters.setAnchor')).toEqual([
      { characterId: 'c1', text: '短黑髮、琥珀色眼睛' },
    ])
    expect(screen.getByTestId('character-anchor-status').textContent).toContain('第 1 版')

    fireEvent.click(screen.getByTestId('character-anchor-lock'))
    await waitFor(() => {
      expect(screen.getByTestId('character-anchor-status').getAttribute('data-status')).toBe(
        'locked',
      )
    })
    // 已鎖定、沒有修改：不能再鎖
    expect(screen.getByTestId<HTMLButtonElement>('character-anchor-lock').disabled).toBe(true)
  })

  it('有修改直接按鎖定：先存再鎖', async () => {
    const svs = installFakeSvs({
      'characters.list': () => ({ characters: [withLooks] }),
      'characters.setAnchor': () => ({
        ...withLooks,
        anchorText: '短黑髮',
        anchorStatus: 'draft',
        version: 1,
      }),
      'characters.lock': () => ({
        ...withLooks,
        anchorText: '短黑髮',
        anchorStatus: 'locked',
        version: 1,
      }),
    })
    render(<CharactersPage />)
    await openFirst()
    fireEvent.change(await screen.findByTestId('character-anchor'), { target: { value: '短黑髮' } })
    fireEvent.click(screen.getByTestId('character-anchor-lock'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.lock')).toHaveLength(1)
    })
    expect(svs.payloadsOf('characters.setAnchor')).toEqual([{ characterId: 'c1', text: '短黑髮' }])
  })

  it('空的描述不能鎖定', async () => {
    installFakeSvs({ 'characters.list': () => ({ characters: [withLooks] }) })
    render(<CharactersPage />)
    await openFirst()
    await screen.findByTestId('character-anchor')
    expect(screen.getByTestId<HTMLButtonElement>('character-anchor-lock').disabled).toBe(true)
  })

  it('長相改過、退回草稿的新版本：提醒要重新鎖定', async () => {
    installFakeSvs({
      'characters.list': () => ({
        characters: [{ ...withLooks, anchorText: '短黑髮', anchorStatus: 'draft', version: 2 }],
      }),
    })
    render(<CharactersPage />)
    await openFirst()
    expect(await screen.findByTestId('character-anchor-relock')).toBeTruthy()
  })

  it('AI 整理失敗：顯示白話訊息，輸入框內容不變', async () => {
    installFakeSvs({
      'characters.list': () => ({
        characters: [{ ...withLooks, anchorText: '舊的', anchorStatus: 'draft', version: 1 }],
      }),
      'characters.suggestAnchor': () => {
        throw appError('還沒有可用的文字模型')
      },
    })
    render(<CharactersPage />)
    await openFirst()
    fireEvent.click(await screen.findByTestId('character-anchor-suggest'))
    expect((await screen.findByRole('alert')).textContent).toBe('還沒有可用的文字模型')
    expect(screen.getByTestId<HTMLTextAreaElement>('character-anchor').value).toBe('舊的')
  })

  it('清單上標出狀態：AI 從大綱抽出的草稿角色寫「草稿」，已鎖定的寫版本號', async () => {
    installFakeSvs({
      'characters.list': () => ({
        characters: [
          view({ id: 'c1', name: '阿鐵', anchorStatus: 'draft', anchorText: '短黑髮', version: 1 }),
          view({ id: 'c2', name: '小花', anchorStatus: 'locked', anchorText: '白貓', version: 2 }),
          view({ id: 'c3', name: '路人' }),
        ],
      }),
    })
    render(<CharactersPage />)
    expect((await screen.findByTestId('character-item-阿鐵')).textContent).toBe('阿鐵草稿')
    expect(screen.getByTestId('character-item-小花').textContent).toBe('小花已鎖定 v2')
    expect(screen.getByTestId('character-item-路人').textContent).toBe('路人')
  })
})
