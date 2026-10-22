import {
  AppError,
  CAMERA_MOVES,
  DEFAULT_STORYBOARD_GUIDE,
  type AssetRef,
  type GenerationOutput,
  type GenerationRequest,
  type NodeDefinition,
  type ReportedCost,
  type RunContext,
} from '@svs/schema'
import { describe, expect, it, vi } from 'vitest'

import {
  breakdownNode,
  composeShotPrompts,
  frameFillSuffix,
  withoutFrameFillSuffix,
  ShotItemSchema,
  concatNode,
  dialogueOf,
  imageNode,
  narrationMaxChars,
  pickReferences,
  REFERENCE_PROMPT_SUFFIX,
  shotPromptNode,
  videoNode,
} from './nodes'
import {
  buildQuickStart,
  buildShotWorkflow,
  quickStartItemCounts,
  QUICK_START_IDS,
} from './quickstart'
import { STUDIO_SERVICE_KEY, type GenerateResult, type StudioServices } from './services'
import { extractJson, generateStructured } from './structured'
import { QUICK_STYLES, QUICK_STYLE_IDS } from './styles'

const HASH = (c: string): string => c.repeat(64)
const image: AssetRef = { hash: HASH('a'), kind: 'image', mime: 'image/png', bytes: 10 }
const video: AssetRef = {
  hash: HASH('b'),
  kind: 'video',
  mime: 'video/mp4',
  bytes: 20,
  durationSec: 3,
}

const text = (t: string, costUsd?: number): GenerateResult => ({
  output: { kind: 'text', text: t },
  provider: 'openrouter',
  jobId: 'job',
  ...(costUsd === undefined ? {} : { costUsd }),
})
const assets = (asset: AssetRef, costUsd?: number): GenerateResult => ({
  output: { kind: 'assets', assets: [asset] },
  provider: 'fal',
  jobId: 'job',
  ...(costUsd === undefined ? {} : { costUsd }),
})

function fakeStudio(replies: (GenerateResult | Error)[]) {
  const requests: GenerationRequest[] = []
  const studio: StudioServices = {
    generate: (request) => {
      requests.push(request)
      const next = replies.shift()
      if (next === undefined) return Promise.reject(new Error('沒有預備的回應'))
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
    concatVideos: vi.fn((videos: readonly AssetRef[]) =>
      Promise.resolve({ ...video, durationSec: videos.length * 3 }),
    ),
  }
  return { studio, requests }
}

/** 直接呼叫節點的 run（不經過引擎）。 */
async function runNode(
  def: NodeDefinition,
  args: {
    params?: unknown
    inputs?: Record<string, unknown>
    modelId?: string
    studio?: StudioServices
  },
): Promise<{ out: Record<string, unknown>; costs: ReportedCost[] }> {
  const costs: ReportedCost[] = []
  const ctx: RunContext = {
    params: def.params.parse(args.params ?? {}),
    inputs: args.inputs ?? {},
    runInputs: {},
    modelId: args.modelId,
    signal: new AbortController().signal,
    nodeRunId: 'node-run-test',
    services: args.studio ? { [STUDIO_SERVICE_KEY]: args.studio } : {},
    reportCost: (c) => costs.push(c),
    runSub: () => Promise.reject(new Error('不應呼叫')),
  }
  return { out: await def.run(ctx), costs }
}

const llmShots = (n: number) => ({
  title: '雨天的貓',
  shots: Array.from({ length: n }, (_, i) => ({
    description: `第${String(i + 1)}個畫面：一隻貓在雨中`,
    size: 'wide',
    cameraMove: i === 0 ? 'push_in' : null,
    characters: ['小花'],
    mood: '安靜',
  })),
})

describe('extractJson / generateStructured', () => {
  it('extractJson 接受純 JSON 與 ```json 區塊', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('好的：\n```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(() => extractJson('不是 JSON')).toThrow()
  })

  it('第一次格式不對 → 附上錯誤再問一次；兩次花費加總', async () => {
    const { studio, requests } = fakeStudio([
      text('{"title":1}', 0.01),
      text('```json\n{"title":"好"}\n```', 0.02),
    ])
    const { z } = await import('zod')
    const result = await generateStructured(
      studio,
      { modelId: 'm', messages: [{ role: 'user', content: 'hi' }] },
      z.object({ title: z.string() }),
      { signal: new AbortController().signal },
    )
    expect(result.data).toEqual({ title: '好' })
    expect(result.costUsd).toBeCloseTo(0.03)
    expect(requests).toHaveLength(2)
    const retry = requests[1]
    expect(retry?.capability === 'llm' && retry.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(retry?.capability === 'llm' && retry.messages[2]?.content).toContain('title')
    expect(requests[0]).toMatchObject({ capability: 'llm', jsonSchema: { type: 'object' } })
  })

  it('連續兩次都不對 → 可再試的 invalid_response；不是 JSON 也一樣處理；回傳檔案算錯', async () => {
    const { z } = await import('zod')
    const schema = z.object({ title: z.string() })
    const ctx = { signal: new AbortController().signal }
    const base = { modelId: 'm', messages: [{ role: 'user' as const, content: 'hi' }] }

    const bad = fakeStudio([text('亂寫'), text('還是亂寫')])
    await expect(generateStructured(bad.studio, base, schema, ctx)).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
    expect(bad.requests).toHaveLength(2)

    const wrongKind = fakeStudio([assets(image)])
    await expect(generateStructured(wrongKind.studio, base, schema, ctx)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
})

describe('節點：拆鏡', () => {
  const params = { story: '一隻貓在雨天找家', shotCount: 3, style: 'anime', durationSec: 4 }

  it('依鏡頭數截斷、補上鏡號與時長，並回報實際花費', async () => {
    const { studio, requests } = fakeStudio([text(JSON.stringify(llmShots(5)), 0.004)])
    const { out, costs } = await runNode(breakdownNode, {
      params,
      modelId: 'openrouter/claude-sonnet-5.5',
      studio,
    })
    expect(out.title).toBe('雨天的貓')
    const shots = out.shots as { number: number; durationSec: number; cameraMove: string | null }[]
    expect(shots.map((s) => s.number)).toEqual([1, 2, 3])
    expect(shots.every((s) => s.durationSec === 4)).toBe(true)
    expect(shots[0]?.cameraMove).toBe('push_in')
    expect(costs).toEqual([
      {
        provider: 'openrouter',
        modelId: 'openrouter/claude-sonnet-5.5',
        amountUsd: 0.004,
        jobId: 'job',
      },
    ])
    expect(requests[0]).toMatchObject({
      capability: 'llm',
      modelId: 'openrouter/claude-sonnet-5.5',
    })
  })

  it('勾了旁白：要求每鏡一句短台詞（長度配合秒數），輸出帶 dialogue 並照上限截短；沒勾就說不要寫對白、也不帶台詞', async () => {
    const lines = llmShots(3)
    const long = '這是一句寫得太長太長太長太長太長太長太長念不完的旁白台詞'
    const withNarration = fakeStudio([
      text(
        JSON.stringify({
          ...lines,
          shots: lines.shots.map((s, i) => ({
            ...s,
            dialogue: i === 0 ? long : `旁白 ${String(i)}`,
          })),
        }),
      ),
    ])
    const { out } = await runNode(breakdownNode, {
      params: { ...params, narration: true },
      modelId: 'm',
      studio: withNarration.studio,
    })
    const system = (withNarration.requests[0] as { system?: string }).system ?? ''
    expect(system).toContain('dialogue')
    expect(system).toContain('最多 16 個字')
    expect(system).toContain('每個鏡頭都要有 dialogue')
    const shots = out.shots as { dialogue?: string }[]
    // 超過上限又沒有句讀可以切：整句保留（聲音的「旁白太長」警告會提醒）
    expect(shots[0]?.dialogue).toBe(long)
    expect(shots[1]?.dialogue).toBe('旁白 1')

    const plain = fakeStudio([text(JSON.stringify(llmShots(3)))])
    const { out: none } = await runNode(breakdownNode, {
      params,
      modelId: 'm',
      studio: plain.studio,
    })
    expect((plain.requests[0] as { system?: string }).system).toContain('不要寫對白')
    expect((none.shots as { dialogue?: string }[]).every((s) => s.dialogue === undefined)).toBe(
      true,
    )
  })

  it('勾了旁白但模型沒給台詞：附上錯誤再問一次（台詞是必填）', async () => {
    const { studio, requests } = fakeStudio([
      text(JSON.stringify(llmShots(3))),
      text(
        JSON.stringify({
          ...llmShots(3),
          shots: llmShots(3).shots.map((s) => ({ ...s, dialogue: '一句旁白' })),
        }),
      ),
    ])
    const { out } = await runNode(breakdownNode, {
      params: { ...params, narration: true },
      modelId: 'm',
      studio,
    })
    expect(requests).toHaveLength(2)
    expect((out.shots as { dialogue?: string }[]).map((s) => s.dialogue)).toEqual([
      '一句旁白',
      '一句旁白',
      '一句旁白',
    ])
  })

  it('已經建好的角色名字會告訴模型，故事裡出現時要用一模一樣的名字', async () => {
    const { studio, requests } = fakeStudio([text(JSON.stringify(llmShots(3)))])
    await runNode(breakdownNode, {
      params: { ...params, knownCharacters: ['阿鐵', '小雨'] },
      modelId: 'm',
      studio,
    })
    const system = (requests[0] as { system?: string }).system ?? ''
    expect(system).toContain('阿鐵、小雨')
    const { requests: none } = await (async () => {
      const f = fakeStudio([text(JSON.stringify(llmShots(3)))])
      await runNode(breakdownNode, { params, modelId: 'm', studio: f.studio })
      return f
    })()
    expect((none[0] as { system?: string }).system).not.toContain('已經建好的角色')
  })

  it('分鏡準則會接在提示後面；沒有準則就不附', async () => {
    const withGuide = fakeStudio([text(JSON.stringify(llmShots(3)))])
    await runNode(breakdownNode, {
      params: { ...params, guide: '一個鏡頭只做一件事。' },
      modelId: 'm',
      studio: withGuide.studio,
    })
    const system = (withGuide.requests[0] as { system?: string }).system ?? ''
    expect(system).toContain('分鏡準則')
    expect(system.endsWith('一個鏡頭只做一件事。')).toBe(true)
    expect(system).toContain('只輸出 JSON')

    const without = fakeStudio([text(JSON.stringify(llmShots(3)))])
    await runNode(breakdownNode, { params, modelId: 'm', studio: without.studio })
    expect((without.requests[0] as { system?: string }).system).not.toContain('分鏡準則')
  })

  it('請模型從運鏡預設清單裡選；選了清單外的（自己編的）就附上錯誤再問一次', async () => {
    const wrong = llmShots(3)
    wrong.shots[0] = { ...wrong.shots[0], cameraMove: '慢慢推近' } as (typeof wrong.shots)[number]
    const { studio, requests } = fakeStudio([
      text(JSON.stringify(wrong)),
      text(JSON.stringify(llmShots(3))),
    ])
    const { out } = await runNode(breakdownNode, { params, modelId: 'm', studio })
    expect(requests).toHaveLength(2)
    const system = (requests[0] as { system?: string }).system ?? ''
    for (const move of CAMERA_MOVES) expect(system).toContain(`${move.id}（${move.label}）`)
    expect((out.shots as { cameraMove: string | null }[])[0]?.cameraMove).toBe('push_in')
  })

  it('鏡頭比要求的少也接受；供應商沒回報花費時不入帳（交給引擎估算）', async () => {
    const { studio } = fakeStudio([text(JSON.stringify(llmShots(2)))])
    const { out, costs } = await runNode(breakdownNode, { params, modelId: 'm', studio })
    expect((out.shots as unknown[]).length).toBe(2)
    expect(costs).toEqual([])
  })

  it('沒選模型時要求使用者先選；故事是空的也被擋下', async () => {
    const { studio } = fakeStudio([])
    await expect(runNode(breakdownNode, { params, studio })).rejects.toThrow(/還沒有選文字模型/)
    expect(() => breakdownNode.params.parse({ story: '' })).toThrow(/請先寫下你的故事/)
  })

  it('預設分鏡準則（含鏡頭語言那一條）整份算進預估：每個字 1.5 個 token 的輸入', () => {
    const estimate = vi.fn(() => 0.05)
    const run = (guide: string): void => {
      breakdownNode.estimateCost?.({
        params: breakdownNode.params.parse({ ...params, guide }),
        inputs: {},
        modelId: 'm',
        estimate,
      })
    }
    run('')
    run(DEFAULT_STORYBOARD_GUIDE)
    const [[, without], [, withGuide]] = estimate.mock.calls as unknown as [
      [string, { inputTokens: number }],
      [string, { inputTokens: number }],
    ]
    expect(withGuide.inputTokens - without.inputTokens).toBe(
      Math.ceil((params.story.length + DEFAULT_STORYBOARD_GUIDE.length) * 1.5) -
        Math.ceil(params.story.length * 1.5),
    )
    expect(DEFAULT_STORYBOARD_GUIDE).toContain('size、angle、cameraMove')
  })

  it('預估花費依故事長度與鏡頭數呼叫價格查詢', () => {
    const estimate = vi.fn(() => 0.05)
    const cost = breakdownNode.estimateCost?.({
      params: breakdownNode.params.parse(params),
      inputs: {},
      modelId: 'm',
      estimate,
    })
    expect(cost).toBe(0.05)
    expect(estimate).toHaveBeenCalledWith('m', { inputTokens: 512, outputTokens: 500 })
    expect(() =>
      breakdownNode.estimateCost?.({
        params: breakdownNode.params.parse(params),
        inputs: {},
        modelId: undefined,
        estimate,
      }),
    ).toThrow(/文字模型/)
  })
})

const shotWorkflowOptions = {
  style: 'anime' as const,
  durationSec: 3,
  aspectRatio: '16:9' as const,
  models: { image: 'fal/nano-banana-2', video: 'fal/kling-3.0-standard' },
  now: '2026-10-12T08:00:00.000Z',
}

describe('節點：組 Prompt', () => {
  const shot = {
    number: 1,
    description: '貓跳上窗台',
    size: 'medium',
    cameraMove: 'push_in',
    durationSec: 3,
    characters: ['小花'],
    mood: '安靜',
  }

  it('把描述、出場角色、氣氛、運鏡與畫風組成圖片與影片的 Prompt', async () => {
    const { out } = await runNode(shotPromptNode, {
      params: { style: 'watercolor' },
      inputs: { shot },
    })
    const expected = `貓跳上窗台（出場：小花），氣氛安靜。${QUICK_STYLES.watercolor.fragment}`
    expect(out.imagePrompt).toBe(expected)
    // 運鏡不寫進 Prompt，單獨輸出（送出影片請求時才依模型決定怎麼用）
    expect(out.videoPrompt).toBe(expected)
    expect(out.cameraMove).toBe('push_in')
  })

  it('手繪電影畫風：Prompt 結尾是手繪那段，不再接寫實的 photorealistic', async () => {
    const { out } = await runNode(shotPromptNode, {
      params: { style: 'painted' },
      inputs: { shot },
    })
    const prompt = String(out.imagePrompt)
    expect(prompt.endsWith(QUICK_STYLES.painted.fragment)).toBe(true)
    expect(prompt).toContain('hand-painted cinematic')
    expect(prompt).not.toContain('photorealistic')
    expect(out.videoPrompt).toBe(prompt)
  })

  it('沒有角色、氣氛、運鏡時不會多出空白的片段', async () => {
    const { out } = await runNode(shotPromptNode, {
      inputs: { shot: { ...shot, characters: [], mood: '', cameraMove: null } },
    })
    expect(out.imagePrompt).toBe(`貓跳上窗台。${QUICK_STYLES.realistic.fragment}`)
    expect(out.videoPrompt).toBe(out.imagePrompt)
    expect(out.cameraMove).toBe('')
  })

  it('使用者手動改過 Prompt 時直接用它，圖片與影片都一樣', async () => {
    const { out } = await runNode(shotPromptNode, {
      inputs: { shot: { ...shot, promptOverride: 'a cat leaps onto the windowsill' } },
    })
    expect(out).toEqual({
      imagePrompt: 'a cat leaps onto the windowsill',
      videoPrompt: 'a cat leaps onto the windowsill',
      // 手動改過 Prompt，運鏡一樣有效
      cameraMove: 'push_in',
      references: [],
    })
  })

  it('composeShotPrompts 與節點輸出一致（畫面上顯示的就是實際送出的內容）', async () => {
    const parsed = ShotItemSchema.parse(shot)
    const { out } = await runNode(shotPromptNode, { params: { style: 'anime' }, inputs: { shot } })
    expect(composeShotPrompts(parsed, 'anime')).toEqual({
      imagePrompt: out.imagePrompt,
      videoPrompt: out.videoPrompt,
    })
  })

  describe('固定外觀描述（錨點）', () => {
    const anchors = [
      { name: '小花', text: '白色短毛、左耳有缺角、藍色項圈' },
      { name: '阿鐵', text: '短黑髮、琥珀色眼睛' },
    ]

    it('出場的角色有鎖定描述 → 原文一字不差地出現在圖片與影片 Prompt', async () => {
      const { out } = await runNode(shotPromptNode, { params: { anchors }, inputs: { shot } })
      for (const prompt of [out.imagePrompt, out.videoPrompt]) {
        expect(prompt).toContain('白色短毛、左耳有缺角、藍色項圈')
        // 沒出場的角色不會被帶進來
        expect(prompt).not.toContain('琥珀色眼睛')
      }
    })

    it('多個角色都出場：每個人的描述都帶入，順序依出場順序', async () => {
      const both = { ...shot, characters: ['阿鐵', '小花'] }
      const { out } = await runNode(shotPromptNode, { params: { anchors }, inputs: { shot: both } })
      const prompt = String(out.imagePrompt)
      expect(prompt).toContain('阿鐵：短黑髮、琥珀色眼睛')
      expect(prompt).toContain('小花：白色短毛、左耳有缺角、藍色項圈')
    })

    it('沒有鎖定描述、或名字對不上 → 跟以前完全一樣', async () => {
      const plain = await runNode(shotPromptNode, { inputs: { shot } })
      const other = await runNode(shotPromptNode, {
        params: { anchors: [{ name: '路人', text: '戴帽子' }] },
        inputs: { shot },
      })
      expect(other.out).toEqual(plain.out)
    })

    it('錨點內容改了 → 節點的輸入（參數）就不同，快取會失效', () => {
      const a = buildShotWorkflow({ ...shotWorkflowOptions, anchors })
      const b = buildShotWorkflow({
        ...shotWorkflowOptions,
        anchors: [{ name: '小花', text: '黑色短毛' }],
      })
      const paramsOf = (flow: typeof a): unknown =>
        flow.nodes.find((n) => n.id === 'prompt')?.params
      expect(paramsOf(a)).not.toEqual(paramsOf(b))
    })

    it('手動改過 Prompt 時以使用者寫的為準', async () => {
      const { out } = await runNode(shotPromptNode, {
        params: { anchors },
        inputs: { shot: { ...shot, promptOverride: 'my prompt' } },
      })
      expect(out.imagePrompt).toBe('my prompt')
    })

    it('composeShotPrompts 帶錨點時也跟節點輸出一致', async () => {
      const parsed = ShotItemSchema.parse(shot)
      const { out } = await runNode(shotPromptNode, { params: { anchors }, inputs: { shot } })
      expect(composeShotPrompts(parsed, 'realistic', anchors).imagePrompt).toBe(out.imagePrompt)
    })
  })

  it('輸入格式不對時丟錯（不會悄悄產出怪 Prompt）', async () => {
    await expect(
      runNode(shotPromptNode, { inputs: { shot: { description: '' } } }),
    ).rejects.toThrow()
  })

  it('每種畫風都有白話名稱與描述', () => {
    for (const id of QUICK_STYLE_IDS) {
      expect(QUICK_STYLES[id].label.length).toBeGreaterThan(0)
      expect(QUICK_STYLES[id].fragment.length).toBeGreaterThan(5)
    }
  })
})

describe('節點：首幀圖、圖生影片、接片', () => {
  it('首幀圖：送出文生圖請求，回傳圖片並入帳', async () => {
    const { studio, requests } = fakeStudio([assets(image, 0.08)])
    const { out, costs } = await runNode(imageNode, {
      params: { aspectRatio: '9:16', variation: 2 },
      inputs: { prompt: '一隻貓' },
      modelId: 'fal/nano-banana-2',
      studio,
    })
    expect(out.image).toEqual(image)
    expect(requests[0]).toMatchObject({
      capability: 't2i',
      prompt: `一隻貓${frameFillSuffix('9:16')}`,
      aspectRatio: '9:16',
      seed: 2,
      count: 1,
    })
    expect(costs[0]).toMatchObject({ provider: 'fal', amountUsd: 0.08 })
  })

  it('首幀圖的 Prompt 後面補「滿版、單一連續畫面」：不是拼貼、分格、上下兩格，上下沒有黑色橫條；比例照節點的設定', () => {
    const suffix = frameFillSuffix('16:9')
    expect(suffix).toContain('16:9 滿版畫面')
    expect(suffix).toContain('單一連續畫面，不是拼貼、分格或上下兩格')
    expect(suffix).toContain('上下沒有黑色橫條')
    expect(frameFillSuffix('9:16')).toContain('9:16 滿版畫面')
  })

  it('withoutFrameFillSuffix：把補上的滿版描述拿掉（每種比例都認得）；沒有就原樣', () => {
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '21:9']) {
      expect(withoutFrameFillSuffix(`一隻貓${frameFillSuffix(ratio)}`)).toBe('一隻貓')
    }
    expect(withoutFrameFillSuffix('一隻貓')).toBe('一隻貓')
    // 圖片編輯：參考圖提醒在滿版描述前面，兩段都要能拿掉（由 records-service 的 cleanPrompt 依序處理）
    const edit = `阿鐵走路${REFERENCE_PROMPT_SUFFIX}${frameFillSuffix('16:9')}`
    expect(withoutFrameFillSuffix(edit)).toBe(`阿鐵走路${REFERENCE_PROMPT_SUFFIX}`)
  })

  it('首幀圖的請求帶 trimLetterbox：存進素材庫之前由任務佇列自動裁掉模型畫的黑邊（節點不用管）', async () => {
    const { studio, requests } = fakeStudio([assets(image, 0.08)])
    const { out } = await runNode(imageNode, {
      params: { aspectRatio: '21:9' },
      inputs: { prompt: '一隻貓' },
      modelId: 'm',
      studio,
    })
    expect(requests[0]).toMatchObject({
      capability: 't2i',
      aspectRatio: '21:9',
      trimLetterbox: true,
    })
    expect(out.image).toEqual(image)
  })

  it('圖生影片：有運鏡就帶進請求，空字串或沒給就不帶', async () => {
    const run = async (inputs: Record<string, unknown>) => {
      const { studio, requests } = fakeStudio([assets(video)])
      await runNode(videoNode, { params: {}, inputs, modelId: 'm', studio })
      return requests[0] as { cameraMove?: string }
    }
    expect((await run({ image, prompt: 'p', cameraMove: 'orbit' })).cameraMove).toBe('orbit')
    expect(await run({ image, prompt: 'p', cameraMove: '' })).not.toHaveProperty('cameraMove')
    expect(await run({ image, prompt: 'p' })).not.toHaveProperty('cameraMove')
  })

  it('圖生影片：用上一步的圖當首幀；回傳的不是影片時回報錯誤', async () => {
    const { studio, requests } = fakeStudio([assets(video), assets(image)])
    const params = { durationSec: 5, audio: true }
    const ok = await runNode(videoNode, {
      params,
      inputs: { image, prompt: '貓在走' },
      modelId: 'fal/kling-3.0-pro',
      studio,
    })
    expect(ok.out.video).toEqual(video)
    expect(ok.costs).toEqual([])
    expect(requests[0]).toMatchObject({
      capability: 'i2v',
      startFrameAsset: image.hash,
      durationSec: 5,
      audio: true,
    })
    await expect(
      runNode(videoNode, { params, inputs: { image, prompt: 'x' }, modelId: 'm', studio }),
    ).rejects.toThrow(/不是影片/)
  })

  it('圖片與影片節點的預估：一張圖、N 秒；沒選模型會被標為無法預估', () => {
    const estimate = vi.fn(() => 0.1)
    imageNode.estimateCost?.({
      params: imageNode.params.parse({}),
      inputs: {},
      modelId: 'i',
      estimate,
    })
    expect(estimate).toHaveBeenLastCalledWith('i', { images: 1 })
    videoNode.estimateCost?.({
      params: videoNode.params.parse({ durationSec: 4 }),
      inputs: {},
      modelId: 'v',
      estimate,
    })
    expect(estimate).toHaveBeenLastCalledWith('v', { seconds: 4, audio: false })
    expect(() =>
      videoNode.estimateCost?.({
        params: videoNode.params.parse({}),
        inputs: {},
        modelId: undefined,
        estimate,
      }),
    ).toThrow(/影片模型/)
  })

  it('接片：把全部片段交給接片服務', async () => {
    const { studio } = fakeStudio([])
    const { out } = await runNode(concatNode, { inputs: { videos: [video, video, video] }, studio })
    expect((out.video as AssetRef).durationSec).toBe(9)
    await expect(runNode(concatNode, { inputs: { videos: [] }, studio })).rejects.toThrow(
      /沒有可以接起來/,
    )
    await expect(
      runNode(concatNode, { inputs: { videos: [{ oops: 1 }] }, studio }),
    ).rejects.toThrow(AppError)
  })

  it('沒有生成服務時說明原因', async () => {
    await expect(runNode(imageNode, { inputs: { prompt: 'x' }, modelId: 'm' })).rejects.toThrow(
      /生成服務/,
    )
  })

  it('輸出型別宣告', () => {
    const out: GenerationOutput = { kind: 'assets', assets: [image] }
    expect(out.kind).toBe('assets')
  })
})

describe('快速開始模板', () => {
  const options = {
    story: '一隻貓在雨天找家',
    style: 'anime' as const,
    shotCount: 4,
    durationSec: 3,
    aspectRatio: '16:9' as const,
    models: {
      llm: 'openrouter/claude-sonnet-5.5',
      image: 'fal/nano-banana-2',
      video: 'fal/kling-3.0-standard',
    },
    now: '2026-10-12T08:00:00.000Z',
  }

  it('只寫分鏡（storyboardOnly）：只有拆鏡這一個節點，沒有圖片、影片、接片，預估的鏡頭數也不用給', () => {
    const flow = buildQuickStart({ ...options, storyboardOnly: true })
    expect(flow.nodes.map((n) => [n.id, n.type])).toEqual([['breakdown', 'story.breakdown']])
    expect(flow.edges).toEqual([])
    expect(quickStartItemCounts({ shotCount: 5, storyboardOnly: true })).toEqual({})
    expect(quickStartItemCounts({ shotCount: 5 })).toEqual({ each: 5 })
  })

  it('產出一般的 Workflow：拆鏡 → 對每鏡執行 → 接片，模型與畫風帶到各節點', () => {
    const flow = buildQuickStart(options)
    expect(flow.nodes.map((n) => [n.id, n.type, n.modelId])).toEqual([
      ['breakdown', 'story.breakdown', 'openrouter/claude-sonnet-5.5'],
      ['each', 'forEach', undefined],
      ['join', 'video.concat', undefined],
    ])
    expect(
      flow.edges.map((e) => `${e.from.nodeId}.${e.from.port}>${e.to.nodeId}.${e.to.port}`),
    ).toEqual(['breakdown.shots>each.items', 'each.results>join.videos'])
    const each = flow.nodes.find((n) => n.id === QUICK_START_IDS.each)
    const body = (each?.params as { body: typeof flow }).body
    expect(body.nodes.map((n) => [n.id, n.type, n.modelId])).toEqual([
      ['in', '$input', undefined],
      ['prompt', 'shot.prompt', undefined],
      ['image', 'image.generate', 'fal/nano-banana-2'],
      ['video', 'video.generate', 'fal/kling-3.0-standard'],
      ['out', '$output', undefined],
    ])
    expect(body.nodes[1]?.params).toMatchObject({ style: 'anime' })
    expect(flow.nodes[0]?.params).toMatchObject({
      story: options.story,
      shotCount: 4,
      style: 'anime',
    })
  })

  it('單鏡頭子流程可以分別換首幀與影片的變化編號', () => {
    const flow = buildShotWorkflow({
      style: 'anime',
      durationSec: 5,
      aspectRatio: '9:16',
      models: { image: 'fal/nano-banana-2', video: 'fal/kling-3.0-standard' },
      imageVariation: 2,
      videoVariation: 5,
      now: options.now,
    })
    expect(flow.id).toBe('quickstart-shot')
    expect(flow.nodes[2]?.params).toMatchObject({ variation: 2, aspectRatio: '9:16' })
    expect(flow.nodes[3]?.params).toMatchObject({ variation: 5, durationSec: 5, audio: false })
    // 沒指定就是 0；快速開始的子流程跟它是同一份定義
    const plain = buildShotWorkflow({ ...options, models: options.models })
    expect(plain.nodes[2]?.params).toMatchObject({ variation: 0 })
    const body = (buildQuickStart(options).nodes[1]?.params as { body: typeof plain }).body
    expect(body).toEqual(plain)
  })

  it('換一批（variation）會改到拆鏡、首幀、影片的參數；項目數供預估使用', () => {
    const flow = buildQuickStart({ ...options, variation: 3, audio: true })
    expect(flow.nodes[0]?.params).toMatchObject({ variation: 3 })
    const body = (flow.nodes[1]?.params as { body: typeof flow }).body
    expect(body.nodes[2]?.params).toMatchObject({ variation: 3 })
    expect(body.nodes[3]?.params).toMatchObject({ variation: 3, audio: true })
    expect(quickStartItemCounts(options)).toEqual({ each: 4 })
    expect(buildQuickStart(options).id).toBe('quickstart')
  })
})

describe('自動挑參考圖', () => {
  const ref = (c: string): AssetRef => ({ ...image, hash: HASH(c) })
  const images = { hero: ref('c'), front: ref('d'), side: ref('e'), back: ref('f') }
  const tie = { name: '阿鐵', text: '短黑髮', images }
  const base = { size: 'medium', angle: 'eye_level', characters: ['阿鐵'] } as const
  const hashes = (refs: AssetRef[]): string[] => refs.map((r) => r.hash[0] ?? '')

  it('一般鏡頭：主圖＋正面；近景與特寫：只用主圖', () => {
    expect(hashes(pickReferences(base, [tie], 4))).toEqual(['c', 'd'])
    expect(hashes(pickReferences({ ...base, size: 'close_up' }, [tie], 4))).toEqual(['c'])
    expect(hashes(pickReferences({ ...base, size: 'extreme_close_up' }, [tie], 4))).toEqual(['c'])
  })

  it('側面鏡頭用側視圖、背影鏡頭用背視圖（優先於景別）', () => {
    expect(hashes(pickReferences({ ...base, angle: 'side' }, [tie], 4))).toEqual(['e'])
    expect(hashes(pickReferences({ ...base, angle: 'back', size: 'close_up' }, [tie], 4))).toEqual([
      'f',
    ])
  })

  it('缺的圖用主圖頂替；只有三視圖沒有主圖也能挑', () => {
    const noSide = { ...tie, images: { hero: images.hero } }
    expect(hashes(pickReferences({ ...base, angle: 'side' }, [noSide], 4))).toEqual(['c'])
    const onlyFront = { ...tie, images: { front: images.front } }
    expect(hashes(pickReferences(base, [onlyFront], 4))).toEqual(['d'])
  })

  it('不超過上限；多個角色時每個人先各拿一張', () => {
    const small = { name: '小花', text: '白貓', images: { hero: ref('1'), front: ref('2') } }
    const two = { ...base, characters: ['阿鐵', '小花'] }
    expect(hashes(pickReferences(two, [tie, small], 4))).toEqual(['c', '1', 'd', '2'])
    expect(hashes(pickReferences(two, [tie, small], 2))).toEqual(['c', '1'])
    expect(pickReferences(base, [tie], 0)).toEqual([])
  })

  it('沒出場、沒有參考圖的角色不會被挑到', () => {
    expect(pickReferences({ ...base, characters: [] }, [tie], 4)).toEqual([])
    expect(pickReferences(base, [{ name: '阿鐵', text: '短黑髮' }], 4)).toEqual([])
    expect(pickReferences(base, [{ ...tie, name: '別人' }], 4)).toEqual([])
  })

  it('組 Prompt 節點輸出挑好的參考圖，數量受 referenceLimit 限制', async () => {
    const shot = { number: 1, description: '走路', characters: ['阿鐵'], durationSec: 3 }
    const { out } = await runNode(shotPromptNode, {
      params: { anchors: [tie], referenceLimit: 1 },
      inputs: { shot },
    })
    expect(hashes(out.references as AssetRef[])).toEqual(['c'])
  })

  it('首幀圖：有參考圖又設了編輯模型 → 送出帶參考圖的編輯請求；其他情況純文字生圖', async () => {
    const { studio, requests } = fakeStudio([assets(image, 0.1), assets(image, 0.1)])
    const edited = await runNode(imageNode, {
      params: { editModel: 'fal/edit' },
      inputs: { prompt: '阿鐵走路', references: [ref('c'), ref('d')] },
      modelId: 'fal/t2i',
      studio,
    })
    expect(requests[0]).toMatchObject({
      capability: 'edit',
      modelId: 'fal/edit',
      prompt: `阿鐵走路${REFERENCE_PROMPT_SUFFIX}${frameFillSuffix('16:9')}`,
      referenceAssets: [HASH('c'), HASH('d')],
    })
    expect(edited.costs[0]).toMatchObject({ modelId: 'fal/edit' })

    // 沒有參考圖（這一鏡沒有角色出場）→ 一般生圖，用原本的模型
    await runNode(imageNode, {
      params: { editModel: 'fal/edit' },
      inputs: { prompt: '空鏡頭', references: [] },
      modelId: 'fal/t2i',
      studio,
    })
    expect(requests[1]).toMatchObject({
      capability: 't2i',
      modelId: 'fal/t2i',
      prompt: `空鏡頭${frameFillSuffix('16:9')}`,
    })
    expect(requests[1]).toMatchObject({ referenceAssets: [] })
  })

  it('單鏡頭工作流：有編輯模型才會把參考圖接到首幀圖節點', () => {
    const plain = buildShotWorkflow({
      style: 'realistic',
      durationSec: 3,
      aspectRatio: '16:9',
      models: { image: 'fal/t2i', video: 'fal/i2v' },
    })
    expect(plain.edges.some((e) => e.to.port === 'references')).toBe(false)

    const withRefs = buildShotWorkflow({
      style: 'realistic',
      durationSec: 3,
      aspectRatio: '16:9',
      models: { image: 'fal/t2i', video: 'fal/i2v' },
      anchors: [tie],
      editModel: { id: 'fal/edit', referenceLimit: 3 },
    })
    expect(
      withRefs.edges.find((e) => e.to.nodeId === 'image' && e.to.port === 'references')?.from,
    ).toEqual({ nodeId: 'prompt', port: 'references' })
    expect(withRefs.nodes.find((n) => n.id === 'image')?.params).toMatchObject({
      editModel: 'fal/edit',
    })
    expect(withRefs.nodes.find((n) => n.id === 'prompt')?.params).toMatchObject({
      referenceLimit: 3,
    })
  })
})

describe('場景卡：Prompt 與參考圖', () => {
  const ref = (c: string): AssetRef => ({ ...image, hash: HASH(c) })
  const hashes = (refs: AssetRef[]): string[] => refs.map((r) => r.hash[0] ?? '')
  const warehouse = {
    id: 'loc1',
    name: '舊倉庫',
    text: '潮濕的磚牆倉庫，天窗透進冷光',
    images: { main: ref('1'), reverse: ref('2'), wide: ref('3') },
  }
  const tie = {
    name: '阿鐵',
    text: '短黑髮',
    images: { hero: ref('c'), front: ref('d'), side: ref('e'), back: ref('f') },
  }
  const shot = {
    size: 'medium',
    angle: 'eye_level',
    characters: [] as string[],
    locationId: 'loc1',
  } as const

  it('鏡頭指定的地點有場景卡 → 場景描述原封不動帶進 Prompt；地點不同或沒指定就不帶', () => {
    const item = ShotItemSchema.parse({
      number: 1,
      description: '阿鐵推開門',
      durationSec: 3,
      locationId: 'loc1',
    })
    const prompts = composeShotPrompts(item, 'realistic', [], [warehouse])
    expect(prompts.imagePrompt).toContain('場景（舊倉庫）——潮濕的磚牆倉庫，天窗透進冷光')
    expect(prompts.videoPrompt).toBe(prompts.imagePrompt)
    expect(
      composeShotPrompts({ ...item, locationId: 'other' }, 'realistic', [], [warehouse])
        .imagePrompt,
    ).not.toContain('舊倉庫')
    expect(
      composeShotPrompts({ ...item, locationId: undefined }, 'realistic', [], [warehouse])
        .imagePrompt,
    ).not.toContain('舊倉庫')
  })

  it('依景別與角度挑場景參考圖：遠景→全景、背面或過肩→反方向、其他→主圖；缺的用主圖頂替', () => {
    expect(hashes(pickReferences(shot, [], 4, [warehouse]))).toEqual(['1'])
    expect(hashes(pickReferences({ ...shot, size: 'wide' }, [], 4, [warehouse]))).toEqual(['3'])
    expect(hashes(pickReferences({ ...shot, size: 'extreme_wide' }, [], 4, [warehouse]))).toEqual([
      '3',
    ])
    expect(hashes(pickReferences({ ...shot, angle: 'back' }, [], 4, [warehouse]))).toEqual(['2'])
    expect(hashes(pickReferences({ ...shot, angle: 'over_shoulder' }, [], 4, [warehouse]))).toEqual(
      ['2'],
    )
    const onlyMain = { ...warehouse, images: { main: ref('1') } }
    expect(hashes(pickReferences({ ...shot, size: 'wide' }, [], 4, [onlyMain]))).toEqual(['1'])
    // 地點不同、沒有圖：什麼都不挑
    expect(pickReferences({ ...shot, locationId: 'other' }, [], 4, [warehouse])).toEqual([])
    expect(pickReferences(shot, [], 4, [{ ...warehouse, images: undefined }])).toEqual([])
  })

  it('和角色參考圖一起挑：場景占一張，其餘給角色；只剩一張名額時留給角色', () => {
    const withTie = { ...shot, characters: ['阿鐵'] }
    expect(hashes(pickReferences(withTie, [tie], 4, [warehouse]))).toEqual(['c', 'd', '1'])
    expect(hashes(pickReferences(withTie, [tie], 2, [warehouse]))).toEqual(['c', '1'])
    expect(hashes(pickReferences(withTie, [tie], 1, [warehouse]))).toEqual(['c'])
    // 沒有角色參考圖時，一張名額就給場景
    expect(hashes(pickReferences(shot, [], 1, [warehouse]))).toEqual(['1'])
    expect(pickReferences(shot, [], 0, [warehouse])).toEqual([])
  })

  it('組 Prompt 節點：帶入場景描述與參考圖；場景內容改了快取就會失效', async () => {
    const input = { number: 1, description: '走進倉庫', durationSec: 3, locationId: 'loc1' }
    const { out } = await runNode(shotPromptNode, {
      params: { scenes: [warehouse], referenceLimit: 3 },
      inputs: { shot: input },
    })
    expect(String(out.imagePrompt)).toContain('舊倉庫')
    expect(hashes(out.references as AssetRef[])).toEqual(['1'])
    expect(shotPromptNode.version).toBeGreaterThanOrEqual(5)
  })

  it('單鏡頭工作流把場景卡放進組 Prompt 節點的參數', () => {
    const flow = buildShotWorkflow({
      style: 'realistic',
      durationSec: 3,
      aspectRatio: '16:9',
      models: { image: 'fal/t2i', video: 'fal/i2v' },
      scenes: [warehouse],
      editModel: { id: 'fal/edit', referenceLimit: 3 },
    })
    expect(flow.nodes.find((n) => n.id === 'prompt')?.params).toMatchObject({
      scenes: [{ id: 'loc1', name: '舊倉庫' }],
    })
  })
})

describe('dialogueOf：台詞超過每鏡上限時不念出殘句', () => {
  // 4 秒一鏡，上限 16 個字
  const dur = 4
  const at = (dialogue: unknown) => dialogueOf({ dialogue }, dur).dialogue

  it('剛好在上限內：原樣保留（只去掉前後空白）', () => {
    expect(narrationMaxChars(dur)).toBe(16)
    expect(at('  黑藤爬滿了斷橋，貓走過去。 ')).toBe('黑藤爬滿了斷橋，貓走過去。')
    expect(at('一二三四五六七八九十一二三四五六')).toBe('一二三四五六七八九十一二三四五六')
  })

  it('超過上限而且上限以內有句讀：切在最後一個句讀，結尾的逗號拿掉、句號留著', () => {
    expect(at('黑藤爬滿了斷橋，貓小心地走過去，回頭看了一眼。')).toBe(
      '黑藤爬滿了斷橋，貓小心地走過去',
    )
    expect(at('黑藤爬滿了斷橋貓小心走過去，回頭看了一眼。')).toBe('黑藤爬滿了斷橋貓小心走過去')
    expect(at('黑藤爬滿了斷橋，貓小心地走過去。回頭看了一眼')).toBe(
      '黑藤爬滿了斷橋，貓小心地走過去。',
    )
    expect(at('黑藤爬滿了斷橋，貓走過去。回頭看了一眼，風停了。')).toBe(
      '黑藤爬滿了斷橋，貓走過去。',
    )
    expect(at('Vines, the cat walks over the bridge.')).toBe('Vines')
  })

  it('超過上限但上限以內沒有句讀：整句保留，不切成半句', () => {
    const line = '黑藤爬滿了斷橋貓小心地走過去回頭看了一眼'
    expect(line.length).toBeGreaterThan(16)
    expect(at(line)).toBe(line)
  })

  it('沒有台詞欄位就不帶；不是字串也不帶', () => {
    expect(dialogueOf({}, dur)).toEqual({})
    expect(dialogueOf({ dialogue: 3 }, dur)).toEqual({})
  })
})
