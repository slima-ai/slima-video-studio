import type { TrailerStatus } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { choose } from '../../test/select'
import { TrailerBadge, trailerBadgeText } from './trailer-badge'

afterEach(cleanup)

const status = (patch: Partial<TrailerStatus> = {}, settings: object = {}): TrailerStatus => ({
  exists: true,
  settings: {
    kind: 'story',
    targetSec: 30,
    title: '斷橋',
    author: '',
    tagline: '',
    endLine: '',
    narration: true,
    music: true,
    musicMood: '',
    musicBrief: '',
    sourceText: '一座斷橋，一個老人。',
    claims: [],
    ...settings,
  },
  targetSec: 30,
  scriptSec: 30,
  beatCount: 9,
  matches: true,
  errors: [],
  warnings: [],
  ...patch,
})

const CHECK = {
  ok: true,
  estimatedUsd: 0,
  demoMode: true,
  existingBeats: 9,
  generatedBeats: 0,
}

describe('TrailerBadge：頂列的預告片標籤', () => {
  it('一般專案（沒有預告片設定）不顯示', () => {
    installFakeSvs()
    render(<TrailerBadge status={status({ exists: false })} />)
    expect(screen.queryByTestId('trailer-badge')).toBeNull()
    render(<TrailerBadge status={undefined} />)
    expect(screen.queryByTestId('trailer-badge')).toBeNull()
  })

  it('寫腳本加總／目標秒數；對得上用一般顏色，對不上標警示', () => {
    installFakeSvs()
    expect(trailerBadgeText(status())).toBe('預告片 30／30 秒')
    expect(trailerBadgeText(status({ scriptSec: 29.5 }))).toBe('預告片 29.5／30 秒')
    const ok = render(<TrailerBadge status={status()} />)
    expect(screen.getByTestId('trailer-badge').dataset.matches).toBe('true')
    ok.unmount()
    render(<TrailerBadge status={status({ scriptSec: 29.5, matches: false })} />)
    expect(screen.getByTestId('trailer-badge').dataset.matches).toBe('false')
    expect(screen.getByTestId('trailer-badge').className).toContain('text-warning')
  })

  it('對不上：面板有「自動調整」鈕（不重述差多少），按了會照目標重排各格', async () => {
    const update = vi.fn(() => status())
    installFakeSvs({ 'trailer.check': () => CHECK, 'trailer.update': update })
    render(<TrailerBadge status={status({ scriptSec: 29.5, matches: false })} />)
    fireEvent.click(screen.getByTestId('trailer-badge'))
    // 標籤已寫「29.5／30 秒」，面板只留「自動調整」鈕，不再重述差多少
    expect(screen.getByTestId('trailer-mismatch').textContent).toBe('自動調整')
    fireEvent.click(screen.getByTestId('trailer-fit'))
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ patch: {}, refit: true })
    })
  })

  it('對得上：面板沒有「自動調整」', () => {
    installFakeSvs({ 'trailer.check': () => CHECK })
    render(<TrailerBadge status={status()} />)
    fireEvent.click(screen.getByTestId('trailer-badge'))
    expect(screen.getByTestId('trailer-panel')).toBeTruthy()
    expect(screen.queryByTestId('trailer-fit')).toBeNull()
  })

  it('改長度：存目標秒數並照新長度重排；改書名離開輸入框才存，沒改就不存', async () => {
    const update = vi.fn(() => status())
    installFakeSvs({ 'trailer.check': () => CHECK, 'trailer.update': update })
    render(<TrailerBadge status={status()} />)
    fireEvent.click(screen.getByTestId('trailer-badge'))
    choose('trailer-panel-length', '60')
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ patch: { targetSec: 60 }, refit: true })
    })
    const title = screen.getByTestId('trailer-panel-title')
    fireEvent.blur(title)
    expect(update).toHaveBeenCalledTimes(1)
    fireEvent.change(title, { target: { value: '斷橋之夜' } })
    fireEvent.blur(title)
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith({ patch: { title: '斷橋之夜' } })
    })
  })

  it('檢查器的警告與錯誤列在面板裡', () => {
    installFakeSvs({ 'trailer.check': () => CHECK })
    render(
      <TrailerBadge
        status={status({
          errors: [{ code: 'first_beat_card', message: '第一格不能是字卡。' }],
          warnings: [{ code: 'no_end_line', message: '還沒有上市日期。' }],
        })}
      />,
    )
    fireEvent.click(screen.getByTestId('trailer-badge'))
    const issues = screen.getByTestId('trailer-issues').textContent
    expect(issues).toContain('第一格不能是字卡。')
    expect(issues).toContain('還沒有上市日期。')
  })

  it('改短長度後好幾格旁白念不完：面板不列那些錯誤、也沒有第二顆「重寫腳本」；其他錯誤照列（那幾格在畫布上標示）', () => {
    installFakeSvs({ 'trailer.check': () => CHECK })
    const tooDense = [0, 1, 2, 3, 4, 5].map((index) => ({
      code: 'narration_too_dense',
      index,
      message: `第 ${String(index + 1)} 格的旁白有 5 個字，這一格只有 0.6 秒，請把這句縮短。`,
    }))
    render(
      <TrailerBadge
        status={status({
          errors: [...tooDense, { code: 'first_beat_card', message: '第一格不能是字卡。' }],
        })}
      />,
    )
    fireEvent.click(screen.getByTestId('trailer-badge'))
    expect(screen.queryByTestId('trailer-narration-summary')).toBeNull()
    expect(screen.queryByTestId('trailer-narration-rewrite')).toBeNull()
    expect(screen.getAllByRole('button', { name: /重寫腳本/ })).toHaveLength(1)
    const issues = screen.getByTestId('trailer-issues').textContent
    expect(issues).not.toContain('這一格只有 0.6 秒')
    expect(issues).toContain('第一格不能是字卡。')
  })

  it('重寫腳本：用存著的原文與目前設定；已有腳本先確認（寫出會取代幾格、幾格已生成）', async () => {
    const plan = vi.fn(() => ({ ...status(), retried: false, fixes: [] }))
    installFakeSvs({
      'trailer.check': () => ({ ...CHECK, generatedBeats: 3 }),
      'trailer.plan': plan,
    })
    render(<TrailerBadge status={status({}, { targetSec: 15, tagline: '別回頭' })} />)
    fireEvent.click(screen.getByTestId('trailer-badge'))
    await waitFor(() => {
      expect(screen.getByTestId('trailer-rewrite').textContent).toBe('重寫腳本')
    })
    fireEvent.click(screen.getByTestId('trailer-rewrite'))
    expect(plan).not.toHaveBeenCalled()
    expect(screen.getByTestId('trailer-rewrite-confirm').textContent).toContain(
      '3 格已生成的畫面會被取代，可以復原',
    )
    fireEvent.click(screen.getByTestId('trailer-rewrite-ok'))
    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1)
    })
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '一座斷橋，一個老人。',
        targetSec: 15,
        kind: 'story',
        title: '斷橋',
        tagline: '別回頭',
      }),
    )
  })

  it('沒有留下原文的腳本（舊的）：沒有重寫鈕，也不另外寫說明', () => {
    installFakeSvs({ 'trailer.check': () => CHECK })
    render(<TrailerBadge status={status({}, { sourceText: '' })} />)
    fireEvent.click(screen.getByTestId('trailer-badge'))
    expect(screen.queryByTestId('trailer-rewrite')).toBeNull()
    expect(screen.queryByTestId('trailer-no-source')).toBeNull()
    expect(screen.queryByText(/沒辦法重寫/)).toBeNull()
  })
})
