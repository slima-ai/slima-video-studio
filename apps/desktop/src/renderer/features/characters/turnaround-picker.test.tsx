import type { CharacterView, TurnaroundView, TurnaroundsState } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { TurnaroundPicker } from './turnaround-picker'

afterEach(cleanup)

const H = (c: string): string => c.repeat(64)
const character: CharacterView = {
  id: 'c1',
  name: '阿鐵',
  appearance: '短黑髮',
  personality: '',
  avoid: '',
  outfit: '',
  anchorText: '',
  anchorStatus: 'none',
  version: 1,
  heroAssetHash: H('h'),
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}
const turnaround = (id: string, round: number, c: string): TurnaroundView => ({
  id,
  round,
  sheetHash: H(c),
  frontHash: H('1'),
  sideHash: H('2'),
  backHash: H('3'),
  cuts: { a: 1 / 3, b: 2 / 3 },
  modelId: 'mock/image',
  createdAt: '2026-10-12T00:00:00.000Z',
})
const state = (extra: Partial<TurnaroundsState> = {}): TurnaroundsState => ({
  characterId: 'c1',
  turnarounds: [],
  ...extra,
})

describe('TurnaroundPicker', () => {
  it('可以生成時：按鈕寫明組數，旁邊顯示預估花費', async () => {
    installFakeSvs()
    render(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    expect((await screen.findByTestId('turnaround-generate')).textContent).toBe('生成 4 組三視圖')
    await waitFor(() => {
      expect(screen.getByTestId('turnaround-cost').textContent).toBe(
        '預估約 US$0.32（Nano Banana 2）',
      )
    })
  })

  it('還沒挑主圖：停用並說明要先挑主圖', async () => {
    installFakeSvs({
      'characters.turnaroundCheck': () => ({
        ok: false,
        issue: '先從概念圖挑一張主圖，三視圖才知道要畫誰。',
        estimatedUsd: 0,
        count: 4,
        demoMode: false,
      }),
    })
    render(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    await waitFor(() => {
      expect(screen.getByTestId('turnaround-cost').textContent).toContain('先從概念圖挑一張主圖')
    })
    expect(screen.getByTestId<HTMLButtonElement>('turnaround-generate').disabled).toBe(true)
  })

  it('換了主圖就重新檢查能不能生成', async () => {
    let ok = false
    const svs = installFakeSvs({
      'characters.turnaroundCheck': () => ({
        ok,
        ...(ok ? {} : { issue: '先挑主圖' }),
        estimatedUsd: 0.3,
        count: 4,
        demoMode: false,
      }),
    })
    const noHero = { ...character, heroAssetHash: undefined }
    const { rerender } = render(<TurnaroundPicker character={noHero} onChanged={() => undefined} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('turnaround-generate').disabled).toBe(true)
    })
    ok = true
    rerender(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('turnaround-generate').disabled).toBe(false)
    })
    expect(svs.payloadsOf('characters.turnaroundCheck').length).toBeGreaterThanOrEqual(2)
  })

  it('生成 → 進度（事件）→ 完成後列出候選，每組有設定稿與三張切圖', async () => {
    const svs = installFakeSvs({ 'characters.generateTurnarounds': () => ({}) })
    render(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    fireEvent.click(await screen.findByTestId('turnaround-generate'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.generateTurnarounds')).toEqual([{ characterId: 'c1' }])
    })
    act(() => {
      svs.emit('characters.turnaroundsChanged', state({ generating: { done: 1, total: 4 } }))
    })
    expect(screen.getByTestId('turnaround-progress').textContent).toContain('已完成 1／4')

    act(() => {
      svs.emit(
        'characters.turnaroundsChanged',
        state({
          turnarounds: ['a', 'b', 'c', 'd'].map((c, i) => turnaround(`t${String(i)}`, 1, c)),
        }),
      )
    })
    expect(
      screen.getByTestId('turnaround-round-1').querySelectorAll('[data-adopted]'),
    ).toHaveLength(4)
    expect(screen.getByTestId('turnaround-generate').textContent).toBe('整組重跑（4 組）')
    expect(screen.getAllByAltText('正面')).toHaveLength(4)
  })

  it('採用一組 → 呼叫主行程、角色卡顯示三張圖；使用中的那組標示出來', async () => {
    const adopted: CharacterView = {
      ...character,
      turnaround: { front: H('1'), side: H('2'), back: H('3') },
    }
    const svs = installFakeSvs({
      'characters.turnarounds': () => state({ turnarounds: [turnaround('t0', 1, 'a')] }),
      'characters.adoptTurnaround': () => adopted,
    })
    let latest = character
    const { rerender } = render(
      <TurnaroundPicker
        character={character}
        onChanged={(next) => {
          latest = next
        }}
      />,
    )
    expect(screen.queryByTestId('turnaround-adopted')).toBeNull()
    fireEvent.click(await screen.findByTestId('turnaround-adopt-t0'))
    await waitFor(() => {
      expect(svs.payloadsOf('characters.adoptTurnaround')).toEqual([
        { characterId: 'c1', turnaroundId: 't0' },
      ])
      expect(latest.turnaround).toBeDefined()
    })
    rerender(<TurnaroundPicker character={latest} onChanged={() => undefined} />)
    expect(screen.getByTestId('turnaround-adopted')).toBeTruthy()
    expect(screen.getByTestId('turnaround-t0').getAttribute('data-adopted')).toBe('true')
    expect(screen.getByTestId<HTMLButtonElement>('turnaround-adopt-t0').disabled).toBe(true)
  })

  it('調整切線：拉兩個滑桿 → 重新切 → 帶著新的切線呼叫主行程；太近不能送出', async () => {
    const svs = installFakeSvs({
      'characters.turnarounds': () => state({ turnarounds: [turnaround('t0', 1, 'a')] }),
      'characters.reslice': () => ({ ...turnaround('t0', 1, 'a'), cuts: { a: 0.3, b: 0.7 } }),
    })
    render(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    fireEvent.click(await screen.findByTestId('turnaround-adjust-open'))
    const reslice = screen.getByTestId<HTMLButtonElement>('turnaround-reslice')
    expect(reslice.disabled).toBe(true) // 還沒動

    fireEvent.change(screen.getByTestId('turnaround-cut-a'), { target: { value: '60' } })
    fireEvent.change(screen.getByTestId('turnaround-cut-b'), { target: { value: '65' } })
    expect(reslice.disabled).toBe(true)
    expect(screen.getByText('兩條切線要隔開一點。')).toBeTruthy()

    fireEvent.change(screen.getByTestId('turnaround-cut-a'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('turnaround-cut-b'), { target: { value: '70' } })
    expect(reslice.disabled).toBe(false)
    fireEvent.click(reslice)
    await waitFor(() => {
      expect(svs.payloadsOf('characters.reslice')).toEqual([
        { characterId: 'c1', turnaroundId: 't0', cuts: { a: 0.3, b: 0.7 } },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByTestId('turnaround-adjust')).toBeNull()
    })
  })

  it('生成失敗或被拒絕：顯示白話原因', async () => {
    installFakeSvs({
      'characters.generateTurnarounds': () => {
        throw appError('預估花費超過上限')
      },
    })
    render(<TurnaroundPicker character={character} onChanged={() => undefined} />)
    fireEvent.click(await screen.findByTestId('turnaround-generate'))
    expect((await screen.findByRole('alert')).textContent).toBe('預估花費超過上限')
  })
})
