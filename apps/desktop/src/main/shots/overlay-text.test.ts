import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'

const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

type Harness = ReturnType<typeof createStudioHarness>

async function made(): Promise<Harness> {
  const h = createStudioHarness()
  harnesses.push(h)
  await h.trailer.plan({ text: STORY })
  await h.canvas.run({ keys: [], all: true })
  await h.shots.whenIdle()
  return h
}

const repos = (h: Harness) => {
  const handle = h.projects.current()
  if (!handle) throw new Error('沒有專案')
  return handle.repos
}
const stillShot = (h: Harness) => {
  const shot = repos(h)
    .shots.list()
    .find((s) => s.beatKind === 'still')
  if (!shot) throw new Error('示範腳本應該有不動的格子')
  return shot
}
const takes = (h: Harness, id: string, kind: 'first_frame' | 'video') =>
  repos(h).shots.listTakes(id, kind)

// 真的做影片（ffmpeg 運鏡＋疊字），機器忙的時候要多給一點時間
describe('不動的格子疊字：改字只重做本機那一步，不重生圖、不花錢', { timeout: 120_000 }, () => {
  it('存字：鏡頭帶著 overlay（list 與 update 的回傳都看得到）；清掉用 null', async () => {
    const h = await made()
    const shot = stillShot(h)
    const updated = h.shots.update(shot.id, {
      overlay: { text: '寵辱不驚', subtext: '——《菜根譚》' },
    })
    expect(updated.overlay).toEqual({ text: '寵辱不驚', subtext: '——《菜根譚》' })
    expect(h.shots.list().shots.find((s) => s.id === shot.id)?.overlay?.text).toBe('寵辱不驚')
    await h.shots.whenIdle()
    expect(h.shots.update(shot.id, { overlay: null }).overlay).toBeUndefined()
    await h.shots.whenIdle()
  })

  it('改字之後這一格的影片自動用新的字重做（本機）：首幀沒有新版本、沒有被標「需要重跑」、字是透明底的疊字頁', async () => {
    const h = await made()
    const shot = stillShot(h)
    const framesBefore = takes(h, shot.id, 'first_frame').length
    const videosBefore = takes(h, shot.id, 'video').length
    const pagesBefore = h.cardPages.length
    h.shots.update(shot.id, { overlay: { text: '寵辱不驚', subtext: '' } })
    await h.shots.whenIdle()
    expect(takes(h, shot.id, 'first_frame')).toHaveLength(framesBefore)
    expect(takes(h, shot.id, 'video').length).toBe(videosBefore + 1)
    expect(h.shots.staleness().size).toBe(0)
    const newPages = h.cardPages.slice(pagesBefore)
    expect(newPages).toHaveLength(1)
    expect(newPages[0]).toContain('寵辱不驚')
    expect(newPages[0]).toContain('background:transparent')
  })

  it('再改一次字、改回沒有字：每次都在本機重做（字卡服務各畫一次疊字頁），首幀始終沒有新版本，也沒有被標「需要重跑」', async () => {
    const h = await made()
    const shot = stillShot(h)
    const frames = takes(h, shot.id, 'first_frame').length
    const pages = h.cardPages.length
    h.shots.update(shot.id, { overlay: { text: '一', subtext: '' } })
    await h.shots.whenIdle()
    expect(h.cardPages.length).toBe(pages + 1)
    h.shots.update(shot.id, { overlay: { text: '二', subtext: '' } })
    await h.shots.whenIdle()
    expect(h.cardPages.length).toBe(pages + 2)
    expect(h.cardPages.at(-1)).toContain('二')
    // 改回沒有字：不需要疊字頁，影片回到沒有字的樣子（沿用原本那一版，不另外多一版）
    h.shots.update(shot.id, { overlay: null })
    await h.shots.whenIdle()
    expect(h.cardPages.length).toBe(pages + 2)
    expect(takes(h, shot.id, 'first_frame')).toHaveLength(frames)
    expect(h.shots.staleness().size).toBe(0)
  })

  it('前一次重做還沒做完又改字：做完會再用最新的字重做一次，不會停在舊字', async () => {
    const h = await made()
    const shot = stillShot(h)
    const videosBefore = takes(h, shot.id, 'video').length
    const framesBefore = takes(h, shot.id, 'first_frame').length
    const pagesBefore = h.cardPages.length
    h.shots.update(shot.id, { overlay: { text: '寵辱不驚', subtext: '' } })
    // 不等它做完，馬上又改
    h.shots.update(shot.id, { overlay: { text: '閒看庭前花開花落', subtext: '' } })
    await h.shots.whenIdle()
    await h.shots.whenIdle()
    // 兩次都在本機重畫疊字頁；最後一次用的是最新的字（測試用的畫字服務畫出一樣的檔，所以版本不一定多一個）
    const pages = h.cardPages.slice(pagesBefore)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('寵辱不驚')
    expect(pages[1]).toContain('閒看庭前花開花落')
    expect(takes(h, shot.id, 'video').length).toBeGreaterThan(videosBefore)
    expect(h.shots.staleness().size).toBe(0)
    expect(takes(h, shot.id, 'first_frame')).toHaveLength(framesBefore)
  })

  it('還沒生成過影片的不動格：改字只存起來，不會自己開始生成', async () => {
    const h = createStudioHarness()
    harnesses.push(h)
    await h.trailer.plan({ text: STORY })
    const shot = stillShot(h)
    h.shots.update(shot.id, { overlay: { text: '寵辱不驚', subtext: '' } })
    await h.shots.whenIdle()
    expect(takes(h, shot.id, 'video')).toHaveLength(0)
    expect(takes(h, shot.id, 'first_frame')).toHaveLength(0)
  })

  it('會動的格子與字卡有 overlay 也不用（存著，成品不受影響）：影片不重做', async () => {
    const h = await made()
    const moving = repos(h)
      .shots.list()
      .find((s) => s.beatKind === 'video')
    if (!moving) throw new Error('需要會動的格子')
    const before = takes(h, moving.id, 'video').length
    h.shots.update(moving.id, { overlay: { text: '不會用到', subtext: '' } })
    await h.shots.whenIdle()
    expect(takes(h, moving.id, 'video')).toHaveLength(before)
    expect(h.shots.staleness().size).toBe(0)
  })

  it('成品的長度不變：疊字不改格長', async () => {
    const h = await made()
    const shot = stillShot(h)
    const status = h.trailer.status()
    h.shots.update(shot.id, { overlay: { text: '寵辱不驚', subtext: '' } })
    await h.shots.whenIdle()
    expect(h.trailer.status().scriptSec).toBeCloseTo(status.scriptSec, 6)
    expect(repos(h).shots.get(shot.id)?.durationSec).toBe(shot.durationSec)
  })
})
