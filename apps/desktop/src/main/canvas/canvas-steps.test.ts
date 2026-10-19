import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

/** 跑完一次 3 鏡的快速開始，再把三鏡放進同一個場（才看得出下面的列往下讓）。 */
async function setup() {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.runQuickStart()
  const scene = h.canvas.add({ kind: 'scene' })
  const sceneId = scene.key.replace('scene:', '')
  const shots = h.shots.list().shots
  h.shots.assignScene(
    shots.map((s) => s.id),
    sceneId,
  )
  return { h, shots, sceneKey: scene.key }
}

describe('鏡頭的「展開步驟」', { timeout: 30_000 }, () => {
  it('沒展開：沒有步驟的格子，鏡頭直接接到第一張畫面', async () => {
    const { h, shots } = await setup()
    const graph = h.canvas.get()
    expect(graph.nodes.some((n) => n.kind === 'step')).toBe(false)
    const first = shots[0]
    if (!first) throw new Error('沒有鏡頭')
    expect(
      graph.edges.some(
        (e) => e.source === `shot:${first.id}` && e.target === `shot:${first.id}:image`,
      ),
    ).toBe(true)
  })

  it('展開一鏡：鏡頭下面多三格（整理 Prompt、挑參考圖、送出模型），線改走這三格', async () => {
    const { h, shots } = await setup()
    const first = shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const key = `shot:${first.id}`
    const graph = h.canvas.get({ expanded: [first.id] })
    const steps = graph.nodes.filter((n) => n.kind === 'step')
    expect(steps.map((n) => n.key)).toEqual([
      `${key}:step:prompt`,
      `${key}:step:refs`,
      `${key}:step:model`,
    ])
    expect(steps.map((n) => n.title)).toEqual(['整理 Prompt', '挑參考圖', '送出模型'])
    const shot = graph.nodes.find((n) => n.key === key)
    expect(shot?.expanded).toBe(true)
    // 疊在鏡頭下面，和鏡頭同一欄，一格比一格低
    for (const step of steps) expect(step.x).toBe(shot?.x)
    const ys = steps.map((n) => n.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(ys[0]).toBeGreaterThan(shot?.y ?? 0)

    const edge = (from: string, to: string) =>
      graph.edges.find((e) => e.source === from && e.target === to)
    expect(edge(key, `${key}:image`)).toBeUndefined()
    expect(edge(key, `${key}:step:prompt`)?.sourcePort).toBe('shot-steps')
    expect(edge(`${key}:step:prompt`, `${key}:step:refs`)).toBeDefined()
    expect(edge(`${key}:step:refs`, `${key}:step:model`)).toBeDefined()
    expect(edge(`${key}:step:model`, `${key}:image`)?.targetPort).toBe('img-in')
  })

  it('下面的列往下讓開，場框跟著變高；收合之後回到原位', async () => {
    const { h, shots, sceneKey } = await setup()
    const [first, second] = shots
    if (!first || !second) throw new Error('鏡頭不夠')
    const at = (graph: ReturnType<typeof h.canvas.get>, k: string) =>
      graph.nodes.find((n) => n.key === k)
    const before = h.canvas.get()
    const after = h.canvas.get({ expanded: [first.id] })
    const secondKey = `shot:${second.id}`
    const lastStep = at(after, `shot:${first.id}:step:model`)
    // 第 2 鏡在最後一格步驟的下面
    expect(at(after, secondKey)?.y ?? 0).toBeGreaterThan(lastStep?.y ?? 0)
    expect(at(after, secondKey)?.x).toBe(at(before, secondKey)?.x)
    expect(at(after, `${secondKey}:image`)?.y).toBe(at(after, secondKey)?.y)
    expect(at(after, sceneKey)?.height ?? 0).toBeGreaterThan(at(before, sceneKey)?.height ?? 0)
    // 第 1 鏡自己的圖和影片不動
    expect(at(after, `shot:${first.id}:image`)?.y).toBe(at(before, `shot:${first.id}:image`)?.y)

    const collapsed = h.canvas.get()
    expect(at(collapsed, secondKey)?.y).toBe(at(before, secondKey)?.y)
  })

  it('整理 Prompt 顯示送給模型的 Prompt；手動改過就標出來；送出模型寫用哪個模型', async () => {
    const { h, shots } = await setup()
    const first = shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const step = (stage: string) =>
      h.canvas
        .get({ expanded: [first.id] })
        .nodes.find((n) => n.key === `shot:${first.id}:step:${stage}`)?.step
    expect(step('prompt')).toMatchObject({
      stage: 'prompt',
      prompt: first.autoPrompt,
      edited: false,
    })
    expect(step('refs')).toEqual({ stage: 'refs', refs: [] })
    expect(step('model')?.model).toBe('示範圖片')

    h.shots.update(first.id, { prompt: '一隻橘貓坐在窗台上，雨夜' })
    expect(step('prompt')).toMatchObject({ prompt: '一隻橘貓坐在窗台上，雨夜', edited: true })
    // 改了 Prompt：第一張畫面要重跑
    expect(h.shots.staleness().get(first.id)?.image).toBe(true)
  })

  it('挑參考圖：鎖定的出場角色會帶進去', async () => {
    const { h, shots } = await setup()
    const first = shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { appearance: '短黑髮' })
    h.characters.setAnchor(hero.id, '短黑髮、琥珀色眼睛')
    h.characters.lock(hero.id)
    h.shots.update(first.id, { characters: ['阿鐵'] })
    const refs = h.canvas
      .get({ expanded: [first.id] })
      .nodes.find((n) => n.key === `shot:${first.id}:step:refs`)?.step?.refs
    expect(refs?.map((r) => r.name)).toEqual(['阿鐵'])
  })
})
