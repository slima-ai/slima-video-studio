import { resolveTools, runTool } from '@svs/media'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createStudioHarness } from './test-harness'
import { measureVideoAsset, measureVideoAssets } from './measure-videos'
import { createProviderServices } from '../provider-services'

const tools = resolveTools()
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

/** 121 格、24 fps、沒有音軌的小影片（和 Kling 的輸出一樣的長度：5.0417 秒）。 */
async function realClip(seed: number): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'svs-measure-'))
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const out = join(dir, 'clip.mp4')
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=64x36:rate=24,drawbox=x=${String(seed)}:y=0:w=4:h=4:color=red:t=fill`,
    '-frames:v',
    '121',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    out,
  ])
  return new Uint8Array(readFileSync(out))
}

function project() {
  const h = createStudioHarness()
  cleanups.push(h.cleanup)
  h.projects.create(join(h.root, 'm.svsproj'), '量長度')
  const handle = h.projects.current()
  if (!handle) throw new Error('沒有專案')
  return { h, handle }
}

describe('影片素材的長度要是檔案實際的長度', { timeout: 30_000 }, () => {
  it('舊專案：供應商存進來的影片記的是要求的 5 秒、沒有大小；量過之後是 5.0417 秒與真的大小，再量一次什麼都不動', async () => {
    const { handle } = project()
    const stored = await handle.assets.put(await realClip(1), 'video/mp4', { durationSec: 5 })
    const png = await handle.assets.put(new Uint8Array([1, 2, 3]), 'image/png')
    expect(handle.assets.getMeta(stored.hash)).toMatchObject({ durationSec: 5 })

    expect(await measureVideoAssets(handle, tools)).toBe(1)
    const meta = handle.assets.getMeta(stored.hash)
    expect(meta?.durationSec).toBeCloseTo(121 / 24, 4)
    expect(meta).toMatchObject({ width: 64, height: 36 })
    // 圖片不碰；量過的（有大小）不再量
    expect(handle.assets.getMeta(png.hash)?.width).toBeUndefined()
    expect(await measureVideoAssets(handle, tools)).toBe(0)
  })

  it('App 內建的 FFmpeg 沒有 ffprobe（長度只到百分之一秒）：沒有音軌的影片用格數 ÷ 幀率，量出 5.041667 而不是 5.04', async () => {
    const { handle } = project()
    const bundled = resolveTools({}, { SVS_FFPROBE: 'none' })
    expect(bundled.ffprobePath).toBeNull()
    const stored = await handle.assets.put(await realClip(5), 'video/mp4', { durationSec: 5 })
    const measured = await measureVideoAsset(handle, bundled, stored.hash)
    expect(measured?.durationSec).toBe(5.041667)
    expect(handle.assets.getMeta(stored.hash)?.durationSec).toBe(5.041667)
  })

  it('壞掉的影片（量不到）維持原樣，不擋住其他的', async () => {
    const { handle } = project()
    const broken = await handle.assets.put(new TextEncoder().encode('not a video'), 'video/mp4', {
      durationSec: 5,
    })
    const good = await handle.assets.put(await realClip(2), 'video/mp4', { durationSec: 5 })
    expect(await measureVideoAssets(handle, tools)).toBe(1)
    expect(handle.assets.getMeta(broken.hash)?.durationSec).toBe(5)
    expect(handle.assets.getMeta(good.hash)?.durationSec).toBeCloseTo(121 / 24, 4)
    expect(await measureVideoAsset(handle, tools, 'f'.repeat(64))).toBeUndefined()
  })

  it('新生成的影片：供應商的 adapter 存進來時就量，回傳給 adapter 的資料也是實際長度', async () => {
    const { handle } = project()
    const services = createProviderServices(handle, tools)
    const ref = await services.assets.put(await realClip(3), 'video/mp4', { durationSec: 5 })
    expect(ref.durationSec).toBeCloseTo(121 / 24, 4)
    expect(handle.assets.getMeta(ref.hash)).toMatchObject({ width: 64, height: 36 })
    expect(handle.assets.getMeta(ref.hash)?.durationSec).toBeCloseTo(121 / 24, 4)
    // 沒有 FFmpeg（或不是影片）：照供應商給的，不量
    const bare = createProviderServices(handle)
    const other = await bare.assets.put(await realClip(4), 'video/mp4', { durationSec: 5 })
    expect(other.durationSec).toBe(5)
    const image = await services.assets.put(new Uint8Array([9, 9]), 'image/png')
    expect(image.durationSec).toBeUndefined()
  })

  it('接片之前會先量：舊專案（要求的 5 秒）接出來的聲音時間軸，起點就是影格起點、總長 894 格', async () => {
    const { h, handle } = project()
    for (let n = 1; n <= 8; n++) {
      const shot = handle.repos.shots.create({ description: `鏡 ${String(n)}`, durationSec: 5 })
      const asset = await handle.assets.put(await realClip(n), 'video/mp4', { durationSec: 5 })
      const take = handle.repos.shots.addTake({
        shotId: shot.id,
        kind: 'video',
        assetHash: asset.hash,
        modelId: 'kling',
      })
      if (n === 5 || n === 6) handle.repos.shots.setTakeTrim(take.id, { outSec: 3.5 })
    }
    // 還沒量：時間軸用的是要求的秒數（5 秒一鏡）
    expect(h.sound.state().shots[1]?.startSec).toBe(5)
    await h.shots.rejoin()
    const state = h.sound.state()
    expect(state.shots.map((s) => Math.round(s.startSec * 24))).toEqual([
      0, 121, 242, 363, 484, 568, 652, 773,
    ])
    expect(Math.round(state.totalSec * 24)).toBe(894)
    const joined = handle.repos.finalCuts.latest()
    expect(joined?.durationSec).toBeCloseTo(894 / 24, 2)
  })

  describe('量長度對專案其他狀態的影響（舊專案）', () => {
    /** 把專案裡的影片素材弄成舊專案的樣子：沒有大小，長度是「要求的秒數」（差一點點的數字）。 */
    const makeLegacy = (handle: ReturnType<typeof project>['handle']): void => {
      handle.sqlite
        .prepare(
          "UPDATE assets SET width = NULL, height = NULL, duration_sec = duration_sec - 0.04 WHERE kind = 'video'",
        )
        .run()
    }
    const base = async () => {
      const h = createStudioHarness()
      cleanups.push(h.cleanup)
      await h.runQuickStart()
      const handle = h.projects.current()
      if (!handle) throw new Error('沒有專案')
      return { h, handle }
    }

    it('量長度不會讓任何鏡頭變成「需要重跑」（那要花錢）：輸入指紋、需要重跑的鏡頭數都不變', async () => {
      const { h, handle } = await base()
      // 讓第一鏡真的需要重跑，數字才有意義
      const first = h.shots.list().shots[0]
      if (!first) throw new Error('應該有鏡頭')
      h.shots.update(first.id, { description: '改過的描述，影片要重跑' })
      const staleBefore = [...h.shots.staleness().entries()].sort()
      const hashesBefore = handle.repos.shots
        .list()
        .flatMap((s) => handle.repos.shots.listTakes(s.id).map((t) => [t.id, t.inputHash]))
      expect(staleBefore.filter(([, v]) => v.image || v.video).length).toBeGreaterThan(0)

      makeLegacy(handle)
      await h.shots.whenMeasured()

      expect([...h.shots.staleness().entries()].sort()).toEqual(staleBefore)
      expect(
        handle.repos.shots
          .list()
          .flatMap((s) => handle.repos.shots.listTakes(s.id).map((t) => [t.id, t.inputHash])),
      ).toEqual(hashesBefore)
      // 長度確實被量回來了（不是什麼都沒做）
      expect(
        handle.assets.list().filter((a) => a.kind === 'video' && a.width === undefined),
      ).toEqual([])
    })

    it('成品與聲音會不會變過期：沒有聲音的專案完全不變；有混音的專案變成「聲音有變動，要重新混音」，絕不是「鏡頭有變動，要重新接」', async () => {
      const plain = await base()
      await plain.h.shots.rejoin()
      expect(plain.h.shots.finalCut()?.stale).toBe(false)
      makeLegacy(plain.handle)
      await plain.h.shots.whenMeasured()
      expect(plain.h.shots.finalCut()?.stale).toBe(false)

      const mixed = await base()
      const [shotId] = mixed.h.shots.list().shots.map((s) => s.id)
      if (!shotId) throw new Error('應該有鏡頭')
      mixed.h.shots.update(shotId, { dialogue: '一句旁白。' })
      await mixed.h.sound.generateNarration({ shotId })
      await mixed.h.shots.rejoin()
      expect(mixed.h.shots.finalCut()?.stale).toBe(false)
      // 舊版 App 混音時用的是「要求的秒數」算出來的聲音指紋：把成品記的指紋換成那一個，再量
      makeLegacy(mixed.handle)
      const legacyKey = mixed.h.sound.soundKey(mixed.handle)
      expect(legacyKey).toBeTruthy()
      mixed.handle.sqlite
        .prepare(
          'UPDATE final_cuts SET sound_key = ? WHERE version = (SELECT MAX(version) FROM final_cuts)',
        )
        .run(legacyKey)
      expect(mixed.h.shots.finalCut()?.stale).toBe(false)
      await mixed.h.shots.whenMeasured()
      expect(mixed.h.shots.finalCut()).toMatchObject({ stale: true, staleReason: 'sound' })
      // 重混在本機做、不花錢，混完就不再過期；接片的結果沒有重做
      const before = mixed.handle.repos.finalCuts.latest()
      await mixed.h.sound.mix()
      expect(mixed.h.shots.finalCut()?.stale).toBe(false)
      expect(mixed.handle.repos.finalCuts.latest()?.baseAssetHash).toBe(before?.baseAssetHash)
    })

    it('量長度不進復原歷史：不多一步可以復原，使用者復原自己的編輯也不會把長度退回去', async () => {
      const { h, handle } = await base()
      const first = h.shots.list().shots[0]
      if (!first) throw new Error('應該有鏡頭')
      expect(h.history.state()).toMatchObject({ canUndo: false })
      makeLegacy(handle)
      await h.shots.whenMeasured()
      expect(h.history.state()).toMatchObject({ canUndo: false, canRedo: false })

      h.history.record('改描述', () => h.shots.update(first.id, { description: '另一個描述' }))
      expect(h.history.state()).toMatchObject({ canUndo: true })
      makeLegacy(handle)
      await h.shots.whenMeasured()
      expect(h.history.state()).toMatchObject({ canUndo: true, undoLabel: '改描述' })
      h.history.undo()
      expect(handle.repos.shots.get(first.id)?.description).not.toBe('另一個描述')
      expect(
        handle.assets.list().filter((a) => a.kind === 'video' && a.width === undefined),
      ).toEqual([])
    })

    it('量的時候同時在接片：兩邊各自量同一批影片、寫的是同樣的數字，接出來的成品與聲音時間軸都是實際長度', async () => {
      const { h, handle } = await base()
      makeLegacy(handle)
      const [, , joined] = await Promise.all([
        h.shots.whenMeasured(),
        h.shots.whenMeasured(),
        h.shots.rejoin(),
      ])
      expect(joined.videoHash).toBeTruthy()
      expect(
        handle.assets.list().filter((x) => x.kind === 'video' && x.width === undefined),
      ).toEqual([])
      expect(h.shots.finalCut()?.stale).toBe(false)
      const state = h.sound.state()
      expect(state.totalSec).toBeCloseTo(
        h.shots.list().shots.reduce((sum, s) => sum + (s.filmSeconds ?? 0), 0),
        3,
      )
    })
  })
})
