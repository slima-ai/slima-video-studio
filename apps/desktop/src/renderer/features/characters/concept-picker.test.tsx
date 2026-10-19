import type { CharacterView, ConceptsState, ConceptView } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { ConceptPicker } from './concept-picker'

afterEach(cleanup)

const H = (c: string): string => c.repeat(64)
const character: CharacterView = {
  id: 'c1',
  name: '阿鐵',
  appearance: '短黑髮',
  personality: '',
  outfit: '',
  anchorText: '',
  anchorStatus: 'none',
  version: 0,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}
const concept = (id: string, round: number, hash: string): ConceptView => ({
  id,
  round,
  assetHash: hash,
  modelId: 'mock/image',
  createdAt: '2026-10-12T00:00:00.000Z',
})
const state = (extra: Partial<ConceptsState> = {}): ConceptsState => ({
  characterId: 'c1',
  concepts: [],
  ...extra,
})

describe('ConceptPicker', () => {
  it('還沒有概念圖：按鈕寫明張數，旁邊顯示預估花費', async () => {
    installFakeSvs()
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    expect((await screen.findByTestId('concept-generate')).textContent).toBe('生成 4 張概念圖')
    await waitFor(() => {
      expect(screen.getByTestId('concept-cost').textContent).toBe('預估約 US$0.32（Nano Banana 2）')
    })
  })

  it('示範模式：說明不會花錢', async () => {
    installFakeSvs({
      'characters.conceptCheck': () => ({ ok: true, estimatedUsd: 0, count: 4, demoMode: true }),
    })
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    await waitFor(() => {
      expect(screen.getByTestId('concept-cost').textContent).toContain('不會花錢')
    })
  })

  it('不能生成時（例如沒有 Key）：按鈕停用並說明原因', async () => {
    installFakeSvs({
      'characters.conceptCheck': () => ({
        ok: false,
        issue: '還沒有可用的圖片模型',
        estimatedUsd: 0,
        count: 4,
        demoMode: false,
      }),
    })
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    await waitFor(() => {
      expect(screen.getByTestId('concept-cost').textContent).toBe('還沒有可用的圖片模型')
    })
    expect(screen.getByTestId<HTMLButtonElement>('concept-generate').disabled).toBe(true)
  })

  it('按下生成 → 顯示進度（靠推送的事件）→ 完成後出現一格一格的候選', async () => {
    const svs = installFakeSvs({ 'characters.generateConcepts': () => ({}) })
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    fireEvent.click(await screen.findByTestId('concept-generate'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.generateConcepts')).toEqual([{ characterId: 'c1' }])
    })

    act(() => {
      svs.emit('characters.conceptsChanged', state({ generating: { done: 2, total: 4 } }))
    })
    expect(screen.getByTestId('concept-progress').textContent).toContain('已完成 2／4')
    expect(screen.queryByTestId('concept-generate')).toBeNull()

    act(() => {
      svs.emit(
        'characters.conceptsChanged',
        state({ concepts: ['a', 'b', 'c', 'd'].map((c, i) => concept(`k${String(i)}`, 1, H(c))) }),
      )
    })
    expect(screen.getByTestId('concept-round-1').querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByTestId('concept-generate').textContent).toBe('整組重跑（4 張）')
  })

  it('別的角色的事件不會混進來', async () => {
    const svs = installFakeSvs()
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    await screen.findByTestId('concept-generate')
    act(() => {
      svs.emit('characters.conceptsChanged', {
        characterId: 'other',
        concepts: [concept('x', 1, H('a'))],
      })
    })
    expect(screen.queryByTestId('concept-round-1')).toBeNull()
  })

  it('新的一輪排在前面；點一張就挑成主圖，並標示目前的主圖', async () => {
    const picked: CharacterView = { ...character, heroAssetHash: H('b') }
    const svs = installFakeSvs({
      'characters.concepts': () =>
        state({
          concepts: [concept('n1', 2, H('c')), concept('o1', 1, H('a')), concept('o2', 1, H('b'))],
        }),
      'characters.pickHero': () => picked,
    })
    let latest = character
    const { rerender } = render(
      <ConceptPicker
        character={character}
        onChanged={(next) => {
          latest = next
        }}
      />,
    )
    const rounds = await screen.findAllByTestId(/^concept-round-/)
    expect(rounds.map((r) => r.getAttribute('data-testid'))).toEqual([
      'concept-round-2',
      'concept-round-1',
    ])

    fireEvent.click(screen.getByTestId('concept-o2'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.pickHero')).toEqual([
        { characterId: 'c1', conceptId: 'o2' },
      ])
      expect(latest.heroAssetHash).toBe(H('b'))
    })

    rerender(<ConceptPicker character={latest} onChanged={() => undefined} />)
    expect(screen.getByTestId('concept-o2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('concept-o1').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('concept-hero')).toBeTruthy()
  })

  it('生成失敗：顯示白話原因；生成中可以取消', async () => {
    const svs = installFakeSvs({ 'characters.cancelConcepts': () => ({}) })
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    await screen.findByTestId('concept-generate')
    act(() => {
      svs.emit('characters.conceptsChanged', state({ generating: { done: 0, total: 4 } }))
    })
    fireEvent.click(screen.getByTestId('concept-cancel'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.cancelConcepts')).toEqual([{ characterId: 'c1' }])
    })
    act(() => {
      svs.emit('characters.conceptsChanged', state({ error: '圖片模型暫時忙碌，請稍後再試' }))
    })
    expect((await screen.findByRole('alert')).textContent).toBe('圖片模型暫時忙碌，請稍後再試')
  })

  it('開始生成被拒絕（例如超過花費上限）：顯示原因', async () => {
    installFakeSvs({
      'characters.generateConcepts': () => {
        throw appError('預估花費超過上限')
      },
    })
    render(<ConceptPicker character={character} onChanged={() => undefined} />)
    fireEvent.click(await screen.findByTestId('concept-generate'))
    expect((await screen.findByRole('alert')).textContent).toBe('預估花費超過上限')
  })
})
