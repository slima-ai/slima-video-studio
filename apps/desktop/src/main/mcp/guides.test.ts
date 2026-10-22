import { CAMERA_MOVE_IDS, ShotAngleSchema, ShotSizeSchema } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { SERVER_INSTRUCTIONS } from './instructions'
import { GUIDE_TOPICS, guideText } from './tools/guides'

const cinematography = guideText('cinematography', '')

describe('load_guide("cinematography")', () => {
  it('是 get_capabilities 列出的主題之一，伺服器 instructions 與 getting-started 都指到它', () => {
    expect(GUIDE_TOPICS).toContain('cinematography')
    expect(SERVER_INSTRUCTIONS).toContain('cinematography')
    expect(guideText('getting-started', '')).toContain('load_guide("cinematography")')
  })

  it('App 的景別 6 個、角度 8 個、運鏡預設 10 個 id 一個不缺（欄位多了或改名，這份指南就要跟著改）', () => {
    expect(ShotSizeSchema.options).toHaveLength(6)
    expect(ShotAngleSchema.options).toHaveLength(8)
    expect(CAMERA_MOVE_IDS).toHaveLength(10)
    for (const id of [...ShotSizeSchema.options, ...ShotAngleSchema.options, ...CAMERA_MOVE_IDS]) {
      expect(cinematography, id).toContain(id)
    }
  })

  it('溶接、淡出只出現在「沒有這些」那一句，不會被當成可以用的選項', () => {
    const mentions = cinematography.match(/dissolve|fade|wipe|crossfade/gi) ?? []
    expect(mentions).toHaveLength(3)
    expect(cinematography).toContain('There is no dissolve, fade or wipe')
    expect(cinematography).toContain('straight cuts')
  })

  it('「情緒對鏡頭」那五條前面寫明只是起點，不是規則', () => {
    const feeling = cinematography.slice(cinematography.indexOf('Feeling to shot'))
    expect(feeling).toContain('Starting points, not laws:')
    expect(feeling.indexOf('Starting points, not laws:')).toBeLessThan(feeling.indexOf('- Lonely'))
  })

  it('運鏡要選對的、不預設不動：每場至少一個帶目的的運鏡、同一種運鏡或角度不連續超過兩鏡；static 留給對話與停頓', () => {
    expect(cinematography).not.toMatch(/default when you have no reason/i)
    expect(cinematography).toContain('Each scene needs at least one move with a purpose')
    expect(cinematography).toContain('in more than two shots in a row')
    expect(cinematography).toContain('Keep static for dialogue, a pause, an emotional landing')
  })

  it('描述一個構圖：用前景、背景、遠近說位置，不要把畫面切成上下或左右兩塊（圖片模型會畫成兩格拼貼）', () => {
    expect(cinematography).toContain('Describe one composition')
    expect(cinematography).toContain(
      'never by splitting the frame into top and bottom or left and right parts',
    )
    expect(cinematography).toContain('two-panel collage')
  })

  it('長度不超過現有最長指南的 1.5 倍（每個工作階段載入都要花 token）', () => {
    const longest = Math.max(
      ...GUIDE_TOPICS.filter(
        (t) => t !== 'cinematography' && t !== 'storyboard' && t !== 'production',
      ).map((t) => guideText(t, '').length),
    )
    expect(cinematography.length).toBeLessThan(longest * 1.5)
  })
})

describe('load_guide("production")', () => {
  const production = guideText('production', '')

  it('是 get_capabilities 列出的主題之一，伺服器 instructions 與 getting-started 都指到它', () => {
    expect(GUIDE_TOPICS).toContain('production')
    expect(SERVER_INSTRUCTIONS).toContain('production')
    expect(guideText('getting-started', '')).toContain('load_guide("production")')
  })

  it('約 1,000 字以內：每個工作階段載入都要花 token（原則勝過硬規則，不寫死張數與模型）', () => {
    expect(production.split(/\s+/).length).toBeLessThan(1000)
    expect(production).not.toMatch(/\b\d+ (reference )?(images|pictures)\b/i)
  })

  it('沒驗證的說法要明講「沒驗證」，不能當成已證實的規則', () => {
    const unproven = production.slice(production.indexOf('Not yet proven'))
    expect(unproven).toContain('only in one blog post')
    expect(unproven).toContain('not been tested here')
  })

  it('使用者自訂的內容優先；空白就回到預設', () => {
    expect(guideText('production', '', '臉先鎖定。')).toContain('臉先鎖定。')
    expect(guideText('production', '', '臉先鎖定。')).not.toContain('Production and consistency')
    expect(guideText('production', '', '  ')).toBe(production)
  })
})
