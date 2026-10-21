import type { CanvasChanged, CanvasGraph } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createHistoryService } from '../history/history-service'
import { createStudioHarness } from '../shots/test-harness'
import { cpuNowMs, scalingRatio } from '../test-support/cpu-time'

const HASH = (c: string): string => c.repeat(64)

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

function setup() {
  const harness = createStudioHarness()
  harnesses.push(harness)
  const { projects, canvas, shots, outline, characters } = harness
  const history = createHistoryService({ projects, broadcast: () => undefined })
  projects.create(`${harness.root}/a.svsproj`, 'A')
  const repos = projects.current()?.repos
  if (!repos) throw new Error('專案沒開起來')
  const events = {
    at: (index: number): CanvasChanged | undefined =>
      harness.events
        .filter((e) => e.name === 'canvas.changed')
        .map((e) => e.payload as CanvasChanged)
        .at(index),
  }
  return { projects, canvas, history, repos, events, shots, outline, characters }
}

const node = (graph: CanvasGraph, key: string) => graph.nodes.find((n) => n.key === key)

describe('createCanvasService', () => {
  it('自動排版的場會避開一句話（往下讓），不會蓋在它上面', () => {
    const { canvas, repos } = setup()
    // 一句話被放在第一個場會出現的地方
    const one = canvas.add({ kind: 'oneliner', x: 430, y: 100 })
    const act = repos.outline.addAct({ title: '序幕' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    repos.shots.create({ sceneId: scene.id, description: '貓在雨裡' })
    const graph = canvas.get()
    const frame = node(graph, `scene:${scene.id}`)
    const oneliner = node(graph, one.key)
    if (!frame || !oneliner) throw new Error('節點不齊')
    const overlap =
      frame.x < oneliner.x + 300 &&
      oneliner.x < frame.x + (frame.width ?? 0) &&
      frame.y < oneliner.y + 300 &&
      oneliner.y < frame.y + (frame.height ?? 0)
    expect(overlap).toBe(false)
    expect(frame.y).toBeGreaterThanOrEqual(oneliner.y + 300)
  })

  it('沒有開啟專案：空的畫布，移動與視角都不動作', () => {
    const harness = createStudioHarness()
    harnesses.push(harness)
    const { canvas } = harness
    expect(canvas.get()).toEqual({ nodes: [], edges: [] })
    expect(() => {
      canvas.move({ moves: [{ key: 'a', x: 1, y: 2 }] })
      canvas.viewport({ x: 0, y: 0, zoom: 1 })
    }).not.toThrow()
  })

  it('投影：幕場鏡頭、圖與影片、角色與地點的參考線、每場一個剪輯槽', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '序幕' })
    const loc = repos.outline.addLocation({ name: '舊倉庫' })
    const s1 = repos.outline.addScene(act.id, { title: '街角', locationId: loc.id })
    const s2 = repos.outline.addScene(act.id, { title: '倉庫' })
    const hero = repos.characters.create('阿鐵')
    const a = repos.shots.create({
      sceneId: s1.id,
      description: '貓在雨裡',
      characters: [{ characterId: hero.id }],
      locationId: loc.id,
    })
    const b = repos.shots.create({ sceneId: s1.id, description: '貓抬頭', inCut: false })
    const c = repos.shots.create({ sceneId: s2.id, description: '門縫透光' })
    repos.shots.addTake({ shotId: a.id, kind: 'first_frame', assetHash: HASH('a'), modelId: 'img' })
    repos.shots.addTake({ shotId: a.id, kind: 'video', assetHash: HASH('b'), modelId: 'vid' })

    const graph = canvas.get()
    const kinds = (kind: string): number => graph.nodes.filter((n) => n.kind === kind).length
    expect([kinds('scene'), kinds('shot'), kinds('image'), kinds('video')]).toEqual([2, 3, 3, 3])
    expect([kinds('character'), kinds('location'), kinds('cut')]).toEqual([1, 1, 1])

    expect(node(graph, `shot:${a.id}`)).toMatchObject({
      title: '第 1 鏡',
      summary: '貓在雨裡',
      meta: '中景・平視・3 秒',
      tags: ['阿鐵'],
      sceneKey: `scene:${s1.id}`,
      auto: true,
    })
    expect(node(graph, `shot:${a.id}:image`)).toMatchObject({
      status: 'done',
      assetHash: HASH('a'),
      modelId: 'img',
      version: 1,
    })
    expect(node(graph, `shot:${a.id}:video`)).toMatchObject({ status: 'done', inCut: true })
    expect(node(graph, `shot:${b.id}:video`)).toMatchObject({ status: 'idle', inCut: false })
    expect(node(graph, `scene:${s1.id}`)).toMatchObject({ title: '第 1 場・街角', sceneNo: 1 })
    expect(node(graph, 'cut')?.slots).toEqual([
      // 第 1 場：a 有影片、b 沒放進成品；第 2 場：c 放進成品但還沒有影片，不算
      expect.objectContaining({
        id: 'cut-slot-1',
        sceneKey: `scene:${s1.id}`,
        total: 2,
        used: 1,
        excluded: 1,
      }),
      expect.objectContaining({
        id: 'cut-slot-2',
        sceneKey: `scene:${s2.id}`,
        total: 1,
        used: 0,
        excluded: 0,
      }),
    ])

    const has = (source: string, sourcePort: string, target: string, targetPort: string) =>
      graph.edges.some(
        (e) =>
          e.source === source &&
          e.sourcePort === sourcePort &&
          e.target === target &&
          e.targetPort === targetPort,
      )
    expect(has(`shot:${a.id}`, 'shot-out', `shot:${a.id}:image`, 'img-in')).toBe(true)
    expect(has(`shot:${a.id}:image`, 'img-out', `shot:${a.id}:video`, 'vid-in')).toBe(true)
    expect(has(`character:${hero.id}`, 'char-out', `shot:${a.id}`, 'shot-ref-char')).toBe(true)
    expect(has(`location:${loc.id}`, 'loc-out', `shot:${a.id}`, 'shot-ref-loc')).toBe(true)
    expect(has(`location:${loc.id}`, 'loc-out', `scene:${s1.id}`, 'scene-loc')).toBe(true)
    expect(has(`scene:${s2.id}`, 'scene-out', 'cut', 'cut-slot-2')).toBe(true)
    // 參考線標成 reference，每條連線的兩端都有節點
    expect(graph.edges.find((e) => e.targetPort === 'shot-ref-char')?.kind).toBe('reference')
    const keys = new Set(graph.nodes.map((n) => n.key))
    expect(graph.edges.every((e) => keys.has(e.source) && keys.has(e.target))).toBe(true)
    expect(c.id).toBeTruthy()
  })

  it('自動排版：同一場的鏡頭由上到下、一列由左到右是鏡頭→圖→影片，場框貼合成員，場與場不重疊', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const s1 = repos.outline.addScene(act.id, { title: 'A' })
    const s2 = repos.outline.addScene(act.id, { title: 'B' })
    const shots = [s1, s1, s2].map((s, i) =>
      repos.shots.create({ sceneId: s.id, description: `鏡${String(i)}` }),
    )
    const graph = canvas.get()
    const [p, q, r] = shots.map((s) => node(graph, `shot:${s.id}`))
    expect(p && q && r).toBeTruthy()
    if (!p || !q || !r) return
    expect(q.y - p.y).toBe(256)
    expect(q.x).toBe(p.x)
    const image = node(graph, `shot:${shots[0]?.id ?? ''}:image`)
    const video = node(graph, `shot:${shots[0]?.id ?? ''}:video`)
    expect([image?.x, image?.y, video?.x]).toEqual([p.x + 285, p.y, p.x + 570])

    const f1 = node(graph, `scene:${s1.id}`)
    const f2 = node(graph, `scene:${s2.id}`)
    expect(f1?.x).toBe(p.x - 24)
    expect(f1?.y).toBe(p.y - 44)
    expect((f1?.y ?? 0) + (f1?.height ?? 0)).toBeLessThan(f2?.y ?? 0)
    expect(r.y).toBeGreaterThan((f1?.y ?? 0) + (f1?.height ?? 0))
  })

  it('移動：存下位置、其他節點不動；整串移動後場框貼合新位置；沒有位置的節點仍是自動排版', () => {
    const { canvas, repos, events } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: 'A' })
    const a = repos.shots.create({ sceneId: scene.id })
    const b = repos.shots.create({ sceneId: scene.id })
    const before = canvas.get()
    const keyA = `shot:${a.id}`
    const startA = node(before, keyA)

    canvas.move({
      moves: [
        { key: keyA, x: 1000, y: 700 },
        { key: `${keyA}:image`, x: 1285, y: 700 },
      ],
    })
    expect(events.at(-1)).toEqual({ revision: 1 })
    const after = canvas.get()
    expect(node(after, keyA)).toMatchObject({ x: 1000, y: 700, auto: false })
    // 鏡頭的圖有存位置，影片沒存：影片跟著鏡頭走（鏡頭的位置＋570）
    expect(node(after, `${keyA}:image`)).toMatchObject({ x: 1285, y: 700, auto: false })
    expect(node(after, `${keyA}:video`)).toMatchObject({ x: 1570, y: 700, auto: true })
    expect(node(after, `shot:${b.id}`)).toEqual(node(before, `shot:${b.id}`))
    expect(startA?.auto).toBe(true)
    // 場框把被拖到遠處的成員也框進來
    const frame = node(after, `scene:${scene.id}`)
    expect((frame?.x ?? 0) + (frame?.width ?? 0)).toBeGreaterThan(1570)
  })

  it('視角：存了就讀得到；移動可以復原（用歷史），視角不進歷史', () => {
    const { canvas, repos, history } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: 'A' })
    const shot = repos.shots.create({ sceneId: scene.id })
    const key = `shot:${shot.id}`
    const origin = node(canvas.get(), key)

    canvas.viewport({ x: -50, y: 20, zoom: 0.8 })
    expect(canvas.get().viewport).toEqual({ x: -50, y: 20, zoom: 0.8 })
    history.record('移動位置', () => {
      canvas.move({ moves: [{ key, x: 5, y: 6 }] })
    })
    expect(node(canvas.get(), key)).toMatchObject({ x: 5, y: 6, auto: false })
    history.undo()
    expect(node(canvas.get(), key)).toMatchObject({ x: origin?.x, y: origin?.y, auto: true })
    expect(canvas.get().viewport).toEqual({ x: -50, y: 20, zoom: 0.8 })
  })

  it('自由節點與連線也投影出來；指到不存在節點的連線會被略過', () => {
    const { canvas, repos } = setup()
    const one = repos.canvas.addNode({
      type: 'oneliner',
      params: { story: '一隻貓找到家' },
      x: 40,
      y: 90,
    })
    const note = repos.canvas.addNode({ type: 'note', params: { text: '想法' }, x: 50, y: 400 })
    repos.canvas.addEdge({
      sourceKey: `node:${one.id}`,
      sourcePort: 'story-out',
      targetKey: `node:${note.id}`,
      targetPort: 'in',
      kind: 'data',
    })
    repos.canvas.addEdge({
      sourceKey: `node:${one.id}`,
      sourcePort: 'story-out',
      targetKey: 'scene:missing',
      targetPort: 'scene-story',
      kind: 'data',
    })
    const graph = canvas.get()
    expect(node(graph, `node:${one.id}`)).toMatchObject({
      kind: 'oneliner',
      title: '一句話',
      summary: '一隻貓找到家',
      x: 40,
      y: 90,
      auto: false,
    })
    expect(graph.edges.filter((e) => e.free)).toHaveLength(1)
  })

  it('沒歸到場的鏡頭排在最後面、沒有場框', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: 'A' })
    repos.shots.create({ sceneId: scene.id })
    const loose = repos.shots.create({ description: '還沒分場' })
    const graph = canvas.get()
    const looseShot = node(graph, `shot:${loose.id}`)
    expect(looseShot?.sceneKey).toBeUndefined()
    expect(looseShot?.x).toBeGreaterThan(node(graph, `scene:${scene.id}`)?.x ?? 0)
    expect(graph.nodes.filter((n) => n.kind === 'scene')).toHaveLength(1)
  })

  // 250 鏡的畫布，一鏡配兩鏡一場；回傳已經暖機過的 canvas
  const seed = (shots: number) => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const sceneIds = Array.from(
      { length: shots / 2 },
      (_, i) => repos.outline.addScene(act.id, { title: `場${String(i + 1)}` }).id,
    )
    repos.characters.create('阿鐵')
    for (let i = 0; i < shots; i++) {
      const shot = repos.shots.create({
        sceneId: sceneIds[Math.floor(i / 2)],
        description: `第 ${String(i)} 鏡`,
        characters: [{ name: '阿鐵' }],
      })
      if (i % 3 === 0) {
        repos.shots.addTake({
          shotId: shot.id,
          kind: 'first_frame',
          assetHash: HASH('a'),
          modelId: 'm',
        })
      }
    }
    canvas.get() // 先暖機
    return canvas
  }

  it('鏡頭變 4 倍，canvas.get 的時間不會多到 7 倍以上（不是平方）：60 鏡對 240 鏡', () => {
    // 不比「幾毫秒」：絕對毫秒數會看機器臉色（開發機同時跑好幾個專案、CI 的慢機器、整套並行都會拖慢）。
    // 改比同一台機器、同一次測試裡 60 鏡與 240 鏡的 CPU 時間（只算這個行程自己用掉的）：
    // 線性約 4 倍以內（有固定成本時更少；實測 CI 3.0～3.8、本機 1.9～3.7），平方約 16 倍，門檻 7 倍在中間。
    const small = seed(60)
    const large = seed(240)
    // 60 鏡 × 3 ＋ 30 個場框 ＋ 角色 ＋ 剪輯；240 鏡 × 3 ＋ 120 個場框 ＋ 角色 ＋ 剪輯
    expect(large.get().nodes.length).toBeGreaterThan(small.get().nodes.length * 3)
    const { ratio, smallMs, largeMs } = scalingRatio(
      () => small.get(),
      () => large.get(),
    )
    expect(ratio, `60 鏡 ${smallMs.toFixed(1)} ms、240 鏡 ${largeMs.toFixed(1)} ms`).toBeLessThan(7)
  })

  it('常數倍的退步：250 鏡的 canvas.get，CPU 時間（取 7 次最小）不超過 220 毫秒', () => {
    // 倍數看不出「每個鏡頭多算一次」這種常數倍的退步（複雜度還是線性；#150 就是這樣慢了 2～3 倍，CI 上量到 280 毫秒）。
    // 量的是這個行程的 CPU 時間，不是牆鐘時間：整套並行、機器忙不會讓它變長。量測：CI（開 coverage、4 個行程並行）
    // 97～130 毫秒，本機 40～75 毫秒；門檻 220 毫秒離 CI 最慢的 130 還有 1.7 倍，CI 上慢 2 倍以上會紅。
    const canvas = seed(250)
    let graph = canvas.get()
    let best = Infinity
    for (let i = 0; i < 7; i++) {
      const start = cpuNowMs()
      graph = canvas.get()
      best = Math.min(best, cpuNowMs() - start)
    }
    // 250 鏡 × 3 ＋ 125 個場框 ＋ 角色 ＋ 剪輯
    expect(graph.nodes).toHaveLength(877)
    expect(best).toBeLessThan(220)
  })
})

describe('canvas.add：從畫布新增場、鏡頭、角色、地點', () => {
  const edge = (graph: CanvasGraph, source: string, target: string) =>
    graph.edges.find((e) => e.source === source && e.target === target)

  it('還沒有專案：新增場會自動建專案與一幕，只多一個場；新增的場出現在畫布上', () => {
    const harness = createStudioHarness()
    harnesses.push(harness)
    const { canvas, outline } = harness
    const result = canvas.add({ kind: 'scene' })
    expect(result.key).toMatch(/^scene:/)
    expect(outline.get().acts).toHaveLength(1)
    // 新增一幕時附的那個場就是這次新增的，不會多一個空的場
    expect(outline.get().acts[0]?.scenes.map((s) => `scene:${s.id}`)).toEqual([result.key])
    expect(canvas.get().nodes.find((n) => n.key === result.key)).toMatchObject({ kind: 'scene' })
    expect(harness.events.some((e) => e.name === 'canvas.changed')).toBe(true)
  })

  it('鏡頭放進指定的場；沒指定就放最後一場', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const first = repos.outline.addScene(act.id, { title: 'A' })
    const last = repos.outline.addScene(act.id, { title: 'B' })
    const inFirst = canvas.add({ kind: 'shot', sceneKey: `scene:${first.id}` })
    const inLast = canvas.add({ kind: 'shot' })
    const graph = canvas.get()
    expect(node(graph, inFirst.key)).toMatchObject({ sceneKey: `scene:${first.id}` })
    expect(node(graph, inLast.key)).toMatchObject({ sceneKey: `scene:${last.id}` })
    expect(inLast.title).toBe('第 2 鏡')
  })

  it('從角色的輸出點新增鏡頭：鏡頭的出場角色有這個角色，畫布上多一條參考線', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    repos.outline.addScene(act.id, { title: 'A' })
    const hero = repos.characters.create('阿鐵')
    const result = canvas.add({
      kind: 'shot',
      from: { key: `character:${hero.id}`, port: 'char-out', side: 'out' },
    })
    const graph = canvas.get()
    expect(node(graph, result.key)?.tags).toEqual(['阿鐵'])
    expect(edge(graph, `character:${hero.id}`, result.key)).toMatchObject({
      sourcePort: 'char-out',
      targetPort: 'shot-ref-char',
      kind: 'reference',
    })
  })

  it('從地點的輸出點新增：鏡頭或場都指到這個地點', () => {
    const { canvas, repos, outline } = setup()
    const act = repos.outline.addAct({ title: '一' })
    repos.outline.addScene(act.id, { title: 'A' })
    const loc = repos.outline.addLocation({ name: '舊倉庫' })
    const from = { key: `location:${loc.id}`, port: 'loc-out', side: 'out' } as const
    const shot = canvas.add({ kind: 'shot', from })
    const scene = canvas.add({ kind: 'scene', from })
    const graph = canvas.get()
    expect(edge(graph, from.key, shot.key)?.targetPort).toBe('shot-ref-loc')
    expect(edge(graph, from.key, scene.key)?.targetPort).toBe('scene-loc')
    expect(
      outline
        .get()
        .acts.flatMap((a) => a.scenes)
        .find((s) => `scene:${s.id}` === scene.key)?.locationId,
    ).toBe(loc.id)
  })

  it('新增角色：名字不跟現有的撞；有給位置就放在那裡', () => {
    const { canvas } = setup()
    const one = canvas.add({ kind: 'character', x: 320, y: 480 })
    const two = canvas.add({ kind: 'character' })
    expect([one.title, two.title]).toEqual(['新角色', '新角色 2'])
    const graph = canvas.get()
    expect(node(graph, one.key)).toMatchObject({ x: 320, y: 480, auto: false })
    expect(node(graph, two.key)?.auto).toBe(true)
  })

  it('從鏡頭的角色輸入點新增角色：加進這一鏡的出場角色（原本的保留）', () => {
    const { canvas, repos } = setup()
    const hero = repos.characters.create('阿鐵')
    const shot = repos.shots.create({
      description: 'x',
      characters: [{ characterId: hero.id, name: '阿鐵' }],
    })
    const result = canvas.add({
      kind: 'character',
      from: { key: `shot:${shot.id}`, port: 'shot-ref-char', side: 'in' },
    })
    expect(node(canvas.get(), `shot:${shot.id}`)?.tags).toEqual(['阿鐵', result.title])
  })

  it('從鏡頭或場的地點輸入點新增地點：接上這個新地點', () => {
    const { canvas, repos } = setup()
    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: 'A' })
    const shot = repos.shots.create({ sceneId: scene.id, description: 'x' })
    const forShot = canvas.add({
      kind: 'location',
      x: 0,
      y: 0,
      from: { key: `shot:${shot.id}`, port: 'shot-ref-loc', side: 'in' },
    })
    const forScene = canvas.add({
      kind: 'location',
      from: { key: `scene:${scene.id}`, port: 'scene-loc', side: 'in' },
    })
    const graph = canvas.get()
    expect(edge(graph, forShot.key, `shot:${shot.id}`)?.targetPort).toBe('shot-ref-loc')
    expect(edge(graph, forScene.key, `scene:${scene.id}`)?.targetPort).toBe('scene-loc')
  })

  it('接不起來的連接點：丟白話錯誤，而且什麼都沒新增', () => {
    const { canvas, repos, characters } = setup()
    const hero = repos.characters.create('阿鐵')
    expect(() =>
      canvas.add({
        kind: 'character',
        from: { key: `character:${hero.id}`, port: 'char-out', side: 'out' },
      }),
    ).toThrow('還不能接')
    expect(() =>
      canvas.add({
        kind: 'shot',
        from: { key: 'character:不存在', port: 'char-out', side: 'out' },
      }),
    ).toThrow('找不到這個角色')
    expect(characters.list()).toHaveLength(1)
    expect(repos.shots.list()).toHaveLength(0)
  })

  it('記進歷史：復原新增鏡頭就消失，重做又回來；新增角色不記（復原不會動到它）', () => {
    const { canvas, history, repos } = setup()
    const result = history.record('新增鏡頭', () => canvas.add({ kind: 'shot' }))
    expect(node(canvas.get(), result.key)).toBeDefined()
    history.undo()
    expect(node(canvas.get(), result.key)).toBeUndefined()
    history.redo()
    expect(node(canvas.get(), result.key)).toBeDefined()

    const stateBefore = history.state()
    canvas.add({ kind: 'character', x: 1, y: 2 })
    expect(repos.characters.list()).toHaveLength(1)
    expect(history.state()).toEqual(stateBefore)
  })
})

describe('canvas.move：鏡頭拖進另一個場', () => {
  function twoScenes() {
    const env = setup()
    const act = env.repos.outline.addAct({ title: '一' })
    const s1 = env.repos.outline.addScene(act.id, { title: 'A' })
    const s2 = env.repos.outline.addScene(act.id, { title: 'B' })
    const a = env.repos.shots.create({ sceneId: s1.id, description: 'a' })
    const b = env.repos.shots.create({ sceneId: s1.id, description: 'b' })
    const c = env.repos.shots.create({ sceneId: s2.id, description: 'c' })
    return { ...env, act, s1, s2, a, b, c }
  }
  const order = (repos: ReturnType<typeof setup>['repos']): string[] =>
    repos.shots.list().map((s) => s.description)

  it('改所屬的場、放在目標場的最後面、鏡號依場的順序重排，位置一起存', () => {
    const { canvas, repos, a, s2 } = twoScenes()
    canvas.move({
      moves: [{ key: `shot:${a.id}`, x: 640, y: 480 }],
      reparent: { shotKey: `shot:${a.id}`, sceneKey: `scene:${s2.id}` },
    })
    expect(repos.shots.get(a.id)?.sceneId).toBe(s2.id)
    expect(order(repos)).toEqual(['b', 'c', 'a'])
    expect(repos.shots.list().map((s) => s.number)).toEqual([1, 2, 3])
    const graph = canvas.get()
    expect(node(graph, `shot:${a.id}`)).toMatchObject({
      x: 640,
      y: 480,
      sceneKey: `scene:${s2.id}`,
      title: '第 3 鏡',
    })
  })

  it('目標場還沒有鏡頭：接在前面各場的鏡頭後面', () => {
    const { canvas, repos, act, a } = twoScenes()
    const s3 = repos.outline.addScene(act.id, { title: 'C' })
    canvas.move({
      moves: [{ key: `shot:${a.id}`, x: 1, y: 2 }],
      reparent: { shotKey: `shot:${a.id}`, sceneKey: `scene:${s3.id}` },
    })
    expect(order(repos)).toEqual(['b', 'c', 'a'])
    expect(repos.shots.get(a.id)?.sceneId).toBe(s3.id)
  })

  it('找不到場或鏡頭：丟白話錯誤，位置也不存', () => {
    const { canvas, repos, a } = twoScenes()
    expect(() => {
      canvas.move({
        moves: [{ key: `shot:${a.id}`, x: 9, y: 9 }],
        reparent: { shotKey: `shot:${a.id}`, sceneKey: 'scene:不存在' },
      })
    }).toThrow('找不到這個場')
    expect(() => {
      canvas.move({
        moves: [{ key: 'shot:x', x: 9, y: 9 }],
        reparent: { shotKey: 'shot:不存在', sceneKey: 'scene:x' },
      })
    }).toThrow('找不到這個鏡頭')
    expect(repos.canvas.positions().size).toBe(0)
  })

  it('同一場內移動只存位置，不動鏡號；整個動作可以一次復原與重做', () => {
    const { canvas, repos, history, a, s1, s2 } = twoScenes()
    canvas.move({
      moves: [{ key: `shot:${a.id}`, x: 7, y: 8 }],
      reparent: { shotKey: `shot:${a.id}`, sceneKey: `scene:${s1.id}` },
    })
    expect(order(repos)).toEqual(['a', 'b', 'c'])

    history.record('把鏡頭移到另一場', () => {
      canvas.move({
        moves: [{ key: `shot:${a.id}`, x: 300, y: 400 }],
        reparent: { shotKey: `shot:${a.id}`, sceneKey: `scene:${s2.id}` },
      })
    })
    expect(order(repos)).toEqual(['b', 'c', 'a'])
    history.undo()
    expect(order(repos)).toEqual(['a', 'b', 'c'])
    expect(repos.shots.get(a.id)?.sceneId).toBe(s1.id)
    expect(node(canvas.get(), `shot:${a.id}`)).toMatchObject({ x: 7, y: 8 })
    history.redo()
    expect(order(repos)).toEqual(['b', 'c', 'a'])
    expect(node(canvas.get(), `shot:${a.id}`)).toMatchObject({ x: 300, y: 400 })
  })
})

describe('canvas.link／unlink／remove：拉線、剪線與刪除', () => {
  function world() {
    const env = setup()
    const act = env.repos.outline.addAct({ title: '一' })
    const loc = env.repos.outline.addLocation({ name: '舊倉庫' })
    const loc2 = env.repos.outline.addLocation({ name: '街角' })
    const scene = env.repos.outline.addScene(act.id, { title: 'A' })
    const hero = env.repos.characters.create('阿鐵')
    const shot = env.repos.shots.create({ sceneId: scene.id, description: '貓在雨裡' })
    const other = env.repos.shots.create({ sceneId: scene.id, description: '貓抬頭' })
    const edgeKinds = () => env.canvas.get().edges.map((e) => `${e.source}->${e.target}`)
    return { ...env, loc, loc2, scene, hero, shot, other, edgeKinds }
  }
  const charLink = (characterId: string, shotId: string) => ({
    source: { key: `character:${characterId}`, port: 'char-out' },
    target: { key: `shot:${shotId}`, port: 'shot-ref-char' },
  })
  const locLink = (locationId: string, key: string, port: string) => ({
    source: { key: `location:${locationId}`, port: 'loc-out' },
    target: { key, port },
  })

  it('角色接到鏡頭：出場角色多一個、畫布多一條參考線；重複接丟「已經在這一鏡」；剪線就拿掉', () => {
    const { canvas, repos, hero, shot, edgeKinds } = world()
    canvas.link(charLink(hero.id, shot.id))
    expect(repos.shots.get(shot.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
    expect(edgeKinds()).toContain(`character:${hero.id}->shot:${shot.id}`)
    expect(() => {
      canvas.link(charLink(hero.id, shot.id))
    }).toThrow('阿鐵已經在這一鏡')
    canvas.unlink(charLink(hero.id, shot.id))
    expect(repos.shots.get(shot.id)?.characters).toEqual([])
    expect(edgeKinds()).not.toContain(`character:${hero.id}->shot:${shot.id}`)
  })

  it('地點接到鏡頭或場；已經有別的地點要先剪線；剪線拿掉', () => {
    const { canvas, repos, loc, loc2, scene, shot } = world()
    canvas.link(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    expect(repos.shots.get(shot.id)?.locationId).toBe(loc.id)
    expect(() => {
      canvas.link(locLink(loc2.id, `shot:${shot.id}`, 'shot-ref-loc'))
    }).toThrow('這一鏡已經有地點了')
    expect(() => {
      canvas.link(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    }).toThrow('已經接在一起')
    canvas.unlink(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    expect(repos.shots.get(shot.id)?.locationId).toBeUndefined()

    canvas.link(locLink(loc2.id, `scene:${scene.id}`, 'scene-loc'))
    expect(repos.outline.listScenes()[0]?.locationId).toBe(loc2.id)
    expect(() => {
      canvas.link(locLink(loc.id, `scene:${scene.id}`, 'scene-loc'))
    }).toThrow('這一場已經有地點了')
    canvas.unlink(locLink(loc2.id, `scene:${scene.id}`, 'scene-loc'))
    expect(repos.outline.listScenes()[0]?.locationId).toBeUndefined()
  })

  it('改接：角色換到另一個鏡頭；地點換成別的地點（鏡頭、場）——舊的拿掉、新的接上、畫布的線跟著換', () => {
    const { canvas, repos, hero, loc, loc2, scene, shot, other, edgeKinds } = world()
    canvas.link(charLink(hero.id, shot.id))
    canvas.relink({ from: charLink(hero.id, shot.id), to: charLink(hero.id, other.id) })
    expect(repos.shots.get(shot.id)?.characters).toEqual([])
    expect(repos.shots.get(other.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
    expect(edgeKinds()).toContain(`character:${hero.id}->shot:${other.id}`)
    expect(edgeKinds()).not.toContain(`character:${hero.id}->shot:${shot.id}`)

    canvas.link(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    canvas.relink({
      from: locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'),
      to: locLink(loc2.id, `shot:${shot.id}`, 'shot-ref-loc'),
    })
    expect(repos.shots.get(shot.id)?.locationId).toBe(loc2.id)

    canvas.link(locLink(loc.id, `scene:${scene.id}`, 'scene-loc'))
    canvas.relink({
      from: locLink(loc.id, `scene:${scene.id}`, 'scene-loc'),
      to: locLink(loc2.id, `scene:${scene.id}`, 'scene-loc'),
    })
    expect(repos.outline.listScenes()[0]?.locationId).toBe(loc2.id)
  })

  it('改接接不上：原本的線接回去，資料一點都沒變，丟白話錯誤', () => {
    const { canvas, repos, hero, loc, shot } = world()
    canvas.link(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    canvas.link(charLink(hero.id, shot.id))
    // 地點接到角色的連接點：接不起來
    expect(() => {
      canvas.relink({
        from: locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'),
        to: locLink(loc.id, `shot:${shot.id}`, 'shot-ref-char'),
      })
    }).toThrow()
    expect(repos.shots.get(shot.id)?.locationId).toBe(loc.id)
    // 角色換到一個不存在的鏡頭
    expect(() => {
      canvas.relink({ from: charLink(hero.id, shot.id), to: charLink(hero.id, 'nope') })
    }).toThrow('找不到這個鏡頭')
    expect(repos.shots.get(shot.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
  })

  it('接不起來的線與找不到的東西：丟白話錯誤，什麼都不改', () => {
    const { canvas, repos, hero, shot } = world()
    expect(() => {
      canvas.link({
        source: { key: `shot:${shot.id}`, port: 'shot-out' },
        target: { key: `shot:${shot.id}:image`, port: 'img-in' },
      })
    }).toThrow('這裡接不起來')
    expect(() => {
      canvas.link(charLink('不存在', shot.id))
    }).toThrow('找不到這個角色')
    expect(() => {
      canvas.link(charLink(hero.id, '不存在'))
    }).toThrow('找不到這個鏡頭')
    expect(repos.shots.get(shot.id)?.characters).toEqual([])
  })

  it('拉線與剪線都記進歷史：復原就回到原樣、重做又接上', () => {
    const { canvas, repos, history, hero, shot } = world()
    history.record('接上線', () => {
      canvas.link(charLink(hero.id, shot.id))
    })
    history.record('剪掉線', () => {
      canvas.unlink(charLink(hero.id, shot.id))
    })
    expect(repos.shots.get(shot.id)?.characters).toEqual([])
    history.undo()
    expect(repos.shots.get(shot.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
    history.undo()
    expect(repos.shots.get(shot.id)?.characters).toEqual([])
    history.redo()
    expect(repos.shots.get(shot.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
  })

  it('刪除鏡頭：連同圖與影片節點消失、鏡號重排、存下來的位置也清掉；可以復原', () => {
    const { canvas, repos, history, shot, other } = world()
    canvas.move({
      moves: [
        { key: `shot:${shot.id}`, x: 5, y: 5 },
        { key: `shot:${shot.id}:video`, x: 9, y: 9 },
      ],
    })
    const result = history.record('刪除', () => canvas.remove({ keys: [`shot:${shot.id}`] }))
    expect(result).toEqual({ removed: 1 })
    const graph = canvas.get()
    expect(graph.nodes.filter((n) => n.key.startsWith(`shot:${shot.id}`))).toEqual([])
    expect(node(graph, `shot:${other.id}`)?.title).toBe('第 1 鏡')
    expect(repos.canvas.positions().size).toBe(0)
    history.undo()
    expect(node(canvas.get(), `shot:${shot.id}`)).toBeDefined()
    expect(node(canvas.get(), `shot:${other.id}`)?.title).toBe('第 2 鏡')
  })

  it('刪除場：鏡頭留著只是不分場；刪除地點：指到它的場與鏡頭清空；刪除角色：角色節點消失', () => {
    const { canvas, repos, loc, scene, shot, hero } = world()
    canvas.link(locLink(loc.id, `shot:${shot.id}`, 'shot-ref-loc'))
    expect(
      canvas.remove({ keys: [`scene:${scene.id}`, `location:${loc.id}`, `character:${hero.id}`] }),
    ).toEqual({ removed: 3 })
    const graph = canvas.get()
    expect(node(graph, `scene:${scene.id}`)).toBeUndefined()
    expect(node(graph, `shot:${shot.id}`)).toBeDefined()
    expect(node(graph, `shot:${shot.id}`)?.sceneKey).toBeUndefined()
    expect(repos.shots.get(shot.id)?.locationId).toBeUndefined()
    expect(node(graph, `location:${loc.id}`)).toBeUndefined()
    expect(node(graph, `character:${hero.id}`)).toBeUndefined()
  })

  it('刪除角色：出場的鏡頭拿掉它；復原後角色、角色卡版本、概念圖、出場關係都回來', () => {
    const { canvas, history, repos, hero, shot } = world()
    canvas.link(charLink(hero.id, shot.id))
    repos.characters.setAnchor(hero.id, '短黑髮、琥珀色眼睛')
    repos.characters.lock(hero.id)
    repos.characters.addConcept({
      characterId: hero.id,
      round: 1,
      slot: 0,
      assetHash: HASH('c'),
      modelId: 'img',
    })
    history.record('刪除', () => canvas.remove({ keys: [`character:${hero.id}`] }))
    expect(repos.characters.get(hero.id)).toBeUndefined()
    expect(repos.shots.get(shot.id)?.characters).toEqual([])

    history.undo()
    expect(repos.characters.get(hero.id)?.name).toBe('阿鐵')
    expect(repos.characters.pack(hero.id)).toMatchObject({ status: 'locked', version: 1 })
    expect(repos.characters.packs(hero.id)).toHaveLength(1)
    expect(repos.shots.get(shot.id)?.characters.map((c) => c.name)).toEqual(['阿鐵'])
    expect(node(canvas.get(), `character:${hero.id}`)).toBeDefined()
  })

  it('刪剪輯、刪不存在的（包括不存在的鏡頭的圖）：丟白話錯誤，而且什麼都沒刪', () => {
    const { canvas, repos, shot } = world()
    expect(() => canvas.remove({ keys: ['shot:不存在:image', `shot:${shot.id}`] })).toThrow(
      '找不到',
    )
    expect(() => canvas.remove({ keys: ['cut'] })).toThrow('不能刪除')
    expect(() => canvas.remove({ keys: [`shot:${shot.id}`, 'scene:不存在'] })).toThrow(
      '找不到這個場',
    )
    expect(repos.shots.list()).toHaveLength(2)
  })
})
