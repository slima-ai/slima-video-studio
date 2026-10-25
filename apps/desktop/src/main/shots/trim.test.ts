import { probe, resolveTools } from '@svs/media'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})
const tools = resolveTools()
const FRAME = 1 / 24

/** 跑完快速開始（示範模式：3 鏡、每鏡 3 秒的假影片，24 fps），回傳鏡頭 id。 */
async function withShots(): Promise<{ h: Harness; ids: string[] }> {
  const h = createStudioHarness()
  open.push(h)
  await h.runQuickStart()
  return { h, ids: h.shots.list().shots.map((s) => s.id) }
}

const trim = async (
  h: Harness,
  shotId: string,
  edit: Parameters<Harness['shots']['planTrim']>[1],
) => h.shots.applyTrim(await h.shots.planTrim(shotId, edit))

const durationOf = async (h: Harness, hash: string): Promise<number> => {
  const found = h.projects.current()?.assets.find(hash)
  if (!found) throw new Error('找不到素材')
  return (await probe(tools, found.path)).durationSec
}

describe('剪裁每一鏡的頭尾（示範模式、真的 FFmpeg）', { timeout: 60_000 }, () => {
  it('設出點：這一鏡的影片版本記下裁切、在成品裡的秒數照裁切算；沒裁的鏡頭不受影響', async () => {
    const { h, ids } = await withShots()
    const [first, second] = ids
    if (!first || !second) throw new Error('應該有鏡頭')
    const before = h.shots.list().shots[0]
    expect(before?.filmSeconds).toBeCloseTo(3, 1)
    expect(before?.videos[0]?.trim).toBeUndefined()

    const out = await trim(h, first, { outSec: 1.5 })
    expect(out).toMatchObject({ startSec: 0, endSec: 1.5, lengthSec: 1.5, frames: 36, fps: 24 })
    expect(out.trim).toEqual({ outSec: 1.5 })
    expect(out.adjustments).toEqual([])
    const [a, b] = h.shots.list().shots
    expect(a?.videos[0]?.trim).toEqual({ outSec: 1.5 })
    expect(a?.filmSeconds).toBe(1.5)
    expect(b?.videos[0]?.trim).toBeUndefined()
    expect(b?.filmSeconds).toBeCloseTo(3, 1)
  })

  it('畫面要用的資料：影片版本帶實際長度（videoSec），畫布上的影片卡剪過才帶裁切（徽章用）', async () => {
    const { h, ids } = await withShots()
    const [first, second] = ids
    if (!first || !second) throw new Error('應該有鏡頭')
    const videoNode = (shotId: string) =>
      h.canvas.get().nodes.find((n) => n.key === `shot:${shotId}:video`)
    expect(h.shots.list().shots[0]?.videos[0]?.videoSec).toBeCloseTo(3, 1)
    expect(videoNode(first)?.trim).toBeUndefined()

    await trim(h, first, { inSec: 0.5, outSec: 2 })
    const node = videoNode(first)?.trim
    expect(node).toMatchObject({ startSec: 0.5, endSec: 2 })
    expect(node?.videoSec).toBeCloseTo(3, 1)
    // 別的鏡頭不受影響；只剪頭時出點是影片長度
    expect(videoNode(second)?.trim).toBeUndefined()
    await trim(h, second, { inSec: 1 })
    expect(videoNode(second)?.trim).toMatchObject({ startSec: 1 })
    expect(videoNode(second)?.trim?.endSec).toBeCloseTo(3, 1)
    await trim(h, first, { clear: true })
    expect(videoNode(first)?.trim).toBeUndefined()
  })

  it('聲音時間軸跟著走：後面每一鏡的起點提早、總長變短（旁白、配樂、警示都讀這一份）', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    const full = h.sound.state()
    await trim(h, first, { inSec: 0.5, outSec: 2 })
    const state = h.sound.state()
    expect(state.shots[0]).toMatchObject({ startSec: 0, durationSec: 1.5 })
    const shift = (full.shots[1]?.startSec ?? 0) - (state.shots[1]?.startSec ?? 0)
    expect(shift).toBeCloseTo((full.shots[0]?.durationSec ?? 0) - 1.5, 3)
    expect(state.shots[1]?.startSec).toBeCloseTo(1.5, 3)
    expect(state.shots[2]?.startSec).toBeCloseTo(1.5 + (full.shots[1]?.durationSec ?? 0), 3)
    expect(state.totalSec).toBeCloseTo(full.totalSec - ((full.shots[0]?.durationSec ?? 0) - 1.5), 3)
  })

  it('旁白落在剪完之後的鏡頭起點上：第二鏡的旁白從 1.5 秒起（不是原本的 3 秒）', async () => {
    const { h, ids } = await withShots()
    const [first, second] = ids
    if (!first || !second) throw new Error('應該有鏡頭')
    h.shots.update(second, { dialogue: '第二鏡的旁白。' })
    await h.sound.generateNarration({ shotId: second })
    await trim(h, first, { outSec: 1.5 })
    const view = h.sound.state().shots[1]
    expect(view?.narration).toBeDefined()
    // 旁白放在 鏡頭起點 + 旁白偏移
    const offset = view?.narration?.offsetSec ?? 0
    expect((view?.startSec ?? 0) + offset).toBeCloseTo(1.5 + offset, 3)
  })

  it('接片照裁切剪：成品長度＝各鏡剪完的長度總和（誤差不到一格）；接完不過期', async () => {
    const { h, ids } = await withShots()
    const [first, second] = ids
    if (!first || !second) throw new Error('應該有鏡頭')
    const joined = await h.shots.rejoin()
    expect(await durationOf(h, joined.videoHash)).toBeCloseTo(9, 0)
    expect(h.shots.finalCut()?.stale).toBe(false)

    await trim(h, first, { outSec: 1.5 })
    await trim(h, second, { inSec: 1 })
    // 接片之後才裁：成品要重新接（不是「聲音過期」）
    expect(h.shots.finalCut()).toMatchObject({ stale: true, staleReason: 'shots' })
    const trimmed = await h.shots.rejoin()
    expect(trimmed.videoHash).not.toBe(joined.videoHash)
    expect(Math.abs((await durationOf(h, trimmed.videoHash)) - (1.5 + 2 + 3))).toBeLessThanOrEqual(
      FRAME * 2,
    )
    expect(h.shots.finalCut()?.stale).toBe(false)
    expect(h.projects.current()?.repos.finalCuts.latest()?.trimKey).toBeTruthy()
  })

  it('裁切改回去（回整支）：回到更早沒裁的那一版，不用重新接、不多一個版本', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    const plain = await h.shots.rejoin()
    const plainVersion = h.projects.current()?.repos.finalCuts.latest()?.version
    await trim(h, first, { outSec: 1.5 })
    await h.shots.rejoin()
    const versions = h.projects.current()?.repos.finalCuts.list().length
    await trim(h, first, { clear: true })
    expect(h.shots.finalCut()).toMatchObject({ stale: false, version: plainVersion })
    expect(h.shots.finalVideoHash()).toBe(plain.videoHash)
    expect(h.projects.current()?.repos.finalCuts.list()).toHaveLength(versions ?? -1)
  })

  it('沒有任何裁切的專案：接片的成品沒有裁切指紋（舊專案行為不變）', async () => {
    const { h } = await withShots()
    await h.shots.rejoin()
    expect(h.projects.current()?.repos.finalCuts.latest()?.trimKey).toBeUndefined()
    expect(h.shots.finalCut()?.stale).toBe(false)
  })

  it('裁切屬於影片版本：換一版就用那一版自己的裁切（預設整支），換回來又恢復', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    await trim(h, first, { outSec: 1.5 })
    await h.shots.regenerate(first, 'video')
    await h.idle(first)
    const [v1, v2] = h.shots.list().shots[0]?.videos ?? []
    expect(v2?.adopted).toBe(true)
    expect(v2?.trim).toBeUndefined()
    expect(h.shots.list().shots[0]?.filmSeconds).toBeCloseTo(3, 1)
    h.shots.adopt(v1?.id ?? 'x')
    expect(h.shots.list().shots[0]?.videos[0]?.trim).toEqual({ outSec: 1.5 })
    expect(h.shots.list().shots[0]?.filmSeconds).toBe(1.5)
  })

  it('已經有兩個版本時只裁採用中的那一版：另一版不被動到（各版本各自一份裁切）', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    await h.shots.regenerate(first, 'video')
    await h.idle(first)
    await trim(h, first, { inSec: 0.5, outSec: 2 })
    const [v1, v2] = h.shots.list().shots[0]?.videos ?? []
    expect(v2?.trim).toEqual({ inSec: 0.5, outSec: 2 })
    expect(v1?.trim).toBeUndefined()
    h.shots.adopt(v1?.id ?? 'x')
    expect(h.shots.list().shots[0]?.filmSeconds).toBeCloseTo(3, 1)
  })

  it('改了使用者打的數字就寫出來：對齊格線（1.51 → 1.5）、出點超過影片長度夾回影片長度', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    const snapped = await trim(h, first, { outSec: 1.51 })
    expect(snapped.adjustments).toEqual([
      { field: 'outSec', reason: 'snapped', from: 1.51, to: 1.5 },
    ])
    expect(snapped.trim).toEqual({ outSec: 1.5 })
    const clamped = await trim(h, first, { inSec: 1, outSec: 99 })
    expect(clamped.adjustments[0]).toMatchObject({ field: 'outSec', reason: 'clamped', from: 99 })
    expect(clamped.trim).toEqual({ inSec: 1 })
    expect(clamped.lengthSec).toBeCloseTo(clamped.videoSec - 1, 1)
  })

  it('不合法的裁切被擋下並說明：入點不早於出點、沒有影片的鏡頭、找不到的鏡頭；擋下時什麼都沒改', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    await expect(h.shots.planTrim(first, { inSec: 2, outSec: 2 })).rejects.toThrow(/入點要比出點早/)
    await expect(h.shots.planTrim(first, { inSec: 2.9, outSec: 2.91 })).rejects.toThrow(
      /至少要留一格/,
    )
    expect(h.shots.list().shots[0]?.videos[0]?.trim).toBeUndefined()

    const empty = h.projects.current()?.repos.shots.create({ description: '還沒生成的一鏡' })
    await expect(h.shots.planTrim(empty?.id ?? 'x', { outSec: 1 })).rejects.toThrow(
      /第 4 鏡還沒有可用的影片，沒有東西可以剪/,
    )
    await expect(h.shots.planTrim('nope', { outSec: 1 })).rejects.toThrow()
  })

  it('剪裁不是生成輸入：不會讓任何鏡頭變成「需要重跑」，輸入指紋也不變', async () => {
    const { h, ids } = await withShots()
    const [first] = ids
    if (!first) throw new Error('應該有鏡頭')
    const takeBefore = h.projects.current()?.repos.shots.listTakes(first, 'video')[0]
    const staleBefore = [...h.shots.staleness().entries()]
    await trim(h, first, { inSec: 0.5, outSec: 2 })
    const takeAfter = h.projects.current()?.repos.shots.listTakes(first, 'video')[0]
    expect(takeAfter?.inputHash).toBe(takeBefore?.inputHash)
    expect([...h.shots.staleness().entries()]).toEqual(staleBefore)
  })

  it('《黑藤裂谷》粗剪的對位：8 鏡每鏡 121 格（5.0417 秒）、鏡 5、6 只留 3.5 秒 → 每鏡起點（格）0、121、242、363、484、568、652、773，總共 894 格；聲音時間軸的起點就是這些影格起點（不是名義的 5 秒一鏡）', async () => {
    const h = createStudioHarness()
    open.push(h)
    // 不跑生成：直接在專案裡放 8 鏡、每鏡一個 121 格的影片版本（素材只需要有長度資訊）
    h.projects.create(join(h.root, 'film.svsproj'), '黑藤裂谷')
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    for (let n = 1; n <= 8; n++) {
      const shot = handle.repos.shots.create({ description: `鏡 ${String(n)}`, durationSec: 5 })
      const asset = await handle.assets.put(
        new TextEncoder().encode(`video-${String(n)}`),
        'video/mp4',
        {
          durationSec: 121 / 24,
        },
      )
      const take = handle.repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: asset.hash,
        modelId: 'kling',
      })
      if (n === 5 || n === 6) handle.repos.shots.setTakeTrim(take.id, { outSec: 3.5 })
    }
    const starts = h.sound.state().shots.map((s) => Math.round(s.startSec * 24))
    expect(starts).toEqual([0, 121, 242, 363, 484, 568, 652, 773])
    const state = h.sound.state()
    expect(Math.round(state.totalSec * 24)).toBe(894)
    // 秒數：鏡 8 從 32.2083 秒開始（名義的 32 秒會讓旁白早 0.21 秒）
    expect(state.shots[7]?.startSec).toBeCloseTo(773 / 24, 4)
    expect(state.shots[4]?.durationSec).toBe(3.5)
    // 時間軸拖邊緣要用的資料：剪過的鏡頭帶影片長度與留下的段落，沒剪的整支都用
    expect(state.shots[4]?.trim).toEqual({
      videoSec: 121 / 24,
      inSec: 0,
      outSec: 3.5,
      trimmed: true,
    })
    expect(state.shots[0]?.trim).toEqual({
      videoSec: 121 / 24,
      inSec: 0,
      outSec: 121 / 24,
      trimmed: false,
    })
  })

  it('時間軸的資料：入點、出點都剪時各自帶出；還沒量到影片長度的鏡頭不帶 trim（畫面上不給拖）', async () => {
    const h = createStudioHarness()
    open.push(h)
    h.projects.create(join(h.root, 'film.svsproj'), '時間軸')
    const handle = h.projects.current()
    if (!handle) throw new Error('沒有專案')
    const make = async (n: number, durationSec: number | undefined) => {
      const shot = handle.repos.shots.create({ description: `鏡 ${String(n)}`, durationSec: 5 })
      const asset = await handle.assets.put(
        new TextEncoder().encode(`tl-${String(n)}`),
        'video/mp4',
        durationSec === undefined ? {} : { durationSec },
      )
      return handle.repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: asset.hash,
        modelId: 'kling',
      })
    }
    const first = await make(1, 5)
    await make(2, undefined)
    handle.repos.shots.setTakeTrim(first.id, { inSec: 0.5, outSec: 4 })
    const [a, b] = h.sound.state().shots
    expect(a?.trim).toEqual({ videoSec: 5, inSec: 0.5, outSec: 4, trimmed: true })
    expect(a?.durationSec).toBe(3.5)
    // 選一格按空白鍵播的就是採用中的那支影片（有影片就帶 hash，沒量到長度也一樣）
    expect(a?.videoHash).toBe(handle.repos.shots.listTakes(a?.shotId ?? '', 'video')[0]?.assetHash)
    expect(b?.videoHash).toBe(handle.repos.shots.listTakes(b?.shotId ?? '', 'video')[0]?.assetHash)
    expect(a?.videoHash).not.toBeUndefined()
    expect(b?.trim).toBeUndefined()
    expect(b?.durationSec).toBe(5)
  })
})
