import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

function setup() {
  const h = createStudioHarness()
  harnesses.push(h)
  return h
}

/** 三個鏡頭：會動、不動、字卡。 */
function threeBeats(h: ReturnType<typeof setup>) {
  const video = h.shots.create({})
  const still = h.shots.create({})
  const card = h.shots.create({})
  h.shots.update(still.id, { beatKind: 'still', durationSec: 2.5 })
  h.shots.update(card.id, {
    beatKind: 'card',
    durationSec: 2,
    card: { text: '有些光，要有人陪你一起守', subtext: '' },
  })
  return { video: video.id, still: still.id, card: card.id }
}

const nodeOf = (h: ReturnType<typeof setup>, key: string) =>
  h.canvas.get().nodes.find((n) => n.key === key)

describe('畫布：預告片格子的標記與節點', () => {
  it('不動與字卡的鏡頭卡帶記號；一般鏡頭的節點沒有 beat 欄位', () => {
    const h = setup()
    const ids = threeBeats(h)
    expect(nodeOf(h, `shot:${ids.video}`)).not.toHaveProperty('beat')
    expect(nodeOf(h, `shot:${ids.still}`)).toMatchObject({ beat: 'still' })
    expect(nodeOf(h, `shot:${ids.card}`)).toMatchObject({ beat: 'card' })
  })

  it('字卡沒有「第一張畫面」節點：鏡頭直接接影片；不動與一般鏡頭都還有', () => {
    const h = setup()
    const ids = threeBeats(h)
    const graph = h.canvas.get()
    expect(nodeOf(h, `shot:${ids.card}:image`)).toBeUndefined()
    expect(nodeOf(h, `shot:${ids.card}:video`)).toMatchObject({ beat: 'card' })
    expect(nodeOf(h, `shot:${ids.still}:image`)).toBeDefined()
    expect(nodeOf(h, `shot:${ids.video}:image`)).toBeDefined()
    const edgesOfCard = graph.edges.filter((e) => e.target.startsWith(`shot:${ids.card}`))
    expect(edgesOfCard.map((e) => [e.source, e.target])).toEqual([
      [`shot:${ids.card}`, `shot:${ids.card}:video`],
    ])
  })

  it('字卡的鏡頭卡上寫的是字卡的字，不是畫面描述', () => {
    const h = setup()
    const ids = threeBeats(h)
    expect(nodeOf(h, `shot:${ids.card}`)?.summary).toBe('有些光，要有人陪你一起守')
  })
})

describe('畫布：執行前的確認（本機的格子寫明不花錢）', () => {
  it('「生成空的」：一般鏡頭列首幀與影片、不動的畫面、字卡各一行；不動與字卡不花錢', () => {
    const h = setup()
    const ids = threeBeats(h)
    const plan = h.canvas.runPlan({ keys: [], all: true })
    const labels = plan.steps.map((s) => s.label)
    expect(labels).toContain('第 1 鏡：影片')
    expect(labels).toContain('第 2 鏡：不動的畫面（本機，不花錢）')
    expect(labels).toContain('第 3 鏡：字卡（本機，不花錢）')
    // 字卡沒有首幀步驟
    expect(plan.steps.some((s) => s.key === `shot:${ids.card}:image`)).toBe(false)
    // 示範模式本來就不花錢：換成沒有本機格子的專案比較，花費只來自第 1、2 鏡的首幀與第 1 鏡的影片
    expect(plan.steps.filter((s) => s.kind === 'video')).toHaveLength(3)
  })

  it('預告片專案：影片格的格長超過模型上限（Veo 最多 8 秒）：面板與確認視窗都提醒；沒超過、本機格子、一般專案都沒有', () => {
    const h = setup()
    // 關掉示範模式、填 fal.ai 的金鑰、影片用 Veo 3.1 Lite（一支 4～8 秒）
    h.settings.update({ demoMode: false })
    h.keys.set('fal', 'fal-test-key-1234567890')
    h.settings.update({ models: { i2v: 'fal/veo-3.1-lite' } })
    const a = h.shots.create({})
    const b = h.shots.create({})
    h.shots.update(a.id, { durationSec: 10 })
    h.shots.update(b.id, { durationSec: 10, beatKind: 'still' })
    const viewOf = (id: string) => h.shots.list().shots.find((s) => s.id === id)
    // 還不是預告片專案：不提醒
    expect(viewOf(a.id)).not.toHaveProperty('lengthOverMax')
    h.projects.current()?.repos.trailer.update({ title: '黑藤裂谷' })
    expect(viewOf(a.id)?.lengthOverMax).toEqual({ wantSec: 10, maxSec: 8 })
    // 靜態鏡頭的影片是本機做的，不受模型上限影響
    expect(viewOf(b.id)).not.toHaveProperty('lengthOverMax')
    const plan = h.canvas.runPlan({ keys: [], all: true })
    expect(plan.warnings).toEqual(['第 1 鏡：要 10 秒，超過影片模型的上限 8 秒，影片只會有 8 秒。'])
    h.shots.update(a.id, { durationSec: 8 })
    expect(viewOf(a.id)).not.toHaveProperty('lengthOverMax')
    expect(h.canvas.runPlan({ keys: [], all: true }).warnings).toBeUndefined()
  })

  it('一般專案：不管幾秒都沒有「超過上限」的提醒', () => {
    const h = setup()
    const a = h.shots.create({})
    h.shots.update(a.id, { durationSec: 15 })
    expect(h.shots.list().shots[0]).not.toHaveProperty('lengthOverMax')
  })

  it('字卡的影片版本記「本機」，畫布的版本名寫「本機・不花錢」', async () => {
    const h = setup()
    const ids = threeBeats(h)
    await h.shots.regenerate(ids.card, 'apply')
    await h.idle(ids.card)
    const node = nodeOf(h, `shot:${ids.card}:video`)
    expect(node).toMatchObject({ modelId: 'local-card', modelName: '本機・不花錢' })
  })
})
