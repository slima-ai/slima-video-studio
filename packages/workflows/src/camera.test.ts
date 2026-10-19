import { CAMERA_MOVES, cameraMoveById } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { resolveCameraMove } from './camera'

const request = { prompt: '貓走在雨中', cameraMove: 'orbit' }

describe('resolveCameraMove', () => {
  it('沒有指定運鏡：原封不動', () => {
    expect(resolveCameraMove({ prompt: 'p' }, undefined)).toEqual({ prompt: 'p' })
    expect(resolveCameraMove({ prompt: 'p' }, { cameraParams: { orbit: { a: 1 } } })).toEqual({
      prompt: 'p',
    })
  })

  it('模型沒有原生參數：把運鏡的描述加到 Prompt 後面（預設中文）', () => {
    const orbit = cameraMoveById('orbit')?.prompt
    expect(resolveCameraMove(request, undefined)).toEqual({
      prompt: `貓走在雨中，${orbit?.zh ?? ''}`,
      cameraMove: 'orbit',
    })
    expect(resolveCameraMove(request, { prompt: { language: 'zh' } }).prompt).toContain(
      orbit?.zh ?? '',
    )
  })

  it('模型偏好英文：加英文描述', () => {
    const result = resolveCameraMove(request, { prompt: { language: 'en' } })
    expect(result.prompt).toBe(`貓走在雨中，${cameraMoveById('orbit')?.prompt.en ?? ''}`)
  })

  it('模型有這個運鏡的原生參數：併進 cameraParams，Prompt 不動', () => {
    const result = resolveCameraMove(request, {
      cameraParams: { orbit: { camera_control: { type: 'orbit' } } },
    })
    expect(result).toEqual({
      prompt: '貓走在雨中',
      cameraMove: 'orbit',
      cameraParams: { camera_control: { type: 'orbit' } },
    })
  })

  it('模型只對應了別的運鏡：這個運鏡仍然加進 Prompt', () => {
    const result = resolveCameraMove(request, { cameraParams: { push_in: { zoom: 1 } } })
    expect(result).not.toHaveProperty('cameraParams')
    expect(result.prompt).toContain('環繞')
  })

  it('不是預設清單裡的（自己打的字）：原樣加進 Prompt', () => {
    expect(
      resolveCameraMove({ prompt: 'p', cameraMove: '慢慢往右邊搖過去' }, undefined).prompt,
    ).toBe('p，慢慢往右邊搖過去')
  })

  it('不會改動傳入的請求物件', () => {
    const original = { prompt: 'p', cameraMove: 'pan' }
    resolveCameraMove(original, undefined)
    expect(original).toEqual({ prompt: 'p', cameraMove: 'pan' })
  })
})

describe('運鏡預設清單', () => {
  it('每一項都有 ID、中文名稱、說明與中英文 Prompt 片段，ID 不重複', () => {
    expect(new Set(CAMERA_MOVES.map((c) => c.id)).size).toBe(CAMERA_MOVES.length)
    expect(CAMERA_MOVES.map((c) => c.label)).toEqual([
      '固定',
      '推近',
      '拉遠',
      '左右搖',
      '上下搖',
      '環繞',
      '跟拍',
      '手持',
      '升降',
      '慢動作',
    ])
    for (const move of CAMERA_MOVES) {
      expect(move.description.length).toBeGreaterThan(3)
      expect(move.prompt.zh.length).toBeGreaterThan(3)
      expect(move.prompt.en.length).toBeGreaterThan(3)
    }
  })
})
