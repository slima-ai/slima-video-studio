import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dataOf, startRealMcp } from './test-support'

type Running = Awaited<ReturnType<typeof startRealMcp>>
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.close()
})

describe('預告片指南：同一張場景卡的不動格共用首幀', () => {
  it('第 7 步說了：只畫一張、估價只算一次', async () => {
    const r = await startRealMcp()
    running.push(r)
    const { text } = dataOf(
      z.object({ text: z.string() }),
      await r.call('load_guide', { topic: 'trailer' }),
    )
    const step7 = text.split('\n').find((line) => line.startsWith('7. ')) ?? ''
    expect(step7).toContain('share ONE first frame')
    expect(step7).toContain('the estimate counts it once')
  })
})
