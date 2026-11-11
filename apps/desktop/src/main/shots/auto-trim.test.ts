import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness, type HarnessOptions } from './test-harness'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})
function setup(options: HarnessOptions = {}) {
  const h = createStudioHarness(options)
  cleanups.push(h.cleanup)
  return h
}

/** 建一個鏡頭、設格長，（預告片專案才）先建預告片設定，生一支影片。 */
async function film(h: ReturnType<typeof setup>, durationSec: number, trailer: boolean) {
  const created = h.shots.create({})
  if (trailer) h.projects.current()?.repos.trailer.update({ title: '黑藤裂谷' })
  h.shots.update(created.id, { durationSec })
  await h.shots.regenerate(created.id, 'apply')
  await h.idle(created.id)
  await h.shots.whenMeasured()
  return created.id
}

const adoptedVideo = (h: ReturnType<typeof setup>) =>
  h.shots.list().shots[0]?.videos.find((v) => v.adopted)

describe('影片格子自動剪到格長（只有預告片專案）', () => {
  it('格長 2.5：影片按模型的規則送 3 秒，存進來就自動裁成 0～2.5；成品裡這一格佔 2.5 秒，聲音時間軸的總長也是 2.5', async () => {
    const h = setup()
    await film(h, 2.5, true)
    const video = adoptedVideo(h)
    expect(video?.videoSec).toBeCloseTo(3, 1)
    // 24 fps：2.5 秒＝60 格，剛好整數格
    expect(video?.trim).toEqual({ outSec: 2.5 })
    expect(h.shots.list().shots[0]?.filmSeconds).toBeCloseTo(2.5, 3)
    const sound = h.sound.state()
    expect(sound.totalSec).toBeCloseTo(2.5, 3)
  })

  it('生好之後沒有任何鏡頭被標成「需要重跑」（送的是對齊秒數，指紋看的是格長）', async () => {
    const h = setup()
    const id = await film(h, 2.5, true)
    expect(h.shots.staleness().get(id)).toBeUndefined()
    // 格長改了才算過期
    h.shots.update(id, { durationSec: 4 })
    expect(h.shots.staleness().get(id)).toMatchObject({ video: true })
  })

  it('格長 2.5：生成前的估價與節點參數用的是 3 秒；一般專案仍是 2.5 秒', () => {
    const trailer = setup()
    const a = trailer.shots.create({})
    trailer.projects.current()?.repos.trailer.update({ title: '黑藤裂谷' })
    trailer.shots.update(a.id, { durationSec: 2.5 })
    const plain = setup()
    const b = plain.shots.create({})
    plain.shots.update(b.id, { durationSec: 2.5 })
    const secOf = (h: ReturnType<typeof setup>, id: string): unknown =>
      h.shots.flowOf(id).nodes.find((n) => n.id === 'video')?.params.durationSec
    expect(secOf(trailer, a.id)).toBe(3)
    expect(secOf(plain, b.id)).toBe(2.5)
  })

  it('格長不是整數格（1.2 秒＝28.8 格）：裁到最近的整數格（29 格），不累積誤差', async () => {
    const h = setup()
    await film(h, 1.2, true)
    const trim = adoptedVideo(h)?.trim
    expect(trim?.inSec).toBeUndefined()
    expect(trim?.outSec).toBeCloseTo(29 / 24, 4)
  })

  it('影片剛好等於格長：不裁', async () => {
    const h = setup()
    await film(h, 3, true)
    expect(adoptedVideo(h)?.trim).toBeUndefined()
  })

  it('一般專案（沒有預告片設定）：跟以前一樣——不對齊秒數、不自動裁切', async () => {
    const h = setup()
    await film(h, 2.5, false)
    const video = adoptedVideo(h)
    expect(video?.videoSec).toBeCloseTo(2.5, 1)
    expect(video?.trim).toBeUndefined()
  })

  it('使用者改入點：出點跟著保持格長（入點＋格長）', async () => {
    const h = setup()
    const id = await film(h, 1.2, true)
    const plan = await h.shots.planTrim(id, { inSec: 0.5 })
    const outcome = h.shots.applyTrim(plan)
    expect(outcome.endSec - outcome.startSec).toBeCloseTo(29 / 24, 3)
    expect(outcome.startSec).toBeCloseTo(0.5, 1)
  })

  it('使用者自己同時設了入點與出點：照使用者的', async () => {
    const h = setup()
    const id = await film(h, 1.2, true)
    const plan = await h.shots.planTrim(id, { inSec: 0.5, outSec: 1.5 })
    const outcome = h.shots.applyTrim(plan)
    expect(outcome.endSec - outcome.startSec).toBeCloseTo(1, 1)
  })

  it('使用者改過入點後重生影片：入點保留，出點保持格長', async () => {
    const h = setup()
    const id = await film(h, 1.2, true)
    h.shots.applyTrim(await h.shots.planTrim(id, { inSec: 0.5 }))
    await h.shots.regenerate(id, 'video')
    await h.idle(id)
    await h.shots.whenMeasured()
    const shot = h.shots.list().shots[0]
    expect(shot?.videos).toHaveLength(2)
    const latest = shot?.videos.find((v) => v.adopted)
    expect(latest?.trim?.inSec).toBeCloseTo(0.5, 1)
    expect((latest?.trim?.outSec ?? 0) - (latest?.trim?.inSec ?? 0)).toBeCloseTo(29 / 24, 2)
  })
})
