import { encodePng } from '@svs/providers'
import {
  DEFAULT_STORYBOARD_GUIDE,
  type QuickStartProgress,
  type QuickStartRequest,
} from '@svs/schema'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CREDITS_RENDER_TIMEOUT_MS } from '../credits/credits'
import { createStudioHarness, type HarnessOptions } from '../shots/test-harness'
import { safeFileName } from '../ensure-project'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function setup(options: HarnessOptions = {}) {
  const harness = createStudioHarness(options)
  cleanups.push(harness.cleanup)
  return { ...harness, service: harness.quickstart }
}

const request = (extra: Partial<QuickStartRequest> = {}): QuickStartRequest => ({
  story: '一隻貓在雨天裡找到溫暖的家',
  style: 'anime',
  shotCount: 3,
  durationSec: 3,
  aspectRatio: '16:9',
  variation: 0,
  ...extra,
})

describe('safeFileName', () => {
  it('去掉不能放進檔名的字元、壓縮空白、限制長度', () => {
    expect(safeFileName('a/b:c*d?', 'x')).toBe('a-b-c-d')
    expect(safeFileName('  雨天 的 貓  ', 'x')).toBe('雨天-的-貓')
    expect(safeFileName('x'.repeat(100), 'y')).toHaveLength(24)
    expect(safeFileName('///', '短片')).toBe('短片')
  })
})

describe('QuickStartService.check', () => {
  it('示範模式：沒問題，附預估花費與會用的模型', () => {
    const { service } = setup()
    const result = service.check(request())
    expect(result).toMatchObject({
      ok: true,
      issues: [],
      limitUsd: 5,
      demoMode: true,
    })
    expect(Object.keys(result.models).sort()).toEqual(['image', 'llm', 'video'])
    expect(result.estimatedUsd).toBeGreaterThan(0)
  })

  it('沒填故事、沒有任何 Key 也不是示範模式 → 列出問題，缺模型的可以前往設定', () => {
    const { service } = setup({ demoMode: false })
    const result = service.check(request({ story: '   ' }))
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        '請先輸入你想拍的故事。',
        expect.stringContaining('還沒有可用的文字模型'),
        expect.stringContaining('還沒有可用的圖片模型'),
        expect.stringContaining('還沒有可用的影片模型'),
      ]),
    )
    expect(result.issues.filter((i) => i.action === 'settings')).toHaveLength(3)
    expect(result.estimatedUsd).toBe(0)
    expect(result.estimateIsLowerBound).toBe(true)
  })

  it('預估花費超過單次上限 → 擋下並可前往設定調高', () => {
    const { service } = setup({ perRunLimitUsd: 0.0001 })
    const result = service.check(request())
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ action: 'settings' })
    expect(result.issues[0]?.message).toContain('超過「單次花費上限」')
  })

  it('鏡頭越多預估越貴', () => {
    const { service } = setup()
    expect(service.check(request({ shotCount: 6 })).estimatedUsd).toBeGreaterThan(
      service.check(request({ shotCount: 2 })).estimatedUsd,
    )
  })
})

describe('QuickStartService.run（示範模式，不連網、不用 Key）', () => {
  it('沒有專案時自動建立；每鏡依序完成；成品可以匯出到 exports 資料夾', async () => {
    const { root, projects, service, progress, finished } = setup()
    expect(projects.current()).toBeUndefined()

    const { runId } = await service.run(request())
    expect(projects.current()).toBeDefined()
    expect(readdirSync(join(root, 'projects'))).toHaveLength(1)

    const done = await finished()
    expect(done).toMatchObject({ runId, status: 'succeeded', phase: 'done' })
    expect(done.shots).toHaveLength(3)
    expect(done.shots.every((s) => s.step === 'done' && s.imageHash && s.videoHash)).toBe(true)
    expect(done.finalVideoHash).toBeDefined()
    expect(done.costUsd).toBeGreaterThan(0)
    // 過程中看得到「拆鏡 → 逐鏡 → 接片」依序出現
    const phases = new Set(progress().map((p) => p.phase))
    expect(phases).toEqual(new Set(['breakdown', 'shots', 'join', 'done']))
    expect(service.state()).toEqual(done)

    const { path } = await service.export()
    expect(path).toMatch(/exports[\\/].+\.mp4$/)
    expect(existsSync(path)).toBe(true)
    expect(service.state()?.exportedPath).toBe(path)
  })

  it('再跑一次相同內容：全部走快取，不再花錢', async () => {
    const { service, finished, progress } = setup()
    await service.run(request())
    const first = await finished()
    const before = progress().length
    await service.run(request())
    await vi.waitFor(
      () => {
        expect(progress().slice(before).at(-1)?.status).toBe('succeeded')
      },
      { timeout: 30_000 },
    )
    const second = progress().at(-1)
    expect(second?.costUsd).toBe(0)
    expect(second?.finalVideoHash).toBe(first.finalVideoHash)
  })

  it('只寫分鏡（stage: storyboard）：長出場和鏡頭，不生圖片、影片、成品，也不加聲音；預估只有拆鏡', async () => {
    const { shots, outline, service, finished } = setup()
    const full = service.check(request())
    const storyboard = service.check(request({ stage: 'storyboard' }))
    expect(storyboard.ok).toBe(true)
    expect(storyboard.estimatedUsd).toBeGreaterThan(0)
    expect(storyboard.estimatedUsd).toBeLessThan(full.estimatedUsd)

    await service.run(
      request({
        stage: 'storyboard',
        mode: 'append',
        sound: { native: true, narration: true, music: true },
      }),
    )
    const done = await finished()
    expect(done).toMatchObject({ status: 'succeeded', phase: 'done' })
    expect(done.finalVideoHash).toBeUndefined()
    // 長出一個場、三個鏡頭，都還沒有圖和影片
    const scenes = outline.get().acts.flatMap((act) => act.scenes)
    expect(scenes).toHaveLength(1)
    const list = shots.list().shots
    expect(list).toHaveLength(3)
    expect(list.every((shot) => shot.sceneId === scenes[0]?.id)).toBe(true)
    expect(list.every((shot) => shot.firstFrames.length === 0 && shot.videos.length === 0)).toBe(
      true,
    )
    // 之後用一般的「生成」補上圖片和影片
    expect(list.every((shot) => shot.status !== 'done')).toBe(true)
  })

  describe('一次做完整支的聲音通知：只說真的會做、做了的事', () => {
    const SOUND = { native: false, narration: true, music: true }
    const lastWith = (progress: () => QuickStartProgress[], key: 'soundStart' | 'soundDone') =>
      [...progress()].reverse().find((p) => p[key] !== undefined)?.[key]

    it('勾了旁白：拆鏡替每一鏡寫了台詞，進行中說旁白與配樂，完成說旁白與配樂也加好了，每一鏡都有旁白', async () => {
      const { service, finished, progress, sound, shots } = setup()
      await service.run(request({ sound: SOUND }))
      const done = await finished()
      expect(done.status).toBe('succeeded')
      for (const shot of shots.list().shots) expect(shot.dialogue.trim().length).toBeGreaterThan(0)
      expect(lastWith(progress, 'soundStart')).toBe('成品接好了，正在加旁白與配樂…')
      expect(done.soundDone).toBe('旁白與配樂也加好了')
      const state = sound.state()
      expect(state.music).toBeDefined()
      expect(state.shots.every((shot) => shot.narration !== undefined)).toBe(true)
    })

    it('沒勾旁白：不寫台詞，進行中只說配樂，完成說配樂加好了，沒有旁白', async () => {
      const { service, finished, progress, sound, shots } = setup()
      await service.run(request({ sound: { ...SOUND, narration: false } }))
      const done = await finished()
      expect(done.status).toBe('succeeded')
      for (const shot of shots.list().shots) expect(shot.dialogue).toBe('')
      expect(lastWith(progress, 'soundStart')).toBe('成品接好了，正在加配樂…')
      expect(done.soundDone).toBe('配樂加好了')
      const state = sound.state()
      expect(state.music).toBeDefined()
      expect(state.shots.every((shot) => shot.narration === undefined)).toBe(true)
    })
  })

  it('分鏡準則會帶進拆鏡的提示；改了準則就不再沿用舊的拆鏡結果', async () => {
    const systems: string[] = []
    const { service, finished, progress, settings } = setup({
      mockLlm: (r) => {
        if (r.system?.includes('分鏡助手')) systems.push(r.system)
        return undefined
      },
    })
    await service.run(request())
    await finished()
    expect(systems).toHaveLength(1)
    expect(systems[0]).toContain(DEFAULT_STORYBOARD_GUIDE)

    settings.update({ storyboardGuide: '結尾一定要用遠景。' })
    const before = progress().length
    await service.run(request())
    await vi.waitFor(
      () => {
        expect(progress().slice(before).at(-1)?.status).toBe('succeeded')
      },
      { timeout: 30_000 },
    )
    expect(systems).toHaveLength(2)
    expect(systems[1]).toContain('結尾一定要用遠景。')
    expect(systems[1]).not.toContain(DEFAULT_STORYBOARD_GUIDE)
  })

  it('檢查不過 → 丟出第一個問題的白話訊息，不會建立專案', async () => {
    const { service, projects, root } = setup({ demoMode: false })
    await expect(service.run(request())).rejects.toThrow(/還沒有可用的文字模型/)
    expect(projects.current()).toBeUndefined()
    expect(existsSync(join(root, 'projects'))).toBe(false)
  })

  it('正在生成時不能再開始一次；取消後狀態是 cancelled', async () => {
    const { service, finished } = setup()
    await service.run(request({ shotCount: 3 }))
    expect(service.check(request()).issues.map((i) => i.message)).toContain(
      '已經有一支影片正在生成，等它完成或先取消。',
    )
    await expect(service.run(request())).rejects.toMatchObject({ code: 'invalid_request' })
    service.cancel()
    const done = await finished()
    expect(done.status).toBe('cancelled')
    expect(service.check(request()).ok).toBe(true)
  })

  it('換專案會取消正在跑的生成，進度清空', async () => {
    const { service, projects, root } = setup()
    await service.run(request())
    projects.create(join(root, 'other.svsproj'), '另一個')
    expect(service.state()).toBeNull()
    // 讓被取消的執行把收尾做完；收尾時若還去碰已關閉的資料庫，會變成未處理的錯誤讓測試失敗
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(service.state()).toBeNull()
    expect(service.check(request()).ok).toBe(true)
  })
})

describe('QuickStartService.export', () => {
  it('還沒有成品就匯出 → 白話錯誤', async () => {
    const { service } = setup()
    await expect(service.export()).rejects.toThrow(/還沒有可以匯出的影片/)
  })
})

describe('QuickStartService.export：畫片尾字卡不能把匯出卡住', () => {
  const solidCard = ({ width, height }: { width: number; height: number }) =>
    Promise.resolve(new Uint8Array(encodePng(width, height, new Uint8Array(width * height * 3))))

  async function runToFinish(options: HarnessOptions) {
    const harness = setup(options)
    await harness.service.run(request({ shotCount: 2 }))
    await harness.finished()
    return harness
  }

  it('字卡畫得出來：匯出多 3 秒的字卡版，回報 credits=true', async () => {
    const { service } = await runToFinish({ renderCreditsCard: solidCard })
    const out = await service.export()
    expect(out.credits).toBe(true)
    expect(existsSync(out.path)).toBe(true)
  })

  it('同一秒匯出兩次（先有字卡、再取消字卡）：兩個檔案各是各的，後面的不會蓋掉前面的', async () => {
    const { service } = await runToFinish({ renderCreditsCard: solidCard })
    // 檔名的時間戳只到秒：時間定住，兩次匯出就在「同一秒」
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-20T04:50:06Z'))
      const withCard = await service.export({ credits: true })
      const plain = await service.export({ credits: false })
      const third = await service.export({ credits: false })
      expect(withCard.credits).toBe(true)
      expect(plain.credits).toBe(false)
      expect(new Set([withCard.path, plain.path, third.path]).size).toBe(3)
      for (const out of [withCard, plain, third]) expect(existsSync(out.path)).toBe(true)
      // 字卡版比原版長 3 秒，檔案大小不同：第一個檔案沒有被第二個蓋掉
      expect(statSync(withCard.path).size).not.toBe(statSync(plain.path).size)
      expect(withCard.path).toMatch(/-20261020-045006\.mp4$/)
      expect(plain.path).toMatch(/-20261020-045006-2\.mp4$/)
      expect(third.path).toMatch(/-20261020-045006-3\.mp4$/)
    } finally {
      vi.useRealTimers()
    }
  })

  it(
    '離屏視窗一直畫不出來（例如新視窗不載入）：超過上限就改匯出沒有字卡的版本，credits=false，並放掉視窗',
    async () => {
      let aborted = false
      const { service } = await runToFinish({
        creditsTimeoutMs: 300,
        // 模擬永遠不回來；只有被取消時才記下（真的畫圖那邊就是在這時關掉視窗）
        renderCreditsCard: ({ signal }) =>
          new Promise<never>(() => {
            signal?.addEventListener('abort', () => {
              aborted = true
            })
          }),
      })
      // 不量牆鐘時間（機器忙時會被拖慢）：沒有 creditsTimeoutMs 的話 export 要等正式的上限才放棄，
      // 這條測試會超過下面自己設的逾時而紅
      const out = await service.export()
      expect(out.credits).toBe(false)
      expect(existsSync(out.path)).toBe(true) // 匯出的是原版影片，檔案有做出來
      expect(aborted).toBe(true)
      expect(service.state()?.exportedPath).toBe(out.path)
      // 這條測試自己設逾時，不靠全域的 testTimeout：全域值（20 秒）剛好等於正式上限 CREDITS_RENDER_TIMEOUT_MS，
      // 打平的話，哪天有人把全域逾時調大，這道保護就悄悄沒了。比正式上限短 2 秒，才一定先紅
    },
    CREDITS_RENDER_TIMEOUT_MS - 2_000,
  )

  it('字卡逾時後才失敗的結果，不會變成未處理的拒絕', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { service } = await runToFinish({
        creditsTimeoutMs: 100,
        renderCreditsCard: () =>
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('late'))
            }, 300)
          }),
      })
      expect((await service.export()).credits).toBe(false)
      await new Promise((r) => setTimeout(r, 400))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
