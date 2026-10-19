import { describe, expect, it } from 'vitest'

import {
  buildConceptWorkflow,
  buildLocationAngleWorkflow,
  buildLocationConceptWorkflow,
  buildTurnaroundWorkflow,
} from './concept'
import {
  composeConceptPrompt,
  composeLocationAnglePrompt,
  composeLocationConceptPrompt,
  composeTurnaroundPrompt,
  turnaroundPromptNode,
} from './nodes'
import { QUICK_STYLES } from './styles'

describe('composeConceptPrompt', () => {
  const base = { name: '阿鐵', appearance: '短黑髮、琥珀色眼睛', outfit: '深藍工作服' }

  it('沒有固定描述：用長相與服裝，並附上畫風', () => {
    const prompt = composeConceptPrompt({ ...base, age: '28' }, 'anime')
    expect(prompt).toContain('阿鐵，28：短黑髮、琥珀色眼睛，深藍工作服')
    expect(prompt).toContain('全身站立')
    expect(prompt.endsWith(QUICK_STYLES.anime.fragment)).toBe(true)
  })

  it('有固定描述：原封不動用它，不再重複列長相與服裝', () => {
    const prompt = composeConceptPrompt({ ...base, anchor: ' 短黑髮、左臉小疤 ' }, 'realistic')
    expect(prompt).toContain('阿鐵：短黑髮、左臉小疤')
    expect(prompt).not.toContain('深藍工作服')
  })

  it('什麼都沒寫也能組出 Prompt（只有名字）', () => {
    const prompt = composeConceptPrompt({ name: '小雨', appearance: '', outfit: '' }, 'watercolor')
    expect(prompt).toContain('角色設定圖，小雨。')
  })
})

describe('buildConceptWorkflow', () => {
  it('輸入 → 圖片 → 輸出，帶入模型與變化編號', () => {
    const flow = buildConceptWorkflow({ model: 'fal/nano-banana-2', style: 'anime', variation: 7 })
    expect(flow.nodes.map((n) => [n.id, n.type])).toEqual([
      ['in', '$input'],
      ['prompt', 'character.conceptPrompt'],
      ['image', 'image.generate'],
      ['out', '$output'],
    ])
    expect(flow.nodes.find((n) => n.id === 'image')).toMatchObject({
      modelId: 'fal/nano-banana-2',
      params: { aspectRatio: '1:1', variation: 7 },
    })
  })
})

describe('三視圖', () => {
  const hero = { hash: 'a'.repeat(64), kind: 'image' as const, mime: 'image/png', bytes: 10 }

  it('Prompt 要求正面／側面／背面並排、白底、完全照參考圖，並附上固定外觀描述', () => {
    const prompt = composeTurnaroundPrompt(
      { name: '阿鐵', appearance: '短黑髮', outfit: '工作服', anchor: '短黑髮、左臉小疤' },
      'anime',
    )
    for (const must of ['阿鐵', '正面', '側面', '背面', 'A-pose', '純白背景', '完全一致']) {
      expect(prompt).toContain(must)
    }
    expect(prompt).toContain('外觀：短黑髮、左臉小疤')
    expect(prompt).not.toContain('工作服')
    expect(prompt).toContain(QUICK_STYLES.anime.fragment)
  })

  it('節點輸出 Prompt，並把主圖當成參考圖往下傳', async () => {
    const out = turnaroundPromptNode.run({
      inputs: { subject: { name: '阿鐵', hero } },
      params: { style: 'realistic', ...({} as object) },
    } as never)
    const result = (await out) as { prompt: string; references: unknown[] }
    expect(result.references).toEqual([hero])
    expect(result.prompt).toContain('阿鐵')
  })

  it('工作流：組 Prompt → 圖片編輯（帶參考圖）→ 輸出，帶入模型與變化編號', () => {
    const flow = buildTurnaroundWorkflow({
      model: 'fal/nano-banana-2',
      style: 'anime',
      variation: 5,
    })
    expect(flow.nodes.map((n) => [n.id, n.type])).toEqual([
      ['in', '$input'],
      ['prompt', 'character.turnaroundPrompt'],
      ['sheet', 'image.edit'],
      ['out', '$output'],
    ])
    expect(flow.nodes.find((n) => n.id === 'sheet')).toMatchObject({
      modelId: 'fal/nano-banana-2',
      params: { aspectRatio: '16:9', variation: 5 },
    })
  })
})

describe('場景卡的 Prompt 與工作流', () => {
  it('概念圖：沒有固定描述就用地點說明；有就原封不動用它；都沒有只用名字', () => {
    const fromNote = composeLocationConceptPrompt(
      { name: '舊倉庫', description: '堆滿木箱' },
      'anime',
    )
    expect(fromNote).toContain('舊倉庫：堆滿木箱')
    expect(fromNote).toContain('沒有人物')
    expect(fromNote.endsWith(QUICK_STYLES.anime.fragment)).toBe(true)
    expect(
      composeLocationConceptPrompt(
        { name: '舊倉庫', description: '堆滿木箱', anchor: ' 磚牆、天窗 ' },
        'realistic',
      ),
    ).toContain('舊倉庫：磚牆、天窗')
    expect(composeLocationConceptPrompt({ name: '海邊' }, 'watercolor')).toContain(
      '場景設定圖，海邊。',
    )
  })

  it('另一個角度：兩個角度各自說明方向，並要求和參考圖一致', () => {
    const subject = { name: '舊倉庫', anchor: '磚牆、天窗', description: '' }
    const reverse = composeLocationAnglePrompt({ ...subject, angle: 'reverse' }, 'realistic')
    const wide = composeLocationAnglePrompt({ ...subject, angle: 'wide' }, 'realistic')
    expect(reverse).toContain('相反的方向')
    expect(wide).toContain('拉遠的全景')
    for (const prompt of [reverse, wide]) {
      expect(prompt).toContain('必須和參考圖完全一致')
      expect(prompt).toContain('場景特徵：磚牆、天窗')
    }
  })

  it('概念圖工作流：16:9、帶入模型與變化編號；角度工作流把主圖接到圖片編輯', () => {
    const concept = buildLocationConceptWorkflow({
      model: 'fal/t2i',
      style: 'anime',
      variation: 5,
    })
    expect(concept.nodes.map((n) => n.type)).toEqual([
      '$input',
      'location.conceptPrompt',
      'image.generate',
      '$output',
    ])
    expect(concept.nodes.find((n) => n.id === 'image')).toMatchObject({
      modelId: 'fal/t2i',
      params: { aspectRatio: '16:9', variation: 5 },
    })

    const angle = buildLocationAngleWorkflow({ model: 'fal/edit', style: 'anime', variation: 2 })
    expect(angle.nodes.map((n) => n.type)).toEqual([
      '$input',
      'location.anglePrompt',
      'image.edit',
      '$output',
    ])
    expect(
      angle.edges.find((e) => e.to.nodeId === 'angle' && e.to.port === 'references')?.from,
    ).toEqual({ nodeId: 'prompt', port: 'references' })
  })
})
