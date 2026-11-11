import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
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

/** 一格 1×1 的純色 PNG（顏色取自 bytes 的前三個位元組）。 */
function solidPng(bytes: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.from([0, bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0])
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(row)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/** 這個專案現在記下的生成任務種類。 */
const jobKinds = (h: ReturnType<typeof setup>): string[] =>
  (h.projects.current()?.repos.jobs.list() ?? []).map((j) => j.kind).sort()

describe('字卡格：本機做成影片版本，不花錢、不呼叫任何供應商', () => {
  it('字卡：一個影片版本（模型記 local-card），長度是格長；沒有首幀圖；沒有任何生成任務、帳本沒有花費', async () => {
    const h = setup()
    const created = h.shots.create({})
    h.shots.update(created.id, {
      beatKind: 'card',
      card: { text: '有些光，要有人陪你一起守', subtext: '' },
      durationSec: 2.5,
    })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    await h.shots.whenMeasured()

    const shot = h.shots.list().shots[0]
    expect(shot?.firstFrames).toEqual([])
    expect(shot?.videos).toHaveLength(1)
    expect(shot?.videos[0]).toMatchObject({ modelId: 'local-card', adopted: true })
    expect(shot?.videos[0]?.videoSec).toBeCloseTo(2.5, 1)
    expect(shot?.status).toBe('done')
    expect(jobKinds(h)).toEqual([])
    const handle = h.projects.current()
    expect(handle?.repos.costs.totalUsd(handle.projectId)).toBe(0)
    // 字卡頁面收到的是我們的文字（已跳脫）
    expect(h.cardPages.some((page) => page.includes('有些光，要有人陪你一起守'))).toBe(true)
  })

  it('沒填任何服務金鑰、沒有任何模型也能做字卡', async () => {
    const h = setup({ demoMode: false })
    const created = h.shots.create({})
    h.shots.update(created.id, { beatKind: 'card', card: { text: '他回來了', subtext: '' } })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    expect(h.shots.list().shots[0]?.videos).toHaveLength(1)
  })

  it('片名卡：用預告片設定的書名；設定沒有書名就是白話錯誤', async () => {
    const h = setup()
    const created = h.shots.create({})
    h.shots.update(created.id, { beatKind: 'title', durationSec: 4 })
    await expect(h.shots.regenerate(created.id, 'apply')).rejects.toThrow('書名')
    h.projects.current()?.repos.trailer.update({ title: '黑藤裂谷', author: '某作者' })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    expect(h.shots.list().shots[0]?.videos[0]).toMatchObject({ modelId: 'local-card' })
    expect(h.cardPages.some((page) => page.includes('黑藤裂谷') && page.includes('某作者'))).toBe(
      true,
    )
  })

  it('改字卡的字：那一格標「需要重跑」；重跑不花錢，舊版本還在', async () => {
    // 不同的字要畫出不同的圖（假的畫法依頁面的雜湊畫一格不同顏色的 PNG），否則兩版影片是同一個檔案、會被當成同一個版本
    const h = setup({
      renderCardHtml: (request) =>
        Promise.resolve({ png: solidPng(createHash('sha256').update(request.html).digest()) }),
    })
    const created = h.shots.create({})
    h.shots.update(created.id, { beatKind: 'card', card: { text: '他回來了', subtext: '' } })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    expect(h.shots.staleness().get(created.id)).toBeUndefined()

    h.shots.update(created.id, { card: { text: '她回來了', subtext: '' } })
    expect(h.shots.staleness().get(created.id)).toMatchObject({ video: true })

    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    const shot = h.shots.list().shots[0]
    expect(shot?.videos).toHaveLength(2)
    expect(h.shots.staleness().get(created.id)).toBeUndefined()
    expect(jobKinds(h)).toEqual([])
  })

  it('改格長：字卡也要重跑（影片長度變了）', async () => {
    const h = setup()
    const created = h.shots.create({})
    h.shots.update(created.id, { beatKind: 'card', card: { text: '他回來了', subtext: '' } })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    h.shots.update(created.id, { durationSec: 5 })
    expect(h.shots.staleness().get(created.id)).toMatchObject({ video: true })
  })
})

describe('靜態鏡頭：首幀圖照舊生，影片本機做（不呼叫影片模型）', () => {
  it('一個首幀圖任務、零個影片任務；影片版本記 local-still，長度是格長；換運鏡要重做', async () => {
    const h = setup()
    const created = h.shots.create({})
    h.shots.update(created.id, { beatKind: 'still', durationSec: 2, cameraMove: 'push_in' })
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    await h.shots.whenMeasured()

    const shot = h.shots.list().shots[0]
    expect(shot?.firstFrames).toHaveLength(1)
    expect(shot?.videos).toHaveLength(1)
    expect(shot?.videos[0]).toMatchObject({ modelId: 'local-still', adopted: true })
    expect(shot?.videos[0]?.videoSec).toBeCloseTo(2, 1)
    expect(jobKinds(h).filter((k) => k === 'video')).toEqual([])
    expect(jobKinds(h).filter((k) => k === 'image')).toHaveLength(1)
    expect(h.shots.staleness().get(created.id)).toBeUndefined()

    h.shots.update(created.id, { cameraMove: 'pull_out' })
    expect(h.shots.staleness().get(created.id)).toMatchObject({ video: true })
  })

  it('改成靜態鏡頭後，要影片的只做影片（用現有首幀，不重畫）', async () => {
    const h = setup()
    const created = h.shots.create({})
    await h.shots.regenerate(created.id, 'apply')
    await h.idle(created.id)
    h.shots.update(created.id, { beatKind: 'still', durationSec: 2.5 })
    await h.shots.regenerate(created.id, 'video')
    await h.idle(created.id)
    const shot = h.shots.list().shots[0]
    expect(shot?.firstFrames).toHaveLength(1)
    expect(shot?.videos.map((v) => v.modelId)).toContain('local-still')
  })
})

describe('一般鏡頭（舊專案）：沒有任何一格被標成需要重跑', () => {
  it('快速開始的 3 鏡生好之後，beatKind 預設是 video，需要重跑的清單是空的', async () => {
    const h = setup()
    await h.runQuickStart()
    expect(h.shots.staleness().size).toBe(0)
    for (const shot of h.shots.list().shots) expect(shot).not.toHaveProperty('beatKind')
  })
})
