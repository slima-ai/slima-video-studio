import { CAMERA_MOVE_IDS, ShotAngleSchema, ShotSizeSchema } from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { SERVER_INSTRUCTIONS } from './instructions'
import { ESTIMATE_COST_ACTIONS } from './tools/story'
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

  it('約 1,100 字以內：每個工作階段載入都要花 token（原則勝過硬規則，不寫死張數與模型）。上限從 1,000 放寬到 1,100：場景卡「不能建立就直說、每一鏡的地點用字一字不改」擋的是很常見的走樣，比字數重要', () => {
    expect(production.split(/\s+/).length).toBeLessThan(1100)
    expect(production).not.toMatch(/\b\d+ (reference )?(images|pictures)\b/i)
  })

  it('尾幀描述：只寫同一個鏡位幾秒後哪裡變了（誰移到哪、原位變空、物件帶走或留下）；大小用相對的東西寫、不寫百分比；移動過的角色只出現在新位置；先用 estimate_cost 報價', () => {
    const section = production.slice(
      production.indexOf('End frame (optional)'),
      production.indexOf('Look before you spend more'),
    )
    expect(section).toContain('the same picture a few seconds later')
    expect(section).toContain('same camera position, scene, light and style')
    expect(section).toContain('that the old spot is now empty')
    expect(section).toContain('carried off or left behind')
    expect(section).toContain("about one third of the orc's height")
    expect(section).toContain('never percentages')
    expect(section).toContain('appears once, in its new place only')
    expect(section).toContain('Quote the price first')
    // 提到的工具名與欄位要是真的（改名了這份指南就要跟著改）
    expect(ESTIMATE_COST_ACTIONS as readonly string[]).toContain('generate_end_frame')
    expect(section).toContain('estimate_cost, action generate_end_frame')
    expect(section).toContain('endDescription (update_shot)')
  })

  it('沒驗證的說法要明講「沒驗證」，不能當成已證實的規則', () => {
    const unproven = production.slice(production.indexOf('Not yet proven'))
    expect(unproven).toContain('only in one blog post')
    expect(unproven).toContain('not been tested here')
  })

  it('場景卡還不能由 AI 建立：直說，並且每一鏡的地點用字一字不改，不要每鏡重新描述', () => {
    expect(production).toContain('You cannot create place cards yet: say so')
    expect(production).toContain("keep each place's words identical across shots")
  })

  it('avoid：只列這個角色沒有、同鏡其他角色也沒有的特徵；同鏡的清單併用，有衝突就拿掉或拆鏡', () => {
    expect(production).toContain('avoid list')
    expect(production).toContain('every other character in the same shot lacks too')
    expect(production).toContain('combined as written')
    expect(production).toContain('drop it or split the shots')
  })

  it('送參考圖給影片模型：已實測過（Kling 經 OpenRouter 變差、App 標不建議），寫在「沒驗證」之外，不能再說沒測過', () => {
    const tested = production.slice(0, production.indexOf('Not yet proven'))
    expect(tested).toContain('In one real test (Kling via OpenRouter')
    expect(tested).toContain('not recommended')
    expect(tested).toContain('rely on the first frame')
    expect(production.slice(production.indexOf('Not yet proven'))).not.toMatch(/video model/i)
  })

  it('使用者自訂的內容優先；空白就回到預設', () => {
    expect(guideText('production', '', '臉先鎖定。')).toContain('臉先鎖定。')
    expect(guideText('production', '', '臉先鎖定。')).not.toContain('Production and consistency')
    expect(guideText('production', '', '  ')).toBe(production)
  })
})
