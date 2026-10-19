import { DEFAULT_SOUND_SETTINGS } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { newProject, reopen } from '../__tests__/helpers'

const HASH = (c: string): string => c.repeat(64)

const narration = (shotId: string, assetHash = HASH('a')) => ({
  kind: 'narration' as const,
  shotId,
  assetHash,
  text: '黑藤爬滿了斷橋',
  voiceId: 'male-qn-qingse',
  modelId: 'openrouter/minimax-speech-2.8-hd',
  offsetSec: 0.4,
  durationSec: 3.2,
})

describe('SoundRepository：片段與版本', () => {
  it('同一鏡的旁白每生成一次多一個版本，新的自動變成採用中，舊的取消採用', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'A' })
    const first = repos.sound.addClip(narration(shot.id))
    const second = repos.sound.addClip(narration(shot.id, HASH('b')))
    expect([first.version, second.version]).toEqual([1, 2])
    expect(first.adopted).toBe(true)
    expect(repos.sound.getClip(first.id)?.adopted).toBe(false)
    expect(repos.sound.getClip(second.id)?.adopted).toBe(true)
    expect(repos.sound.listClips({ adoptedOnly: true }).map((c) => c.id)).toEqual([second.id])
    expect(second).toMatchObject({ voiceId: 'male-qn-qingse', offsetSec: 0.4, durationSec: 3.2 })
  })

  it('不同鏡頭、不同種類的版本各算各的；配樂是整支的（沒有 shotId），也有版本', () => {
    const { repos } = newProject()
    const a = repos.shots.create({ description: 'A' })
    const b = repos.shots.create({ description: 'B' })
    expect(repos.sound.addClip(narration(a.id)).version).toBe(1)
    expect(repos.sound.addClip(narration(b.id)).version).toBe(1)
    const music1 = repos.sound.addClip({ kind: 'music', assetHash: HASH('m'), modelId: 'x/lyria' })
    const music2 = repos.sound.addClip({ kind: 'music', assetHash: HASH('n'), modelId: 'x/lyria' })
    expect([music1.version, music2.version]).toEqual([1, 2])
    expect(music1.shotId).toBeUndefined()
    // 旁白的採用不受配樂影響
    expect(
      repos.sound
        .listClips({ adoptedOnly: true })
        .map((c) => c.kind)
        .sort(),
    ).toEqual(['music', 'narration', 'narration'])
  })

  it('配樂不能屬於某一鏡，旁白與音效一定要屬於某一鏡', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'A' })
    expect(() =>
      repos.sound.addClip({ kind: 'music', shotId: shot.id, assetHash: HASH('m'), modelId: 'x' }),
    ).toThrow(/配樂是整支的/)
    expect(() =>
      repos.sound.addClip({ kind: 'narration', assetHash: HASH('m'), modelId: 'x' }),
    ).toThrow(/旁白與音效要屬於某一鏡/)
  })

  it('調整位置、增益、淡化；給 null 改回預設；負的起點被拒絕', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'A' })
    const clip = repos.sound.addClip(narration(shot.id))
    const tuned = repos.sound.updateClip(clip.id, { offsetSec: 1, gainDb: -3, fadeOutSec: 0.5 })
    expect(tuned).toMatchObject({ offsetSec: 1, gainDb: -3, fadeOutSec: 0.5 })
    const reset = repos.sound.updateClip(clip.id, { gainDb: null })
    expect(reset.gainDb).toBeUndefined()
    expect(reset.fadeOutSec).toBe(0.5)
    expect(() => repos.sound.updateClip(clip.id, { offsetSec: -1 })).toThrow(/不能是負的/)
    expect(() => repos.sound.updateClip('不存在', { gainDb: 1 })).toThrow(/找不到/)
  })

  it('改採用某個舊版本；刪掉採用中的就改採用剩下最新的；刪不存在的不報錯', () => {
    const { repos } = newProject()
    const shot = repos.shots.create({ description: 'A' })
    const v1 = repos.sound.addClip(narration(shot.id))
    const v2 = repos.sound.addClip(narration(shot.id, HASH('b')))
    const v3 = repos.sound.addClip(narration(shot.id, HASH('c')))
    repos.sound.adoptClip(v1.id)
    expect(repos.sound.listClips({ adoptedOnly: true }).map((c) => c.id)).toEqual([v1.id])
    repos.sound.removeClip(v1.id)
    expect(repos.sound.listClips({ adoptedOnly: true }).map((c) => c.id)).toEqual([v3.id])
    repos.sound.removeClip(v2.id) // 刪掉沒在採用的，不影響
    expect(repos.sound.listClips().map((c) => c.id)).toEqual([v3.id])
    expect(() => {
      repos.sound.removeClip('不存在')
    }).not.toThrow()
  })

  it('刪掉鏡頭，它的旁白一起刪掉；專案重新開啟後資料還在', () => {
    const handle = newProject()
    const { repos } = handle
    const keep = repos.shots.create({ description: 'A' })
    const gone = repos.shots.create({ description: 'B' })
    repos.sound.addClip(narration(keep.id))
    repos.sound.addClip(narration(gone.id))
    repos.shots.delete(gone.id)
    handle.close()
    const reopened = reopen(handle)
    expect(reopened.repos.sound.listClips().map((c) => c.shotId)).toEqual([keep.id])
  })
})

describe('SoundRepository：聲音設定', () => {
  it('還沒設定過就是預設（全開）；逐項合併，驗證後存下，重開還在', () => {
    const handle = newProject()
    expect(handle.repos.sound.getSettings()).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(DEFAULT_SOUND_SETTINGS).toMatchObject({
      nativeAudio: true,
      duck: true,
      musicGainDb: -18,
    })
    handle.repos.sound.updateSettings({ musicGainDb: -24 })
    handle.repos.sound.updateSettings({ duck: false, muteNativeShotIds: ['s1'] })
    const expected = {
      ...DEFAULT_SOUND_SETTINGS,
      musicGainDb: -24,
      duck: false,
      muteNativeShotIds: ['s1'],
    }
    expect(handle.repos.sound.getSettings()).toEqual(expected)
    expect(() => handle.repos.sound.updateSettings({ musicGainDb: 999 })).toThrow(/聲音設定/)
    handle.close()
    expect(reopen(handle).repos.sound.getSettings()).toEqual(expected)
  })
})
