import { it } from 'vitest'

import { makeDemo, normalize } from '../../test/canvas-demo'
import { relativeCost, scalingRatio } from '../../test/cpu-time'
import { refreshFrames } from './geometry'

it('CI 探針（renderer）', () => {
  const out: Record<string, unknown>[] = []
  for (let rep = 0; rep < 3; rep += 1) {
    const g = makeDemo(250)
    const a = relativeCost(() => refreshFrames(g.nodes))
    const b = relativeCost(() => normalize(g))
    const s = makeDemo(60)
    const l = makeDemo(240)
    const r1 = scalingRatio(() => normalize(s), () => normalize(l))
    const r2 = scalingRatio(() => refreshFrames(s.nodes), () => refreshFrames(l.nodes))
    out.push({ relFrames: +a.relative.toFixed(3), relNorm: +b.relative.toFixed(3), refMs: +a.refMs.toFixed(2), normRatio: +r1.ratio.toFixed(2), frameRatio: +r2.ratio.toFixed(2) })
  }
  throw new Error(`PROBE_RENDERER ${JSON.stringify(out)}`)
})
