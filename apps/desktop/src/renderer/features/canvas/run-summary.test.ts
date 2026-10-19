import type { CanvasRunStep } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { runSummary } from './run-summary'

const step = (label: string, kind: CanvasRunStep['kind'] = 'video'): CanvasRunStep => ({
  key: label,
  kind,
  label,
  redo: false,
})

describe('runSummary', () => {
  it('同一鏡的步驟寫在一起，括號是總步數', () => {
    expect(runSummary([step('第 4 鏡：第一張畫面', 'image'), step('第 4 鏡：影片')])).toBe(
      '第 4 鏡 第一張畫面、影片（2 步）',
    )
  })

  it('好幾鏡用分號隔開；最後接成品', () => {
    expect(
      runSummary([
        step('第 1 鏡：影片'),
        step('第 3 鏡：第一張畫面', 'image'),
        step('第 3 鏡：影片'),
        step('接成成品（3 段，在本機處理、免費）', 'cut'),
      ]),
    ).toBe('第 1 鏡 影片；第 3 鏡 第一張畫面、影片、接成成品（4 步）')
  })

  it('超過三鏡：列前三鏡，再寫一共幾個鏡頭', () => {
    const steps = [1, 2, 3, 4, 5].map((n) => step(`第 ${String(n)} 鏡：影片`))
    expect(runSummary(steps)).toBe('第 1 鏡 影片；第 2 鏡 影片；第 3 鏡 影片等 5 個鏡頭（5 步）')
  })

  it('只有接成品', () => {
    expect(runSummary([step('接成成品（5 段，在本機處理、免費）', 'cut')])).toBe('接成成品（1 步）')
  })
})
