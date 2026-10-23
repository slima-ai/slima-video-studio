import { describe, expect, it } from 'vitest'

import { resolveTrim, snapToFrame, trimKeyOf, trimmedLengthSec } from './trim'

const FPS = 24
const resolve = (
  edit: Parameters<typeof resolveTrim>[0]['edit'],
  current?: Parameters<typeof resolveTrim>[0]['current'],
  durationSec = 5.041667,
) => resolveTrim({ current, edit, durationSec, fps: FPS })

describe('resolveTrim：入點／出點整理成能存的裁切', () => {
  it('只給出點 3.5：留下 0–3.5 秒、84 格；頭不裁所以不存入點', () => {
    const r = resolve({ outSec: 3.5 })
    expect(r).toMatchObject({ ok: true, startSec: 0, endSec: 3.5, lengthSec: 3.5, frames: 84 })
    expect(r.ok && r.trim).toEqual({ outSec: 3.5 })
    expect(r.ok && r.adjustments).toEqual([])
  })

  it('沒給的那一端沿用目前的；只改入點不動出點', () => {
    const r = resolve({ inSec: 1 }, { outSec: 3.5 })
    expect(r.ok && r.trim).toEqual({ inSec: 1, outSec: 3.5 })
    expect(r.ok && r.frames).toBe(60)
  })

  it('使用者打的數字被格線改掉：寫在 adjustments（3.51 → 3.5），不悄悄改', () => {
    const r = resolve({ outSec: 3.51 })
    expect(r.ok && r.trim).toEqual({ outSec: 3.5 })
    expect(r.ok && r.adjustments).toEqual([
      { field: 'outSec', reason: 'snapped', from: 3.51, to: 3.5 },
    ])
    const r2 = resolve({ inSec: 0.52, outSec: 3.5 })
    expect(r2.ok && r2.adjustments).toEqual([
      { field: 'inSec', reason: 'snapped', from: 0.52, to: 0.5 },
    ])
  })

  it('出點超過影片長度：夾到影片長度並寫出來；剛好是整支就不存出點', () => {
    const r = resolve({ inSec: 1, outSec: 9 })
    expect(r.ok && r.trim).toEqual({ inSec: 1 })
    expect(r.ok && r.adjustments).toEqual([
      { field: 'outSec', reason: 'clamped', from: 9, to: 5.041667 },
    ])
  })

  it('兩端都回到頭尾，或 clear：整支（trim 是 undefined）', () => {
    expect(resolve({ clear: true }, { inSec: 1, outSec: 3 })).toMatchObject({
      ok: true,
      trim: undefined,
      startSec: 0,
      frames: 121,
    })
    const back = resolve({ inSec: 0 }, { inSec: 1 })
    expect(back.ok && back.trim).toBeUndefined()
  })

  it('入點不小於出點、或剪完不到一格：不存（ok:false）', () => {
    expect(resolve({ inSec: 3, outSec: 3 })).toMatchObject({ ok: false, reason: 'inverted' })
    expect(resolve({ inSec: 4, outSec: 2 })).toMatchObject({ ok: false, reason: 'inverted' })
    // 兩個數字都對齊到同一格：剪完一格都不剩
    expect(resolve({ inSec: 2.001, outSec: 2.01 })).toMatchObject({ ok: false })
  })

  it('剪完只剩一格也行（只擋「不剩任何畫面」，不擋短）', () => {
    const r = resolve({ inSec: 2, outSec: 2 + 1 / 24 })
    expect(r).toMatchObject({ ok: true, frames: 1 })
  })

  it('對齊用的是傳進來的幀率：25 fps 時 3.5 秒是 87.5 格 → 3.52（88 格）', () => {
    const r = resolveTrim({ current: undefined, edit: { outSec: 3.5 }, durationSec: 5, fps: 25 })
    expect(r.ok && r.endSec).toBe(3.52)
    expect(r.ok && r.frames).toBe(88)
  })
})

describe('snapToFrame／trimmedLengthSec／trimKeyOf', () => {
  it('snapToFrame 回到最近一格，沒有浮點雜訊', () => {
    expect(snapToFrame(3.5, 24)).toBe(3.5)
    expect(snapToFrame(3.51, 24)).toBe(3.5)
    expect(snapToFrame(3.53, 24)).toBe(3.541667)
  })

  it('trimmedLengthSec：沒裁是整支；只裁頭或尾都對', () => {
    expect(trimmedLengthSec(undefined, 5.0417)).toBe(5.0417)
    expect(trimmedLengthSec({ outSec: 3.5 }, 5.0417)).toBe(3.5)
    expect(trimmedLengthSec({ inSec: 1 }, 5)).toBe(4)
    expect(trimmedLengthSec({ inSec: 1, outSec: 3.5 }, 5)).toBe(2.5)
  })

  it('trimKeyOf：一鏡都沒裁是 undefined（和舊成品一樣）；裁了就帶版本 id 與數字', () => {
    expect(trimKeyOf([])).toBeUndefined()
    expect(
      trimKeyOf([
        { id: 'a', trim: undefined },
        { id: '', trim: { outSec: 3 } },
      ]),
    ).toBeUndefined()
    const key = trimKeyOf([
      { id: 'a', trim: undefined },
      { id: 'b', trim: { outSec: 3.5 } },
    ])
    expect(key).toBe('[["b",0,3.5]]')
    // 換一個影片版本、或改一個數字，指紋就不同
    expect(trimKeyOf([{ id: 'c', trim: { outSec: 3.5 } }])).not.toBe(key)
    expect(trimKeyOf([{ id: 'b', trim: { outSec: 3.4 } }])).not.toBe(key)
  })
})
