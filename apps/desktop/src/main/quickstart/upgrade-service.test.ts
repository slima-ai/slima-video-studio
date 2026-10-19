import type { LlmRequest, Shot } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'
import { pickHeroFrame } from './upgrade-service'

// 每個測試都要跑完整的快速開始，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

/** 假拆鏡：阿鐵在前兩鏡出場（第二鏡是特寫），小花只在第二鏡跟他同框。 */
const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: ['阿鐵'] },
          {
            description: '阿鐵和小花撿起小貓',
            size: 'close_up',
            cameraMove: null,
            characters: ['阿鐵', '小花'],
          },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

const setup = (): Harness => {
  const harness = createStudioHarness({ mockLlm: breakdown })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

const fakeShot = (size: Shot['size'], names: string[]): Shot =>
  ({ size, characters: names.map((name) => ({ name })) }) as unknown as Shot

describe('pickHeroFrame', () => {
  const frames = new Map<Shot, string>()
  const frameOf = (shot: Shot) => {
    const hash = frames.get(shot)
    return hash ? { assetHash: hash, modelId: 'm' } : undefined
  }

  it('挑景別最近的那一鏡；一樣近就挑畫面裡別人比較少的，再一樣就挑前面的', () => {
    const wide = fakeShot('wide', ['阿鐵'])
    const crowd = fakeShot('close_up', ['阿鐵', '小花'])
    const solo = fakeShot('close_up', ['阿鐵'])
    const soloLater = fakeShot('close_up', ['阿鐵'])
    frames.clear()
    frames.set(wide, HASH_A)
    frames.set(crowd, HASH_B)
    frames.set(solo, HASH_C)
    frames.set(soloLater, 'd'.repeat(64))
    expect(pickHeroFrame('阿鐵', [wide, crowd, solo, soloLater], frameOf)?.assetHash).toBe(HASH_C)
  })

  it('沒有生成好的畫面、或根本沒出場的角色 → 沒有主圖', () => {
    const shot = fakeShot('close_up', ['阿鐵'])
    frames.clear()
    expect(pickHeroFrame('阿鐵', [shot], frameOf)).toBeUndefined()
    frames.set(shot, HASH_A)
    expect(pickHeroFrame('小花', [shot], frameOf)).toBeUndefined()
  })
})

describe('升級成專案', () => {
  it('沒有做過快速開始 → 不能升級，說明原因', () => {
    const h = setup()
    expect(h.upgrade.check()).toMatchObject({ ok: false, shotCount: 0 })
    expect(() => h.upgrade.upgrade()).toThrow('請先用「快速開始」生成一支影片')
  })

  it('快速開始完成後：一幕一場放進全部鏡頭、建出場角色的草稿卡並挑主圖，不重新生成', async () => {
    const h = setup()
    await h.runQuickStart()
    const jobsBefore = h.projects.current()?.repos.jobs.list().length ?? 0
    const shotsBefore = h.shots.list().shots

    expect(h.upgrade.check()).toMatchObject({
      ok: true,
      shotCount: 3,
      actTitle: '雨天的貓',
      newCharacters: ['阿鐵', '小花'],
    })
    const result = h.upgrade.upgrade()
    expect(result).toEqual({
      actTitle: '雨天的貓',
      shotCount: 3,
      characters: [
        { name: '阿鐵', heroPicked: true },
        { name: '小花', heroPicked: true },
      ],
    })

    const outline = h.outline.get()
    expect(outline.acts).toHaveLength(1)
    expect(outline.acts[0]?.title).toBe('雨天的貓')
    const scene = outline.acts[0]?.scenes[0]
    expect(scene?.title).toBe('第一場')

    const shotsAfter = h.shots.list().shots
    expect(shotsAfter.map((s) => s.sceneId)).toEqual([scene?.id, scene?.id, scene?.id])
    // 已經生成的畫面和影片全部還在
    expect(shotsAfter.map((s) => s.videos.length)).toEqual(shotsBefore.map((s) => s.videos.length))
    expect(shotsAfter.every((s) => s.status === shotsBefore[0]?.status)).toBe(true)
    expect(h.projects.current()?.repos.jobs.list()).toHaveLength(jobsBefore)

    const people = h.characters.list()
    expect(people.map((c) => c.name)).toEqual(['阿鐵', '小花'])
    expect(people.every((c) => c.anchorStatus === 'draft' && c.heroAssetHash !== undefined)).toBe(
      true,
    )
  })

  it('升過一次就不能再升（已經有大綱）；已經有的角色不會重複建', async () => {
    const h = setup()
    await h.runQuickStart()
    h.characters.create('阿鐵')
    expect(h.upgrade.check().newCharacters).toEqual(['小花'])
    h.upgrade.upgrade()
    expect(h.characters.list().map((c) => c.name)).toEqual(['阿鐵', '小花'])

    const again = h.upgrade.check()
    expect(again.ok).toBe(false)
    expect(again.issue).toContain('已經有大綱')
    expect(() => h.upgrade.upgrade()).toThrow('已經有大綱')
  })

  it('影片還在生成時不能升級', async () => {
    const h = setup()
    await h.quickstart.run({
      story: '一隻貓在雨天裡找到溫暖的家',
      style: 'anime',
      shotCount: 3,
      durationSec: 3,
      aspectRatio: '16:9',
      variation: 0,
    })
    // 剛開始跑：鏡頭可能還沒拆好；等有鏡頭、而且還沒結束的那一刻檢查
    await vi.waitFor(() => {
      const check = h.upgrade.check()
      expect(check.shotCount).toBeGreaterThan(0)
      if (h.progress().at(-1)?.status === 'running') {
        expect(check.ok).toBe(false)
        expect(check.issue).toContain('還在生成')
      }
    })
    await h.finished()
  })
})
