import { describe, expect, it } from 'vitest'

import { SCENE_PAD } from './canvas-model'
import { makeDemo, normalize } from '../../test/canvas-demo'
import {
  boundsOf,
  chainOf,
  freeSpot,
  visibleRect,
  membersOf,
  nextSlot,
  panToReveal,
  placeChain,
  rectOf,
  refreshFrames,
  renumberShots,
  sceneAt,
  sceneOrder,
  snapToNodes,
} from './geometry'

describe('場框', () => {
  it('貼合成員的外框，加上內距與標題列', () => {
    const graph = makeDemo(4)
    const scene0 = graph.nodes.find((n) => n.id === 'scene:0')
    const members = membersOf(graph.nodes, 'scene:0')
    expect(members).toHaveLength(6)
    const box = boundsOf(members)
    expect(scene0?.position).toEqual({ x: box?.x, y: box?.y })
    expect(scene0?.width).toBe(box?.w)
    expect(scene0?.height).toBe(box?.h)
    const minX = Math.min(...members.map((m) => m.position.x))
    expect(box?.x).toBe(minX - SCENE_PAD.x)
  })

  it('成員移動後場框跟著伸縮；沒有變化就回傳同一個陣列', () => {
    const graph = makeDemo(4)
    expect(refreshFrames(graph.nodes)).toBe(graph.nodes)
    const moved = graph.nodes.map((n) =>
      n.id === 'shot:1' ? { ...n, position: { x: n.position.x, y: n.position.y + 400 } } : n,
    )
    const next = refreshFrames(moved)
    const before = graph.nodes.find((n) => n.id === 'scene:0')
    const after = next.find((n) => n.id === 'scene:0')
    expect((after?.height ?? 0) - (before?.height ?? 0)).toBeGreaterThan(300)
  })

  it('略過某些成員時，場框不再撐著它們', () => {
    const graph = makeDemo(4)
    const away = new Set(chainOf(graph.nodes, 'shot:1').map((n) => n.id))
    const moved = graph.nodes.map((n) =>
      away.has(n.id) ? { ...n, position: { x: n.position.x, y: n.position.y + 900 } } : n,
    )
    const hugged = refreshFrames(moved).find((n) => n.id === 'scene:0')
    const skipped = refreshFrames(moved, away).find((n) => n.id === 'scene:0')
    expect((hugged?.height ?? 0) - (skipped?.height ?? 0)).toBeGreaterThan(500)
  })

  it('找得到某個點在哪個場框裡，自己原本的場可以排除', () => {
    const graph = makeDemo(4)
    const two = graph.nodes.find((n) => n.id === 'scene:1')
    if (!two) throw new Error('沒有第 2 場')
    const inside = { x: two.position.x + 100, y: two.position.y + 100 }
    expect(sceneAt(graph.nodes, inside)?.id).toBe('scene:1')
    expect(sceneAt(graph.nodes, inside, 'scene:1')).toBeUndefined()
    expect(sceneAt(graph.nodes, { x: -5000, y: -5000 })).toBeUndefined()
  })
})

describe('整串移動與新位置', () => {
  it('chainOf：鏡頭、圖、影片同一串', () => {
    const graph = makeDemo(4)
    expect(
      chainOf(graph.nodes, 'shot:2')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['shot:2', 'shot:2:image', 'shot:2:video'])
    expect(chainOf(graph.nodes, undefined)).toEqual([])
  })

  it('placeChain 把整串放到指定位置，保持彼此的相對位置', () => {
    const graph = makeDemo(4)
    const shot = graph.nodes.find((n) => n.id === 'shot:0')
    const video = graph.nodes.find((n) => n.id === 'shot:0:video')
    if (!shot || !video) throw new Error('沒有鏡頭')
    const gapX = video.position.x - shot.position.x
    const placed = placeChain(graph.nodes, 'shot:0', { x: 1000, y: 2000 })
    const newShot = placed.find((n) => n.id === 'shot:0')
    const newVideo = placed.find((n) => n.id === 'shot:0:video')
    expect(newShot?.position).toEqual({ x: 1000, y: 2000 })
    expect((newVideo?.position.x ?? 0) - 1000).toBe(gapX)
    expect(newVideo?.position.y).toBe(2000)
  })

  it('nextSlot：放在這個場最後一列的下面；空的場放在框的左上', () => {
    const graph = makeDemo(4)
    const scene = graph.nodes.find((n) => n.id === 'scene:0')
    const last = graph.nodes.find((n) => n.id === 'shot:1')
    if (!scene || !last) throw new Error('沒有場')
    expect(nextSlot(graph.nodes, scene)).toEqual({
      x: last.position.x,
      y: last.position.y + 256,
    })
    const empty = { ...scene, id: 'scene:empty' }
    expect(nextSlot(graph.nodes, empty)).toEqual({
      x: scene.position.x + SCENE_PAD.x,
      y: scene.position.y + SCENE_PAD.top,
    })
  })

  it('連到「出場角色」的線決定鏡頭上的角色標籤（連線就是資料）', () => {
    const graph = makeDemo(4)
    const tagsOf = (id: string): string[] | undefined =>
      graph.nodes.find((n) => n.id === id)?.data.tags
    expect(tagsOf('shot:0')).toEqual(['阿鐵', '小花'])
    expect(tagsOf('shot:1')).toEqual([])
    const withoutEdges = normalize({
      ...graph,
      edges: graph.edges.filter((e) => e.targetHandle !== 'shot-ref-char'),
    })
    expect(withoutEdges.nodes.find((n) => n.id === 'shot:0')?.data.tags).toEqual([])
  })
})

describe('對齊輔助線', () => {
  const other = { x: 100, y: 100, w: 200, h: 100 }

  it('邊緣離其他節點 5px 內就吸附，並給一條輔助線', () => {
    const snapped = snapToNodes({ x: 103, y: 400, w: 150, h: 80 }, [other], 1)
    expect(snapped.x).toBe(100)
    expect(snapped.y).toBe(400)
    expect(snapped.guides).toHaveLength(1)
    expect(snapped.guides[0]).toMatchObject({ axis: 'x', at: 100 })
  })

  it('中線也能對齊（水平方向）：自己的上緣 148 離對方的中線 150 只差 2', () => {
    const snapped = snapToNodes({ x: 500, y: 148, w: 120, h: 40 }, [other], 1)
    expect(snapped.y).toBe(150)
    expect(snapped.guides.some((g) => g.axis === 'y' && g.at === 150)).toBe(true)
  })

  it('超過 5 個畫面像素就不吸附；縮小時「5px」是畫面上的 5px', () => {
    const far = snapToNodes({ x: 108, y: 400, w: 150, h: 80 }, [other], 1)
    expect(far.x).toBe(108)
    expect(far.guides).toHaveLength(0)
    // 縮放 0.5：畫面 5px＝畫布 10px，108 離 100 只有 8，會吸附
    expect(snapToNodes({ x: 108, y: 400, w: 150, h: 80 }, [other], 0.5).x).toBe(100)
  })
})

describe('新節點的空位', () => {
  const { nodes } = makeDemo(2)
  const size = { w: 220, h: 200 }
  const hits = (at: { x: number; y: number }): boolean =>
    nodes.some((n) => {
      const r = rectOf(n)
      return at.x < r.x + r.w && at.x + size.w > r.x && at.y < r.y + r.h && at.y + size.h > r.y
    })

  it('想放的地方是空的就放那裡', () => {
    expect(freeSpot(nodes, size, { x: -2000, y: -2000 })).toEqual({ x: -2000, y: -2000 })
  })

  it('被節點或場框佔住就找最近的空位，而且不跟任何東西重疊', () => {
    const scene = sceneOrder(nodes)[0]
    if (!scene) throw new Error('沒有場')
    const want = { x: scene.position.x + 100, y: scene.position.y + 100 }
    expect(hits(want)).toBe(true)
    const spot = freeSpot(nodes, size, want)
    expect(hits(spot)).toBe(false)
    expect(spot).not.toEqual(want)
  })
})

describe('新節點只放在看得到的範圍', () => {
  const { nodes } = makeDemo(2)
  const size = { w: 220, h: 200 }
  const margin = { top: 80, left: 260, right: 48, bottom: 72 }

  it('畫面上看得到的那一塊（換成畫布座標，跟著平移與縮放）', () => {
    expect(visibleRect({ x: 0, y: 0, zoom: 1 }, { width: 1440, height: 868 }, margin)).toEqual({
      x: 260,
      y: 80,
      w: 1132,
      h: 716,
    })
    expect(
      visibleRect({ x: -100, y: 50, zoom: 0.5 }, { width: 1440, height: 868 }, margin),
    ).toEqual({
      x: 720,
      y: 60,
      w: 2264,
      h: 1432,
    })
    expect(
      visibleRect({ x: 0, y: 0, zoom: 1 }, { width: 300, height: 100 }, margin),
    ).toBeUndefined()
  })

  it('想放的地方在上方列底下：挪到看得到的最近空位，整個節點都在範圍裡', () => {
    const within = { x: 260, y: 80, w: 1132, h: 716 }
    const want = { x: 800, y: 20 }
    const spot = freeSpot([], size, want, undefined, undefined, within)
    expect(spot.y).toBeGreaterThanOrEqual(within.y)
    expect(spot.y + size.h).toBeLessThanOrEqual(within.y + within.h)
    expect(spot.x).toBe(800)
    // 不給範圍就照舊放在想放的地方
    expect(freeSpot([], size, want)).toEqual(want)
  })

  it('被佔住又靠近邊緣：找到的空位也在範圍裡、不跟節點重疊', () => {
    const scene = sceneOrder(nodes)[0]
    if (!scene) throw new Error('沒有場')
    const all = boundsOf(nodes)
    if (!all) throw new Error('沒有節點')
    // 範圍比所有節點的外框再大一圈：裡面一定有空位，但離想放的地方有一段距離
    const within = { x: all.x - 300, y: all.y - 300, w: all.w + 600, h: all.h + 600 }
    const spot = freeSpot(
      nodes,
      size,
      { x: scene.position.x + 100, y: scene.position.y + 20 },
      undefined,
      undefined,
      within,
    )
    expect(spot.x).toBeGreaterThanOrEqual(within.x)
    expect(spot.y).toBeGreaterThanOrEqual(within.y)
    expect(spot.x + size.w).toBeLessThanOrEqual(within.x + within.w)
    expect(spot.y + size.h).toBeLessThanOrEqual(within.y + within.h)
    const hit = nodes.some((n) => {
      const r = rectOf(n)
      return (
        spot.x < r.x + r.w && spot.x + size.w > r.x && spot.y < r.y + r.h && spot.y + size.h > r.y
      )
    })
    expect(hit).toBe(false)
  })

  it('範圍裡放不下（比節點還小）：退回不限範圍，不會找不到位置', () => {
    const tiny = { x: 0, y: 0, w: 50, h: 50 }
    expect(freeSpot([], size, { x: 500, y: 500 }, undefined, undefined, tiny)).toEqual({
      x: 500,
      y: 500,
    })
  })
})

describe('讓新節點進到看得見的地方', () => {
  const size = { width: 1000, height: 600 }
  const viewport = { x: 0, y: 0, zoom: 1 }

  it('已經看得見就不動', () => {
    expect(panToReveal(viewport, size, { x: 200, y: 200, w: 100, h: 100 })).toBeUndefined()
  })

  it('在畫面外就平移到剛好看得見（留 48px 邊）', () => {
    expect(panToReveal(viewport, size, { x: 1200, y: 200, w: 100, h: 100 })).toEqual({
      x: -(1300 - (1000 - 48)),
      y: 0,
    })
    expect(panToReveal(viewport, size, { x: 200, y: -300, w: 100, h: 100 })).toEqual({
      x: 0,
      y: 48 + 300,
    })
  })

  it('rectOf 讀固定尺寸，場框讀自己的寬高', () => {
    const graph = makeDemo(4)
    const shot = graph.nodes.find((n) => n.id === 'shot:0')
    if (!shot) throw new Error('沒有鏡頭')
    expect(rectOf(shot)).toMatchObject({ w: 230, h: 160 })
  })
})

describe('效能：250 個鏡頭（約 1,000 個節點）', () => {
  it('投影、場框伸縮、角色標籤同步都在合理時間內', () => {
    const started = performance.now()
    const graph = makeDemo(250)
    const built = performance.now() - started
    // 125 個場框＋750 個鏡頭／圖／影片節點＋角色、地點、一句話、剪輯
    expect(graph.nodes.length).toBeGreaterThan(850)

    const normalizeStart = performance.now()
    normalize(graph)
    const synced = performance.now() - normalizeStart
    const frameStart = performance.now()
    refreshFrames(graph.nodes)
    const framed = performance.now() - frameStart
    // 拖動時每一格都會跑 refreshFrames，一定要很快
    expect(framed).toBeLessThan(20)
    expect(synced).toBeLessThan(100)
    expect(built).toBeLessThan(500)
  })
})

describe('鏡號重編', () => {
  it('把鏡頭搬到別的場之後，依場的順序與由上到下重編；自己改過的名字不動', () => {
    const graph = makeDemo(4)
    const nodes = graph.nodes.map((n) => {
      if (n.id === 'shot:0') return { ...n, data: { ...n.data, sceneId: 'scene:1' } }
      if (n.id === 'shot:1') return { ...n, data: { ...n.data, title: '追逐戲' } }
      return n
    })
    const titles = Object.fromEntries(
      renumberShots(nodes)
        .filter((n) => n.data.kind === 'shot')
        .map((n) => [n.id, n.data.title]),
    )
    // 第 1 場剩下 shot:1（改過名，不動）；第 2 場由上到下是 shot:0（y 最小）、shot:2、shot:3
    expect(titles).toEqual({
      'shot:0': '第 2 鏡',
      'shot:1': '追逐戲',
      'shot:2': '第 3 鏡',
      'shot:3': '第 4 鏡',
    })
  })

  it('順序沒變就回傳同一個陣列', () => {
    const graph = makeDemo(4)
    expect(renumberShots(graph.nodes)).toBe(graph.nodes)
  })
})
