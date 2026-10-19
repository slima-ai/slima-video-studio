import { DEFAULT_STORYBOARD_GUIDE, type QuickStartRequest } from '@svs/schema'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'
import { safeFileName } from '../ensure-project'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function setup(options: HarnessOptions = {}) {
  const harness = createStudioHarness(options)
  cleanups.push(harness.cleanup)
  return { ...harness, service: harness.quickstart }
}

const request = (extra: Partial<QuickStartRequest> = {}): QuickStartRequest => ({
  story: '一隻貓在雨天裡找到溫暖的家',
  style: 'anime',
  shotCount: 3,
  durationSec: 3,
  aspectRatio: '16:9',
  variation: 0,
  ...extra,
})

describe('safeFileName', () => {
  it('去掉不能放進檔名的字元、壓縮空白、限制長度', () => {
    expect(safeFileName('a/b:c*d?', 'x')).toBe('a-b-c-d')
    expect(safeFileName('  雨天 的 貓  ', 'x')).toBe('雨天-的-貓')
    expect(safeFileName('x'.repeat(100), 'y')).toHaveLength(24)
    expect(safeFileName('///', '短片')).toBe('短片')
  })
})

describe('QuickStartService.check', () => {
  it('示範模式：沒問題，附預估花費與會用的模型', () => {
    const { service } = setup()
    const result = service.check(request())
    expect(result).toMatchObject({
      ok: true,
      issues: [],
      limitUsd: 5,
      demoMode: true,
    })
    expect(Object.keys(result.models).sort()).toEqual(['image', 'llm', 'video'])
    expect(result.estimatedUsd).toBeGreaterThan(0)
  })

  it('沒填故事、沒有任何 Key 也不是示範模式 → 列出問題，缺模型的可以前往設定', () => {
    const { service } = setup({ demoMode: false })
    const result = service.check(request({ story: '   ' }))
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        '請先輸入你想拍的故事。',
        expect.stringContaining('還沒有可用的文字模型'),
        expect.stringContaining('還沒有可用的圖片模型'),
        expect.stringContaining('還沒有可用的影片模型'),
      ]),
    )
    expect(result.issues.filter((i) => i.action === 'settings')).toHaveLength(3)
    expect(result.estimatedUsd).toBe(0)
    expect(result.estimateIsLowerBound).toBe(true)
  })

  it('預估花費超過單次上限 → 擋下並可前往設定調高', () => {
    const { service } = setup({ perRunLimitUsd: 0.0001 })
    const result = service.check(request())
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ action: 'settings' })
    expect(result.issues[0]?.message).toContain('超過單次執行的上限')
  })

  it('鏡頭越多預估越貴', () => {
    const { service } = setup()
    expect(service.check(request({ shotCount: 6 })).estimatedUsd).toBeGreaterThan(
      service.check(request({ shotCount: 2 })).estimatedUsd,
    )
  })
})

describe('QuickStartService.run（示範模式，不連網、不用 Key）', () => {
  it('沒有專案時自動建立；每鏡依序完成；成品可以匯出到 exports 資料夾', async () => {
    const { root, projects, service, progress, finished } = setup()
    expect(projects.current()).toBeUndefined()

    const { runId } = await service.run(request())
    expect(projects.current()).toBeDefined()
    expect(readdirSync(join(root, 'projects'))).toHaveLength(1)

    const done = await finished()
    expect(done).toMatchObject({ runId, status: 'succeeded', phase: 'done' })
    expect(done.shots).toHaveLength(3)
    expect(done.shots.every((s) => s.step === 'done' && s.imageHash && s.videoHash)).toBe(true)
    expect(done.finalVideoHash).toBeDefined()
    expect(done.costUsd).toBeGreaterThan(0)
    // 過程中看得到「拆鏡 → 逐鏡 → 接片」依序出現
    const phases = new Set(progress().map((p) => p.phase))
    expect(phases).toEqual(new Set(['breakdown', 'shots', 'join', 'done']))
    expect(service.state()).toEqual(done)

    const { path } = service.export()
    expect(path).toMatch(/exports[\\/].+\.mp4$/)
    expect(existsSync(path)).toBe(true)
    expect(service.state()?.exportedPath).toBe(path)
  })

  it('再跑一次相同內容：全部走快取，不再花錢', async () => {
    const { service, finished, progress } = setup()
    await service.run(request())
    const first = await finished()
    const before = progress().length
    await service.run(request())
    await vi.waitFor(
      () => {
        expect(progress().slice(before).at(-1)?.status).toBe('succeeded')
      },
      { timeout: 30_000 },
    )
    const second = progress().at(-1)
    expect(second?.costUsd).toBe(0)
    expect(second?.finalVideoHash).toBe(first.finalVideoHash)
  })

  it('分鏡準則會帶進拆鏡的提示；改了準則就不再沿用舊的拆鏡結果', async () => {
    const systems: string[] = []
    const { service, finished, progress, settings } = setup({
      mockLlm: (r) => {
        if (r.system?.includes('分鏡助手')) systems.push(r.system)
        return undefined
      },
    })
    await service.run(request())
    await finished()
    expect(systems).toHaveLength(1)
    expect(systems[0]).toContain(DEFAULT_STORYBOARD_GUIDE)

    settings.update({ storyboardGuide: '結尾一定要用遠景。' })
    const before = progress().length
    await service.run(request())
    await vi.waitFor(
      () => {
        expect(progress().slice(before).at(-1)?.status).toBe('succeeded')
      },
      { timeout: 30_000 },
    )
    expect(systems).toHaveLength(2)
    expect(systems[1]).toContain('結尾一定要用遠景。')
    expect(systems[1]).not.toContain(DEFAULT_STORYBOARD_GUIDE)
  })

  it('檢查不過 → 丟出第一個問題的白話訊息，不會建立專案', async () => {
    const { service, projects, root } = setup({ demoMode: false })
    await expect(service.run(request())).rejects.toThrow(/還沒有可用的文字模型/)
    expect(projects.current()).toBeUndefined()
    expect(existsSync(join(root, 'projects'))).toBe(false)
  })

  it('正在生成時不能再開始一次；取消後狀態是 cancelled', async () => {
    const { service, finished } = setup()
    await service.run(request({ shotCount: 3 }))
    expect(service.check(request()).issues.map((i) => i.message)).toContain(
      '已經有一支影片正在生成，等它完成或先取消。',
    )
    await expect(service.run(request())).rejects.toMatchObject({ code: 'invalid_request' })
    service.cancel()
    const done = await finished()
    expect(done.status).toBe('cancelled')
    expect(service.check(request()).ok).toBe(true)
  })

  it('換專案會取消正在跑的生成，進度清空', async () => {
    const { service, projects, root } = setup()
    await service.run(request())
    projects.create(join(root, 'other.svsproj'), '另一個')
    expect(service.state()).toBeNull()
    // 讓被取消的執行把收尾做完；收尾時若還去碰已關閉的資料庫，會變成未處理的錯誤讓測試失敗
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(service.state()).toBeNull()
    expect(service.check(request()).ok).toBe(true)
  })
})

describe('QuickStartService.export', () => {
  it('還沒有成品就匯出 → 白話錯誤', () => {
    const { service } = setup()
    expect(() => service.export()).toThrow(/還沒有可以匯出的影片/)
  })
})
