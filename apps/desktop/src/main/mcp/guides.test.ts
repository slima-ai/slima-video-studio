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

  it('長度不超過現有最長指南的 1.5 倍（每個工作階段載入都要花 token）', () => {
    const longest = Math.max(
      ...GUIDE_TOPICS.filter((t) => t !== 'cinematography' && t !== 'storyboard').map(
        (t) => guideText(t, '').length,
      ),
    )
    expect(cinematography.length).toBeLessThan(longest * 1.5)
  })
})
