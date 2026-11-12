import { resolveTools, runTool } from '@svs/media'
import { MUSIC_IMPORT_MAX_BYTES, USER_MUSIC_MODEL_ID } from '@svs/schema'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { collectAttributions } from '../credits/credits'
import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'

const tools = resolveTools()
const dirs: string[] = []
const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'svs-music-'))
  dirs.push(dir)
  return dir
}

/** 用 FFmpeg 合成一首 seconds 秒的純音（mp3、wav、m4a 各一種編碼）。 */
async function makeTrack(dir: string, name: string, seconds = 4, frequency = 440): Promise<string> {
  const file = join(dir, name)
  const codec = name.endsWith('.mp3')
    ? ['-c:a', 'libmp3lame']
    : name.endsWith('.m4a')
      ? ['-c:a', 'aac']
      : ['-c:a', 'pcm_s16le']
  await runTool(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(frequency)}:duration=${String(seconds)}`,
    ...codec,
    file,
  ])
  return file
}

/** 測試用的整套服務；挑檔視窗回傳 picks 依序給的路徑（用完回傳 undefined＝取消）。 */
function setup(picks: (string | undefined)[], options: HarnessOptions = {}) {
  const queue = [...picks]
  const h = createStudioHarness({
    ...options,
    pickMusic: () => Promise.resolve(queue.shift()),
  })
  harnesses.push(h)
  return h
}

async function withShots(h: ReturnType<typeof setup>): Promise<void> {
  await h.runQuickStart()
}

describe('匯入自己的音樂（SoundService.importMusic）', () => {
  it('加一首就採用：標「自己的檔案」、檔名當說明、花費 0、不進花費帳本；素材存進專案、量得到長度', async () => {
    const dir = tempDir()
    const file = await makeTrack(dir, '我的配樂.wav', 4)
    const h = setup([file])
    await withShots(h)
    const handle = h.projects.current()
    const spentBefore = handle?.repos.costs.list(handle.projectId).length ?? 0

    const clip = await h.sound.importMusic()
    expect(clip).toMatchObject({
      kind: 'music',
      source: 'imported',
      modelId: USER_MUSIC_MODEL_ID,
      text: '我的配樂.wav',
      costUsd: 0,
      adopted: true,
      version: 1,
    })
    expect(clip?.shotId).toBeUndefined()
    expect(clip?.durationSec).toBeCloseTo(4, 0)
    // 素材真的存進專案
    expect(handle?.assets.find(clip?.assetHash ?? '')).toBeDefined()
    // 不花錢、不記帳
    expect(handle?.repos.costs.list(handle.projectId).length).toBe(spentBefore)
    // 聲音狀態看得到它
    const state = h.sound.state()
    expect(state.music).toMatchObject({ id: clip?.id, source: 'imported', text: '我的配樂.wav' })
    expect(state.musicVersions).toEqual([{ id: clip?.id, source: 'imported', adopted: true }])
  })

  it('三種格式都收：mp3、wav、m4a', async () => {
    const dir = tempDir()
    const files = await Promise.all(
      ['a.mp3', 'b.wav', 'c.m4a'].map((name) => makeTrack(dir, name, 2)),
    )
    const h = setup(files)
    await withShots(h)
    for (const name of ['a.mp3', 'b.wav', 'c.m4a']) {
      expect((await h.sound.importMusic())?.text).toBe(name)
    }
  })

  it('再匯入一首：取代採用中的（版本 +1），舊的留著、不採用；舊的也可以再採用回來', async () => {
    const dir = tempDir()
    const a = await makeTrack(dir, 'a.wav', 3, 330)
    const b = await makeTrack(dir, 'b.wav', 3, 660)
    const h = setup([a, b])
    await withShots(h)
    const first = await h.sound.importMusic()
    const second = await h.sound.importMusic()
    expect(second).toMatchObject({ version: 2, adopted: true, text: 'b.wav' })
    const versions = h.sound.state().musicVersions ?? []
    expect(versions.map((v) => [v.id, v.adopted])).toEqual([
      [first?.id, false],
      [second?.id, true],
    ])
    expect(h.sound.state().music?.id).toBe(second?.id)
    h.sound.adoptClip(first?.id ?? '')
    expect(h.sound.state().music?.id).toBe(first?.id)
  })

  it('取消選檔：什麼都不變', async () => {
    const h = setup([undefined])
    await withShots(h)
    expect(await h.sound.importMusic()).toBeUndefined()
    expect(h.sound.state().music).toBeUndefined()
  })

  it('格式不對、空檔、不是音訊、太大：白話錯誤，什麼都沒存', async () => {
    const dir = tempDir()
    const ogg = join(dir, '歌.ogg')
    writeFileSync(ogg, 'x')
    const empty = join(dir, '空的.mp3')
    writeFileSync(empty, '')
    const fake = join(dir, '假的.mp3')
    writeFileSync(fake, '這不是音訊檔，只是改了副檔名的文字。'.repeat(50))
    const big = join(dir, '太大.wav')
    writeFileSync(big, '')
    truncateSync(big, MUSIC_IMPORT_MAX_BYTES + 1)
    const h = setup([ogg, empty, fake, big])
    await withShots(h)
    const handle = h.projects.current()
    const assetsBefore = handle?.assets.list().length ?? 0

    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('mp3、wav 或 m4a') as unknown,
    })
    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('讀不到') as unknown,
    })
    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('不是音訊') as unknown,
    })
    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('50 MB') as unknown,
    })
    expect(h.sound.state().music).toBeUndefined()
    expect(handle?.assets.list().length).toBe(assetsBefore)
  })

  it('改了副檔名的影片（只有畫面、沒有聲音）：也不是音訊，擋下、什麼都沒存', async () => {
    const dir = tempDir()
    const silentVideo = join(dir, '沒聲音.m4a')
    await runTool(tools.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:d=2',
      '-f',
      'mp4',
      silentVideo,
    ])
    const h = setup([silentVideo])
    await withShots(h)
    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('不是音訊') as unknown,
    })
    expect(h.sound.state().music).toBeUndefined()
  })

  it('沒有開專案：請先開專案', async () => {
    const h = setup([])
    await expect(h.sound.importMusic()).rejects.toMatchObject({
      userMessage: expect.stringContaining('專案') as unknown,
    })
  })

  it('混音用到它：成品有聲音軌、長度沒變；比影片長的配樂被截掉（成品長度＝影片長度）', async () => {
    const dir = tempDir()
    const long = await makeTrack(dir, '很長.wav', 60, 523)
    const h = setup([long])
    await withShots(h)
    await h.shots.rejoin()
    const before = h.projects.current()?.repos.finalCuts.latest()
    const beforeSec = before?.durationSec ?? 0
    await h.sound.importMusic()
    expect(h.shots.finalCut()).toMatchObject({ stale: true, staleReason: 'sound' })
    const { videoHash } = await h.sound.mix()
    const mixed = h.projects.current()?.assets.getMeta(videoHash)
    expect(mixed?.durationSec).toBeCloseTo(beforeSec, 1)
    expect(h.sound.state().final).toMatchObject({ hasSound: true, soundStale: false })
  })

  it('復原與片尾：自己的音樂不進片尾的 AI 服務清單；刪掉它、再匯入都不影響別的', async () => {
    const dir = tempDir()
    const file = await makeTrack(dir, '我的.wav', 3)
    const h = setup([file])
    await withShots(h)
    const handle = h.projects.current()
    if (!handle) throw new Error('專案應該開著')
    const without = collectAttributions(handle, h.models)
    await h.sound.importMusic()
    expect(collectAttributions(handle, h.models)).toEqual(without)
    // 調音量可以（跟生成的配樂一樣）；刪掉就沒有配樂
    const clip = h.sound.state().music
    expect(h.sound.updateClip(clip?.id ?? '', { gainDb: -12 }).gainDb).toBe(-12)
    h.sound.removeClip(clip?.id ?? '')
    expect(h.sound.state().music).toBeUndefined()
  })
})
