import type { ConceptView, LocationCardView, LocationImagesState } from '@svs/schema'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { LocationsPage } from './locations-page'

afterEach(cleanup)

const H = (c: string): string => c.repeat(64)

const card = (extra: Partial<LocationCardView> = {}): LocationCardView => ({
  id: 'l1',
  name: '舊倉庫',
  description: '堆滿木箱',
  anchorText: '',
  status: 'draft',
  angles: {},
  ...extra,
})
const concept = (id: string, round: number, hash: string): ConceptView => ({
  id,
  round,
  assetHash: hash,
  modelId: 'mock/image',
  createdAt: '2026-10-12T00:00:00.000Z',
})
const images = (extra: Partial<LocationImagesState> = {}): LocationImagesState => ({
  locationId: 'l1',
  concepts: [],
  ...extra,
})

describe('LocationsPage', () => {
  it('沒有地點時說明怎麼開始；輸入名字新增後出現在清單並被選取', async () => {
    let created = false
    const svs = installFakeSvs({
      'locations.list': () => ({ locations: created ? [card({ name: '海邊' })] : [] }),
      'outline.edit': (op: { op: string }) => {
        if (op.op === 'addLocation') {
          created = true
          return { acts: [], locations: [{ id: 'l1', name: '新的地點 1', description: '' }] }
        }
        return { acts: [], locations: [{ id: 'l1', name: '海邊', description: '' }] }
      },
    })
    render(<LocationsPage />)
    expect(await screen.findByTestId('location-empty')).toBeTruthy()
    expect(screen.getByTestId('location-add').hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByTestId('location-new-name'), { target: { value: '海邊' } })
    fireEvent.click(screen.getByTestId('location-add'))
    await waitFor(() => {
      expect(svs.payloadsOf('outline.edit')).toEqual([
        { op: 'addLocation' },
        { op: 'updateLocation', locationId: 'l1', patch: { name: '海邊' } },
      ])
    })
    expect(await screen.findByTestId('location-item-海邊')).toBeTruthy()
    expect(await screen.findByTestId('location-card')).toBeTruthy()
  })

  it('草稿：沒有描述和主圖不能鎖定並說明；寫了描述按「存下描述」', async () => {
    const svs = installFakeSvs({
      'locations.list': () => ({ locations: [card()] }),
      'locations.setAnchor': (p: { text: string }) => card({ anchorText: p.text }),
    })
    render(<LocationsPage />)
    const lock = await screen.findByTestId('location-lock')
    expect(lock.hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('location-lock-hint').textContent).toContain('描述')
    expect(screen.getByTestId('location-status').textContent).toContain('草稿')

    fireEvent.click(screen.getByTestId('location-anchor-fill'))
    expect(screen.getByTestId<HTMLTextAreaElement>('location-anchor').value).toBe('堆滿木箱')
    fireEvent.change(screen.getByTestId('location-anchor'), { target: { value: '磚牆倉庫' } })
    fireEvent.click(screen.getByTestId('location-anchor-save'))
    await waitFor(() => {
      expect(svs.payloadsOf('locations.setAnchor')).toEqual([
        { locationId: 'l1', text: '磚牆倉庫' },
      ])
    })
    await waitFor(() => {
      expect(screen.getByTestId('location-anchor-save').hasAttribute('disabled')).toBe(true)
    })
  })

  it('概念圖：顯示預估花費與按鈕；挑一張當主圖後出現在主場景圖；沒有主圖看不到「其他角度」', async () => {
    const svs = installFakeSvs({
      'locations.list': () => ({ locations: [card()] }),
      'locations.images': () =>
        images({ concepts: [concept('c1', 1, H('a')), concept('c2', 1, H('b'))] }),
      'locations.pickMain': () => card({ mainAssetHash: H('b') }),
    })
    render(<LocationsPage />)
    await screen.findByTestId('location-card')
    await waitFor(() => {
      expect(screen.getByTestId('location-concepts-cost').textContent).toBe(
        '預估約 US$0.32（Nano Banana 2）',
      )
    })
    expect(screen.getByTestId('location-concepts-generate').textContent).toBe('整組重跑（4 張）')
    expect(screen.queryByTestId('location-angles-generate')).toBeNull()

    fireEvent.click(await screen.findByTestId('location-concept-c2'))
    await waitFor(() => {
      expect(svs.payloadsOf('locations.pickMain')).toEqual([{ locationId: 'l1', conceptId: 'c2' }])
    })
    const main = await screen.findByTestId('location-main')
    await waitFor(() => {
      expect(main.querySelector('img')?.getAttribute('src')).toContain(H('b'))
    })
    expect(await screen.findByTestId('location-angles-generate')).toBeTruthy()
  })

  it('生成：按下去送出對應的種類；進度用推送的事件更新，結束後重新讀場景卡拿到新角度', async () => {
    let reads = 0
    const svs = installFakeSvs({
      'locations.list': () => {
        reads++
        return {
          locations: [
            card({
              anchorText: '磚牆倉庫',
              mainAssetHash: H('a'),
              ...(reads > 1 ? { angles: { reverse: H('b'), wide: H('c') } } : {}),
            }),
          ],
        }
      },
      'locations.generate': () => ({}),
    })
    render(<LocationsPage />)
    const generate = await screen.findByTestId<HTMLButtonElement>('location-angles-generate')
    // 能不能生成要等主行程檢查完才知道
    await waitFor(() => {
      expect(generate.disabled).toBe(false)
    })
    fireEvent.click(generate)
    await waitFor(() => {
      expect(svs.payloadsOf('locations.generate')).toEqual([{ locationId: 'l1', kind: 'angles' }])
    })

    act(() => {
      svs.emit(
        'locations.imagesChanged',
        images({ generating: { kind: 'angles', done: 1, total: 2 } }),
      )
    })
    expect((await screen.findByTestId('location-progress')).textContent).toContain('已完成 1／2')
    // 生成中：不能鎖定、不能再按生成
    expect(screen.getByTestId('location-lock').hasAttribute('disabled')).toBe(true)
    expect(screen.queryByTestId('location-concepts-generate')).toBeNull()

    act(() => {
      svs.emit('locations.imagesChanged', images())
    })
    await waitFor(() => {
      expect(
        screen.getByTestId('location-wide').querySelector('img')?.getAttribute('src'),
      ).toContain(H('c'))
    })
    expect(
      screen.getByTestId('location-reverse').querySelector('img')?.getAttribute('src'),
    ).toContain(H('b'))
  })

  it('鎖定：先存下還沒存的描述再鎖定；鎖定後輸入框與挑圖都停用，要解除鎖定才能改', async () => {
    let status: LocationCardView['status'] = 'draft'
    const svs = installFakeSvs({
      'locations.list': () => ({
        locations: [card({ anchorText: '磚牆倉庫', mainAssetHash: H('a'), status })],
      }),
      'locations.images': () => images({ concepts: [concept('c1', 1, H('a'))] }),
      'locations.setAnchor': (p: { text: string }) =>
        card({ anchorText: p.text, mainAssetHash: H('a') }),
      'locations.lock': () => {
        status = 'locked'
        return card({ anchorText: '潮濕的磚牆倉庫', mainAssetHash: H('a'), status })
      },
      'locations.unlock': () => {
        status = 'draft'
        return card({ anchorText: '潮濕的磚牆倉庫', mainAssetHash: H('a'), status })
      },
    })
    render(<LocationsPage />)
    const box = await screen.findByTestId('location-anchor')
    fireEvent.change(box, { target: { value: '潮濕的磚牆倉庫' } })
    fireEvent.click(screen.getByTestId('location-lock'))
    await waitFor(() => {
      expect(svs.payloadsOf('locations.lock')).toEqual([{ locationId: 'l1' }])
    })
    expect(svs.payloadsOf('locations.setAnchor')).toEqual([
      { locationId: 'l1', text: '潮濕的磚牆倉庫' },
    ])

    await waitFor(() => {
      expect(screen.getByTestId('location-status').textContent).toContain('已鎖定')
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('location-anchor').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('location-concept-c1').disabled).toBe(true)
    expect(screen.queryByTestId('location-lock')).toBeNull()

    fireEvent.click(screen.getByTestId('location-unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('location-status').textContent).toContain('草稿')
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('location-anchor').disabled).toBe(false)
  })

  it('不能生成時（例如沒有 Key）：按鈕停用並說明原因；主行程回報的錯誤顯示出來', async () => {
    installFakeSvs({
      'locations.list': () => ({ locations: [card({ anchorText: '磚牆倉庫' })] }),
      'locations.check': () => ({
        ok: false,
        issue: '還沒有可用的圖片模型',
        estimatedUsd: 0,
        count: 4,
        demoMode: false,
      }),
      'locations.generate': () => {
        throw appError('這張場景卡正在生成圖片。')
      },
      'locations.setAnchor': () => {
        throw appError('這張場景卡已經鎖定，要先解除鎖定才能修改。')
      },
    })
    render(<LocationsPage />)
    const button = await screen.findByTestId('location-concepts-generate')
    await waitFor(() => {
      expect(screen.getByTestId('location-concepts-cost').textContent).toBe('還沒有可用的圖片模型')
    })
    expect(button.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByTestId('location-anchor'), { target: { value: '改一下' } })
    fireEvent.click(screen.getByTestId('location-anchor-save'))
    expect((await screen.findByTestId('location-error')).textContent).toContain('已經鎖定')
  })
})
