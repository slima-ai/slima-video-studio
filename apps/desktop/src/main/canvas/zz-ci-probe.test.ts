import { it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { layoutNodes } from '../graph/graph-service'
import { cpuNowMs, relativeCost, scalingRatio } from '../test-support/cpu-time'

// 暫時的探針（不合併）：在 CI 量這些數字，故意失敗好讓數字出現在失敗訊息裡
it('CI 探針（main）', async () => {
  const out: Record<string, unknown>[] = []
  for (let rep = 0; rep < 3; rep += 1) {
    const small = createStudioHarness()
    const large = createStudioHarness()
    await small.demo.seed(60)
    await large.demo.seed(240)
    small.canvas.get()
    large.canvas.get()
    // 250 鏡 canvas.get 的 CPU 時間（取 7 次最小）
    const big = createStudioHarness()
    await big.demo.seed(250)
    big.canvas.get()
    let best = Infinity
    for (let i = 0; i < 7; i += 1) {
      const s = cpuNowMs()
      big.canvas.get()
      best = Math.min(best, cpuNowMs() - s)
    }
    const rel = relativeCost(() => big.canvas.get())
    const sr = scalingRatio(() => small.canvas.get(), () => large.canvas.get())
    const ids500 = Array.from({ length: 500 }, (_, i) => `n${String(i)}`)
    const ids2000 = Array.from({ length: 2000 }, (_, i) => `n${String(i)}`)
    const e = (ids: string[]) => ids.slice(1).map((id, i) => ({ from: ids[i] ?? '', to: id }))
    const e500 = e(ids500)
    const e2000 = e(ids2000)
    const lr = scalingRatio(() => layoutNodes(ids500, e500), () => layoutNodes(ids2000, e2000))
    out.push({ getCpuMin250: +best.toFixed(1), relGet: +rel.relative.toFixed(1), refMs: +rel.refMs.toFixed(2), getRatio60to240: +sr.ratio.toFixed(2), layoutRatio: +lr.ratio.toFixed(2) })
    small.cleanup()
    large.cleanup()
    big.cleanup()
  }
  throw new Error(`PROBE_MAIN ${JSON.stringify(out)}`)
}, 120_000)
