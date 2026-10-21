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

  it('240 鏡：畫布投影（canvas.get）的時間跟鏡頭數大致成正比，沒有變成平方——鏡頭變 4 倍，時間不到 7 倍', async () => {
    // 不比「幾毫秒」：同一份程式在開發機約 40 毫秒、在 GitHub 的共用 runner 上要 200 毫秒以上，絕對門檻一定會看機器臉色。
    // 改成同一台機器、同一次測試裡比 60 鏡與 240 鏡：鏡頭變 4 倍，線性約 4 倍以內（有固定成本，通常 3～4），
    // 平方約 16 倍，門檻 7 倍在兩者中間。
    // 機器忙不忙不能讓它紅（用牆鐘時間量，同時跑的別的測試會把單次量測拖慢好幾倍，比值就跟著亂跳），所以：
    // 量的是這個行程實際用掉的 CPU 時間（被別的行程搶走的不算）；每種各量 7 次取最小的（垃圾回收偶爾多出來的不算）。
    const measure = async (shots: number): Promise<number> => {
      const h = createStudioHarness()
      harnesses.push(h)
      await h.demo.seed(shots)
      h.canvas.get() // 第一次有冷啟動（資料庫快取、JIT），不算
      let best = Infinity
      for (let i = 0; i < 7; i++) {
        const start = process.cpuUsage()
        const graph = h.canvas.get()
        const used = process.cpuUsage(start)
        best = Math.min(best, (used.user + used.system) / 1000)
        expect(graph.nodes.filter((n) => n.kind === 'shot')).toHaveLength(shots)
      }
      return Math.max(best, 0.1)
    }
    const small = await measure(60)
    const large = await measure(240)
    expect(large / small).toBeLessThan(7)
    // 另外留一個很寬的絕對上限（CPU 時間），只擋「慢了一個數量級」這種災難，不當成效能指標
    expect(large).toBeLessThan(1000)
  })
})
