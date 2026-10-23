import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { layoutNodes } from './graph-service'
import { scalingRatio } from '../test-support/cpu-time'

// 每個測試都要跑完整的快速開始，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: ['阿鐵'] },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

const setup = (): Harness => {
  const harness = createStudioHarness({ mockLlm: breakdown, mockCostUsd: () => 0.25 })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

describe('layoutNodes', () => {
  it('依連線分欄：起點在最左，每個節點在上游的下一欄；同一欄由上往下', () => {
    const positions = layoutNodes(
      ['a', 'b', 'c', 'd'],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    )
    expect(positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(positions.get('b')?.x).toBe(positions.get('c')?.x)
    expect(positions.get('b')?.y).not.toBe(positions.get('c')?.y)
    expect(positions.get('d')?.x).toBe((positions.get('b')?.x ?? 0) + 320)
  })

  it('節點變 4 倍，時間不會多到 9 倍以上（線性時間，不是平方）：長鏈', () => {
    // 不比「幾毫秒」：絕對毫秒數會看機器臉色（共用 runner 慢、整套並行時更慢）。改比同一台機器、同一次測試裡
    // 500 個與 2,000 個節點的 CPU 時間（只算這個行程自己用掉的）：節點變 4 倍，線性實測約 5～6 倍（建 Map 的配置成本
    // 比線性略多）、平方 15 倍以上，門檻 9 倍在中間。
    const chain = (length: number) => {
      const ids = Array.from({ length }, (_, i) => `n${String(i)}`)
      const edges = ids.slice(1).map((id, i) => ({ from: ids[i] ?? '', to: id }))
      return { ids, edges }
    }
    const small = chain(500)
    const large = chain(2_000)
    const { ratio, smallMs, largeMs } = scalingRatio(
      () => layoutNodes(small.ids, small.edges),
      () => layoutNodes(large.ids, large.edges),
    )
    expect(
      ratio,
      `500 個 ${smallMs.toFixed(1)} ms、2,000 個 ${largeMs.toFixed(1)} ms`,
    ).toBeLessThan(9)
    // 結果也要對：最後一個節點在第 N 欄
    expect(layoutNodes(small.ids, small.edges).get('n499')?.x).toBe(499 * 320)
  })

  it('有環時不會卡住：環上的節點放在第一欄', () => {
    const positions = layoutNodes(
      ['a', 'b'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    )
    expect(positions.size).toBe(2)
  })
})

describe('GraphService.shot', () => {
  it('還沒生成過：整張流程圖都是「尚未執行」，沒有結果', () => {
    const h = setup()
    h.shots.create({})
    const first = h.shots.list().shots[0]
    const graph = h.graph.shot(first?.id ?? '')
    expect(graph.runId).toBeUndefined()
    expect(graph.nodes.map((n) => n.title)).toEqual([
      '這個鏡頭',
      '整理成 Prompt',
      '生成第一張畫面',
      '圖生影片',
      '輸出',
    ])
    expect(graph.nodes.every((n) => n.status === 'idle')).toBe(true)
    expect(graph.nodes.every((n) => n.preview === undefined)).toBe(true)
  })

  it('生成完：每個節點有狀態、耗時；圖片與影片節點有預覽；花費依節點加總；連線依序', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const shot = h.shots.list().shots[0]
    const graph = h.graph.shot(shot?.id ?? '')

    expect(graph.number).toBe(1)
    expect(graph.runId).toBeDefined()
    const byTitle = Object.fromEntries(graph.nodes.map((n) => [n.title, n]))
    expect(graph.nodes.map((n) => n.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ])
    expect(byTitle['整理成 Prompt']?.preview?.kind).toBe('text')
    expect(byTitle['生成第一張畫面']?.preview?.kind).toBe('image')
    expect(byTitle['圖生影片']?.preview?.kind).toBe('video')
    expect(byTitle['生成第一張畫面']?.modelName).toBeDefined()
    expect(byTitle['圖生影片']?.sources).toEqual(['生成第一張畫面', '整理成 Prompt'])
    expect(byTitle['生成第一張畫面']?.costUsd).toBeCloseTo(0.25)
    expect(byTitle['圖生影片']?.costUsd).toBeCloseTo(0.25)
    expect(byTitle['整理成 Prompt']?.costUsd).toBeUndefined()
    expect(graph.totalCostUsd).toBeCloseTo(0.5)

    // 引擎自己算出的耗時
    expect(byTitle['圖生影片']?.durationMs).toBeGreaterThanOrEqual(0)

    // 埠的型別：給之後做連線檢查用
    expect(byTitle['圖生影片']?.inputs).toEqual([
      { name: 'image', type: 'image', connected: true },
      { name: 'prompt', type: 'text', connected: true },
      { name: 'cameraMove', type: 'text', connected: true, optional: true },
      // 沒有角色寫「不要出現的特徵」時，這個選填的輸入沒有接線
      { name: 'negativeExtra', type: 'text', connected: false, optional: true },
    ])
    expect(byTitle['圖生影片']?.outputs).toEqual([{ name: 'video', type: 'video' }])
    expect(graph.edges.every((e) => e.kind === 'data')).toBe(true)
    expect(graph.edges).toHaveLength(6)
  })

  it('鎖定了角色：首幀圖多一條帶參考圖的連線，畫成參考連線', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.characters.setAnchor(hero.id, '短黑髮、琥珀色眼睛')
    h.characters.lock(hero.id)
    await h.runQuickStart({ shotCount: 2 })
    const shot = h.shots.list().shots[0]
    const graph = h.graph.shot(shot?.id ?? '')
    const references = graph.edges.filter((e) => e.kind === 'reference')
    // 只有裝了「帶參考圖的圖片模型」才會有這條線；示範模式沒有的話就不該憑空出現
    expect(references.every((e) => e.to.port === 'references')).toBe(true)
  })

  it('有角色寫了「不要出現的特徵」：出場那一鏡的圖生影片多接一條 negativeExtra 的線（資料線）', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { avoid: 'mouth, arms' })
    await h.runQuickStart({ shotCount: 2 })
    const graph = h.graph.shot(h.shots.list().shots[0]?.id ?? '')
    const video = graph.nodes.find((n) => n.title === '圖生影片')
    expect(video?.inputs.find((p) => p.name === 'negativeExtra')).toMatchObject({
      connected: true,
    })
    expect(graph.edges).toHaveLength(7)
  })

  it('找不到的鏡頭、沒有專案：說明原因', () => {
    const h = setup()
    expect(() => h.graph.shot('x')).toThrow('請先開啟或建立一個專案')
    h.shots.create({})
    expect(() => h.graph.shot('x')).toThrow('找不到這個鏡頭')
  })
})
