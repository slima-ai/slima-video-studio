import type { CanvasRunPlan } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { runLines, runPinnedLines } from './run-confirm-plan'

const plan = (extra: Partial<CanvasRunPlan> = {}): CanvasRunPlan => ({
  ok: true,
  steps: [
    { key: 'shot:a:video', kind: 'video', label: '第 1 鏡：影片', redo: false },
    {
      key: 'shot:b:video',
      kind: 'video',
      label: '第 2 鏡：不動的畫面（本機，不花錢）',
      redo: false,
    },
    { key: 'shot:c:video', kind: 'video', label: '第 3 鏡：字卡（本機，不花錢）', redo: false },
  ],
  highlightKeys: [],
  shotCount: 3,
  skippedBusy: 0,
  estimatedUsd: 0.5,
  estimateIsLowerBound: false,
  demoMode: false,
  models: { video: 'Veo 3.1 Lite' },
  rejoin: false,
  segments: 0,
  ...extra,
})

describe('執行確認視窗的清單', () => {
  it('不動的畫面與字卡各一行，寫明本機、不花錢', () => {
    const lines = runLines(plan())
    expect(lines).toContain('第 2 鏡：不動的畫面（本機，不花錢）')
    expect(lines).toContain('第 3 鏡：字卡（本機，不花錢）')
  })

  it('格長超過模型上限的提醒放在固定顯示的幾行裡（清單捲動時也看得到）', () => {
    const warn = '第 1 鏡：要 10 秒，超過影片模型的上限 8 秒，影片只會有 8 秒。'
    expect(runPinnedLines(plan({ warnings: [warn] }))).toContain(warn)
    expect(runPinnedLines(plan())).not.toContain(warn)
  })
})
