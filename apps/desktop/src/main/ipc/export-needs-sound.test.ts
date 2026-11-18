import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { testSettingsDeps } from '../settings/test-deps'
import { createStudioHarness } from '../shots/test-harness'
import { registerAllHandlers, type HandlerDeps } from './handlers'
import { createIpcRegistry } from './registry'

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup()
})

const STILL_ADDING = '旁白與配樂還在加，加好之後再匯出，才會有聲音。'

/** 真的快速開始、聲音、專案服務接上匯出的 handler；畫布服務用測試替身（可以讓它說「還在加」或「沒在加」）。 */
function exporter(h: Harness, canvasSaysAdding = false) {
  const base = testSettingsDeps(new MemoryVault())
  const registry = createIpcRegistry({ warn: vi.fn(), error: vi.fn() })
  const deps: HandlerDeps = {
    info: { name: 'n', version: '1', platform: 'linux', packaged: false },
    projects: h.projects,
    keys: new MemoryVault(),
    ...base,
    canvas: { ...base.canvas, soundAdding: () => canvasSaysAdding },
    quickstart: h.quickstart,
    sound: h.sound,
    shots: h.shots,
  }
  registerAllHandlers(registry, deps)
  return () =>
    registry.dispatch(
      { channel: 'quickstart.export', payload: { credits: false } },
      { emit: () => undefined },
    )
}

const request = {
  story: '一隻貓在雨天裡找到溫暖的家',
  style: 'anime',
  shotCount: 2,
  durationSec: 3,
  aspectRatio: '16:9',
  variation: 0,
} as const

/** 讓配樂卡住，直到 release()，才量得到「還在加」。 */
function holdMusic(h: Harness): () => void {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const real = h.sound.generateMusic.bind(h.sound)
  vi.spyOn(h.sound, 'generateMusic').mockImplementation(async (input) => {
    await gate
    return real(input)
  })
  return release
}

describe('匯出不看畫布：旁白與配樂還在加的時候不准匯出（看聲音服務自己的狀態）', () => {
  it('一句話生成的加聲音階段：匯出被擋，加完才放行（這一段以前沒擋）', async () => {
    const h = createStudioHarness()
    open.push(h)
    const release = holdMusic(h)
    const exportNow = exporter(h)

    await h.quickstart.run({ ...request, sound: { native: false, narration: false, music: true } })
    await vi.waitFor(
      () => {
        expect(h.sound.adding()).toBe(true)
      },
      { timeout: 60_000, interval: 20 },
    )
    // 這時候影片已經接好、有成品，沒擋的話匯出是會成功的（拿掉守衛會紅就紅在這裡）
    const blocked = await exportNow()
    expect(blocked).toMatchObject({ ok: false, error: { userMessage: STILL_ADDING } })

    release()
    await h.finished()
    expect(h.sound.adding()).toBe(false)
    const allowed = await exportNow()
    expect(allowed.ok).toBe(true)
  })

  it('畫布說「沒在加」也一樣擋：看的是聲音服務，不是畫布', async () => {
    const h = createStudioHarness()
    open.push(h)
    const release = holdMusic(h)
    const exportNow = exporter(h, false)

    await h.quickstart.run({ ...request, sound: { native: false, narration: false, music: true } })
    await vi.waitFor(
      () => {
        expect(h.sound.adding()).toBe(true)
      },
      { timeout: 60_000, interval: 20 },
    )
    expect(await exportNow()).toMatchObject({ ok: false, error: { userMessage: STILL_ADDING } })
    release()
    await h.finished()
  })

  it('聲音服務說沒在加：就算畫布說「還在加」也不擋（畫布不再有決定權）', async () => {
    const h = createStudioHarness()
    open.push(h)
    const exportNow = exporter(h, true)

    await h.quickstart.run({ ...request, sound: { native: false, narration: false, music: false } })
    await h.finished()
    expect(h.sound.adding()).toBe(false)
    expect((await exportNow()).ok).toBe(true)
  })
})
