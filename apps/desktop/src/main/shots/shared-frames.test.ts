import type { Shot } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

type Harness = ReturnType<typeof createStudioHarness>

async function trailer(): Promise<Harness> {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.trailer.plan({ text: STORY })
  return h
}

const repos = (h: Harness) => {
  const handle = h.projects.current()
  if (!handle) throw new Error('沒有專案')
  return handle.repos
}

/** 不動的格子，依地點分組（沒有地點的不在裡面）。 */
function stillGroups(h: Harness): Shot[][] {
  const groups = new Map<string, Shot[]>()
  for (const shot of repos(h).shots.list()) {
    if (shot.beatKind !== 'still' || shot.locationId === undefined) continue
    groups.set(shot.locationId, [...(groups.get(shot.locationId) ?? []), shot])
  }
  return [...groups.values()]
}

const frameOf = (h: Harness, shotId: string) =>
  repos(h)
    .shots.listTakes(shotId, 'first_frame')
    .find((take) => take.adopted)

/** 真的生成過（有生成紀錄）的首幀版本數；共用來的版本沒有。 */
const generatedFrames = (h: Harness): number =>
  repos(h)
    .shots.list()
    .reduce(
      (sum, shot) =>
        sum +
        repos(h)
          .shots.listTakes(shot.id, 'first_frame')
          .filter((take) => take.runId !== undefined).length,
      0,
    )

const pictureShots = (h: Harness): Shot[] =>
  repos(h)
    .shots.list()
    .filter((shot) => shot.beatKind === 'video' || shot.beatKind === 'still')

describe('同一張主視覺的不動格共用一張首幀（只做不動的格）', () => {
  it('示範腳本本身就有同一個地點的好幾個不動格（這個測試才有意義）', async () => {
    const h = await trailer()
    const groups = stillGroups(h)
    expect(groups.some((g) => g.length >= 2)).toBe(true)
  })

  it('全部生成的計畫：每組只有一個不動格要畫首幀，其他的不列「第一張畫面」那一步', async () => {
    const h = await trailer()
    const followers = stillGroups(h).reduce((sum, g) => sum + (g.length - 1), 0)
    const plan = h.canvas.runPlan({ keys: [], all: true })
    const imageSteps = plan.steps.filter((step) => step.kind === 'image')
    expect(imageSteps).toHaveLength(pictureShots(h).length - followers)
    // 跟隨的那幾格還是有自己的（本機）影片步驟：各自套推近或平移
    const stillNumbers = new Set(
      stillGroups(h)
        .flat()
        .map((s) => s.id),
    )
    const videoSteps = plan.steps.filter((step) => step.kind === 'video')
    for (const id of stillNumbers) {
      expect(
        videoSteps.some((step) => step.key.startsWith(`shot:${id}`)),
        id,
      ).toBe(true)
    }
  })

  it('全部生成：同一組的不動格用同一張首幀（同一個檔案），真的畫的張數少了跟隨的那幾格；影片每格各自做；沒有「需要重跑」', async () => {
    const h = await trailer()
    const groups = stillGroups(h)
    const followers = groups.reduce((sum, g) => sum + (g.length - 1), 0)
    await h.canvas.run({ keys: [], all: true })
    await h.shots.whenIdle()
    for (const group of groups) {
      const hashes = group.map((shot) => frameOf(h, shot.id)?.assetHash)
      expect(hashes.every((hash) => hash !== undefined)).toBe(true)
      expect(new Set(hashes).size).toBe(1)
      // 每一格的影片是自己做的（運鏡不同就是不同的檔案）
      for (const shot of group) {
        expect(
          repos(h)
            .shots.listTakes(shot.id, 'video')
            .some((t) => t.adopted),
        ).toBe(true)
      }
    }
    expect(generatedFrames(h)).toBe(pictureShots(h).length - followers)
    expect(h.shots.staleness().size).toBe(0)
  })

  it('會動的格不共用：同一個地點的影片格各畫各的首幀', async () => {
    const h = await trailer()
    await h.canvas.run({ keys: [], all: true })
    await h.shots.whenIdle()
    const moving = pictureShots(h).filter((s) => s.beatKind === 'video')
    expect(moving.length).toBeGreaterThan(1)
    for (const shot of moving) {
      expect(frameOf(h, shot.id)?.runId, `第 ${String(shot.number)} 鏡`).toBeDefined()
    }
  })

  it('只生首幀（MCP 的 generate_first_frames）：一樣共用，沒有做出影片', async () => {
    const h = await trailer()
    const groups = stillGroups(h)
    const followers = groups.reduce((sum, g) => sum + (g.length - 1), 0)
    const ids = repos(h)
      .shots.list()
      .map((s) => s.id)
    const check = h.shots.batchCheck({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    expect(check.ok).toBe(true)
    await h.shots.generateBatch({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    await h.shots.whenIdle()
    for (const group of groups) {
      const hashes = group.map((shot) => frameOf(h, shot.id)?.assetHash)
      expect(new Set(hashes).size).toBe(1)
      expect(hashes[0]).toBeDefined()
    }
    expect(generatedFrames(h)).toBe(pictureShots(h).length - followers)
    expect(
      repos(h)
        .shots.list()
        .filter((s) => repos(h).shots.listTakes(s.id, 'video').length > 0),
    ).toHaveLength(0)
  })

  it('同一組已經有一張首幀：之後補生成的不動格直接用它，不再畫', async () => {
    const h = await trailer()
    const [group] = stillGroups(h).filter((g) => g.length >= 2)
    if (!group) throw new Error('需要同一個地點的兩個不動格')
    const [first, ...others] = group
    if (!first) throw new Error('沒有第一格')
    await h.canvas.run({ keys: [`shot:${first.id}:image`], scope: 'this' })
    await h.shots.whenIdle()
    const before = generatedFrames(h)
    const source = frameOf(h, first.id)
    expect(source).toBeDefined()
    const ids = others.map((o) => o.id)
    await h.shots.generateBatch({ shotIds: ids, skipGenerated: true, stage: 'frame' })
    await h.shots.whenIdle()
    expect(generatedFrames(h)).toBe(before)
    for (const id of ids) expect(frameOf(h, id)?.assetHash).toBe(source?.assetHash)
    expect(h.shots.staleness().size).toBe(0)
  })

  it('使用者自己對跟隨的那一格按「重做首幀」：照舊畫一張新的，不共用', async () => {
    const h = await trailer()
    await h.canvas.run({ keys: [], all: true })
    await h.shots.whenIdle()
    const [group] = stillGroups(h).filter((g) => g.length >= 2)
    const follower = group?.[1]
    if (!follower) throw new Error('需要跟隨的不動格')
    const before = generatedFrames(h)
    await h.canvas.run({ keys: [`shot:${follower.id}:image`], scope: 'this' })
    await h.shots.whenIdle()
    expect(generatedFrames(h)).toBe(before + 1)
    expect(frameOf(h, follower.id)?.runId).toBeDefined()
  })

  it('領頭的那一格畫不出來：跟隨的格子改成自己畫，不會一直等下去', async () => {
    const h = createStudioHarness({ mockRejectText: '壞掉記號' })
    harnesses.push(h)
    await h.trailer.plan({ text: STORY })
    const [group] = stillGroups(h).filter((g) => g.length >= 2)
    const [leader, ...followers] = group ?? []
    if (!leader || followers.length === 0) throw new Error('需要同一個地點的兩個不動格')
    h.shots.update(leader.id, { description: '壞掉記號：這一格的圖會被拒絕' })
    await h.canvas.run({ keys: [], all: true })
    await h.shots.whenIdle()
    expect(frameOf(h, leader.id)).toBeUndefined()
    for (const follower of followers) {
      expect(frameOf(h, follower.id)?.runId, `第 ${String(follower.number)} 鏡`).toBeDefined()
    }
    // 沒有格子停在「進行中」
    expect([...h.shots.live().values()].some((state) => state.step !== undefined)).toBe(false)
  })

  it('等領頭的時候按取消：那一格不會再自己跑起來', async () => {
    const h = await trailer()
    const [group] = stillGroups(h).filter((g) => g.length >= 2)
    const follower = group?.[1]
    if (!follower) throw new Error('需要跟隨的不動格')
    const running = h.canvas.run({ keys: [], all: true })
    // 跟隨的那一格在等領頭的：先佔著「進行中」，這時取消它
    h.shots.cancel(follower.id)
    await running
    await h.shots.whenIdle()
    expect(frameOf(h, follower.id)).toBeUndefined()
    expect(repos(h).shots.listTakes(follower.id, 'video')).toHaveLength(0)
  })

  it('一個地點只有一個不動格：照舊自己畫（沒有誰可以共用）', async () => {
    const h = await trailer()
    const singles = stillGroups(h).filter((g) => g.length === 1)
    const plan = h.canvas.runPlan({ keys: [], all: true })
    for (const [only] of singles) {
      if (!only) continue
      expect(plan.steps.some((s) => s.key === `shot:${only.id}:image`)).toBe(true)
    }
  })
})
