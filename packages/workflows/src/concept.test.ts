import { describe, expect, it } from 'vitest'

import {
  buildConceptWorkflow,
  buildLocationAngleWorkflow,
  buildLocationConceptWorkflow,
  buildTurnaroundWorkflow,
} from './concept'
import {
  composeConceptPrompt,
  composeConceptRefPrompt,
  conceptPromptNode,
  conceptRefPromptNode,
  referenceNoteOf,
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

describe('角色提示詞範本', () => {
  const base = { name: '阿鐵', appearance: '短黑髮', outfit: '工作服' }

  it('自訂範本：記號換成角色的內容；沒給範本就是內建預設（輸出和以前一樣）', () => {
    expect(composeConceptPrompt(base, 'anime', '畫{{名稱}}：{{外觀}}（{{畫風}}）')).toBe(
      `畫阿鐵：短黑髮，工作服（${QUICK_STYLES.anime.fragment}）`,
    )
    expect(composeConceptPrompt(base, 'anime')).toBe(
      `角色設定圖，阿鐵：短黑髮，工作服。全身站立，面向前方，表情自然，單色乾淨的背景。${QUICK_STYLES.anime.fragment}`,
    )
  })

  it('節點的 template 參數：空白＝預設，有字就用它；直接呼叫節點沒給參數也不會壞', () => {
    const run = (params: Record<string, unknown>) =>
      conceptPromptNode.run({
        inputs: { subject: base },
        params,
      } as never) as { prompt: string }
    expect(run({ style: 'anime', template: '' }).prompt).toBe(composeConceptPrompt(base, 'anime'))
    expect(run({ style: 'anime' }).prompt).toBe(composeConceptPrompt(base, 'anime'))
    expect(run({ style: 'anime', template: '只有{{名稱}}' }).prompt).toBe('只有阿鐵')
  })

  it('三視圖自訂範本：外觀句沒有外觀描述時是空的', () => {
    expect(composeTurnaroundPrompt({ name: '阿鐵' }, 'anime', '【{{名稱}}】{{外觀句}}')).toBe(
      '【阿鐵】',
    )
  })
})

describe('照參考圖畫的概念圖', () => {
  const ref = { hash: 'b'.repeat(64), kind: 'image' as const, mime: 'image/png', bytes: 10 }
  const base = { name: '小饅頭', anchor: '奶油黃圓頂，沒有嘴' }

  it('Prompt 要求照參考圖、不重新設計，帶固定外觀與畫風', () => {
    const prompt = composeConceptRefPrompt(base, 'painted')
    for (const must of [
      '參考圖',
      '小饅頭',
      '完全一致',
      '不要重新設計',
      '外觀：奶油黃圓頂，沒有嘴。',
    ]) {
      expect(prompt).toContain(must)
    }
    expect(prompt).toContain(QUICK_STYLES.painted.fragment)
  })

  it('節點把參考圖原樣往下傳（圖片編輯一定吃得到）；沒有參考圖就拒絕', () => {
    const out = conceptRefPromptNode.run({
      inputs: { subject: { ...base, references: [ref] } },
      params: { style: 'painted', template: '' },
    } as never) as { prompt: string; references: unknown[] }
    expect(out.references).toEqual([ref])
    expect(out.prompt).toBe(composeConceptRefPrompt(base, 'painted'))
    expect(() =>
      conceptRefPromptNode.run({
        inputs: { subject: { ...base, references: [] } },
        params: { style: 'painted', template: '' },
      } as never),
    ).toThrow()
  })

  it('每張參考圖的用途寫進 Prompt（依序）；全部都是「一般」就不特別說明', () => {
    expect(referenceNoteOf(['臉', '身體'])).toBe('參考圖依序是：第 1 張是臉，第 2 張是身體。')
    expect(referenceNoteOf(['一般'])).toBe('')
    expect(referenceNoteOf(['一般', '一般'])).toBe('')
    expect(referenceNoteOf(['一般', '臉'])).toBe('參考圖依序是：第 1 張是一般，第 2 張是臉。')
    const withPurposes = composeConceptRefPrompt(base, 'painted', undefined, ['臉', '三視圖'])
    expect(withPurposes).toContain('參考圖依序是：第 1 張是臉，第 2 張是三視圖。')
    expect(composeConceptRefPrompt(base, 'painted')).not.toContain('參考圖依序是')
    const out = conceptRefPromptNode.run({
      inputs: { subject: { ...base, references: [ref, ref], referencePurposes: ['臉', '身體'] } },
      params: { style: 'painted', template: '' },
    } as never) as { prompt: string }
    expect(out.prompt).toContain('第 1 張是臉，第 2 張是身體')
  })

  it('工作流：有參考圖 → 組 Prompt（帶參考圖）→ 圖片編輯，參考圖接到編輯節點；沒有就跟以前一樣', () => {
    const withRef = buildConceptWorkflow({
      model: 'fal/edit-model',
      style: 'painted',
      variation: 3,
      withReferences: true,
      template: '我的範本',
    })
    expect(withRef.nodes.map((n) => [n.id, n.type])).toEqual([
      ['in', '$input'],
      ['prompt', 'character.conceptRefPrompt'],
      ['image', 'image.edit'],
      ['out', '$output'],
    ])
    expect(withRef.nodes.find((n) => n.id === 'prompt')?.params).toEqual({
      style: 'painted',
      template: '我的範本',
    })
    expect(
      withRef.edges.some((e) => e.from.port === 'references' && e.to.port === 'references'),
    ).toBe(true)
    const without = buildConceptWorkflow({ model: 'fal/t2i', style: 'painted', variation: 3 })
    expect(without.nodes.find((n) => n.id === 'image')?.type).toBe('image.generate')
    expect(without.nodes.find((n) => n.id === 'prompt')?.params).toEqual({ style: 'painted' })
    expect(without.edges.some((e) => e.to.port === 'references')).toBe(false)
  })
})
