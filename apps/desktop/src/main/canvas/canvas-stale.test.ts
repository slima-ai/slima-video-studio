import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

async function setup() {
  const harness = createStudioHarness()
  harnesses.push(harness)
  await harness.runQuickStart()
  const [first] = harness.shots.list().shots
  if (!first) throw new Error('沒有鏡頭')
  return { ...harness, first }
}

type Harness = Awaited<ReturnType<typeof setup>>

const status = (h: Harness, shotId: string, kind: 'image' | 'video'): string | undefined =>
  h.canvas.get().nodes.find((n) => n.key === `shot:${shotId}:${kind}`)?.status

describe('需要重跑（stale）', () => {
  it('剛生成好：圖與影片都是完成，沒有需要重跑的', async () => {
    const h = await setup()
    const statuses = h.canvas
      .get()
      .nodes.filter((n) => n.kind === 'image' || n.kind === 'video')
      .map((n) => n.status)
    expect(statuses).toEqual(Array(statuses.length).fill('done'))
    expect(h.shots.staleness().size).toBe(0)
  })

  it('改了描述：圖與影片都標「需要重跑」，其他鏡頭不受影響；全部生成會補它的兩步，再接成品', async () => {
    const h = await setup()
    h.shots.update(h.first.id, { description: '貓抬頭看著月亮' })
    expect(status(h, h.first.id, 'image')).toBe('stale')
    expect(status(h, h.first.id, 'video')).toBe('stale')
    const others = h.shots.list().shots.slice(1)
    for (const other of others) expect(status(h, other.id, 'image')).toBe('done')

    const plan = h.canvas.runPlan({ keys: [], all: true })
    // 會換掉放進成品的影片，所以最後接成品
    expect(plan.steps.map((s) => [s.key, s.redo])).toEqual([
      [`shot:${h.first.id}:image`, false],
      [`shot:${h.first.id}:video`, false],
      ['cut', false],
    ])
  })

  it('只改秒數或運鏡：圖不變，只有影片需要重跑', async () => {
    const h = await setup()
    h.shots.update(h.first.id, { durationSec: 6 })
    expect(status(h, h.first.id, 'image')).toBe('done')
    expect(status(h, h.first.id, 'video')).toBe('stale')
    expect(h.canvas.runPlan({ keys: [], all: true }).steps.map((s) => s.kind)).toEqual([
      'video',
      'cut',
    ])
  })

  it('改回原來的樣子就不需要重跑了；不影響畫面的修改（放不放進成品）也不算', async () => {
    const h = await setup()
    const original = h.first.description
    h.shots.update(h.first.id, { description: '另一個描述' })
    expect(status(h, h.first.id, 'image')).toBe('stale')
    h.shots.update(h.first.id, { description: original })
    expect(status(h, h.first.id, 'image')).toBe('done')
    h.shots.update(h.first.id, { inCut: false })
    expect(status(h, h.first.id, 'video')).toBe('done')
  })

  it('按在需要重跑的影片節點上：補跑（不是「重做」），做完就不再需要重跑', async () => {
    const h = await setup()
    h.shots.update(h.first.id, { description: '貓抬頭看著月亮' })
    const plan = h.canvas.runPlan({ keys: [`shot:${h.first.id}:video`] })
    expect(plan.steps.map((s) => s.redo)).toEqual([false, false])

    await h.canvas.run({ keys: [`shot:${h.first.id}:video`] })
    await vi.waitFor(
      () => {
        expect(status(h, h.first.id, 'image')).toBe('done')
        expect(status(h, h.first.id, 'video')).toBe('done')
      },
      { timeout: 30_000, interval: 20 },
    )
    // 不再需要重跑；換了新版本，成品要重新接
    expect(h.canvas.runPlan({ keys: [], all: true }).steps.map((s) => s.kind)).toEqual(['cut'])
    // 重新生成的是新的版本，舊版本留著
    const shot = h.shots.list().shots.find((s) => s.id === h.first.id)
    expect(shot?.firstFrames).toHaveLength(2)
    expect(shot?.videos).toHaveLength(2)
  })

  it('舊版本沒記輸入指紋：不算需要重跑', async () => {
    const h = await setup()
    const repos = h.projects.current()?.repos
    const take = repos?.shots.listTakes(h.first.id, 'first_frame').find((t) => t.adopted)
    if (!repos || !take) throw new Error('沒有版本')
    // 模擬升級前就存在、沒有指紋的版本
    const added = repos.shots.addTake({
      shotId: h.first.id,
      kind: 'first_frame',
      assetHash: 'e'.repeat(64),
      modelId: 'old',
    })
    repos.shots.adoptTake(added.id)
    h.shots.update(h.first.id, { description: '完全不同的描述' })
    expect(status(h, h.first.id, 'image')).toBe('done')
  })
})
