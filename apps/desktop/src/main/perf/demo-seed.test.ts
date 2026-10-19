import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

describe('效能自測的示範專案', { timeout: 60_000 }, () => {
  it('開一個新專案：每場 10 鏡、5 個角色、5 個地點，每鏡都有採用中的第一張畫面', async () => {
    const h = createStudioHarness()
    harnesses.push(h)
    // 原本的專案留著：先建一個
    h.projects.create(`${h.root}/a.svsproj`, '原本的專案')
    const result = await h.demo.seed(25)
    expect(result.project.name).toBe('效能測試（25 鏡）')
    expect(result.shots).toBe(25)
    expect(h.projects.current()?.dir).toBe(result.project.dir)

    const scenes = h.outline.get().acts.flatMap((a) => a.scenes)
    expect(scenes).toHaveLength(3)
    expect(h.outline.get().locations).toHaveLength(5)
    expect(h.characters.list()).toHaveLength(5)
    const shots = h.shots.list().shots
    expect(shots).toHaveLength(25)
    expect(shots.every((s) => s.firstFrames.some((f) => f.adopted))).toBe(true)
    // 每一鏡都在某一場、帶一個出場角色
    expect(shots.every((s) => s.sceneId !== undefined && s.characters.length === 1)).toBe(true)
  })

  it('250 鏡：畫布投影（canvas.get）在 200 毫秒內', async () => {
    const h = createStudioHarness()
    harnesses.push(h)
    await h.demo.seed(250)
    h.canvas.get() // 第一次有冷啟動（資料庫快取、JIT），不算
    // 機器忙的時候單次量測會被拖慢好幾倍（中位數也一樣），量 7 次取最快的一次，
    // 才反映程式本身要花的時間
    const times: number[] = []
    for (let i = 0; i < 7; i++) {
      const started = performance.now()
      const graph = h.canvas.get()
      times.push(performance.now() - started)
      expect(graph.nodes.filter((n) => n.kind === 'shot')).toHaveLength(250)
    }
    expect(Math.min(...times)).toBeLessThan(200)
  })
})
