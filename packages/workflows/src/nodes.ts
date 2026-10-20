import {
  AppError,
  AspectRatioSchema,
  CAMERA_MOVES,
  CAMERA_MOVE_IDS,
  AssetRefSchema,
  ShotAngleSchema,
  ShotSizeSchema,
  defineNode,
  storyboardGuidePrompt,
  type AssetRef,
  type GenerationOutput,
  type GraphCategory,
  type NodeDefinition,
  type ReportedCost,
} from '@svs/schema'
import { z } from 'zod'

import { generateStructured } from './structured'
import { getStudio } from './services'
import { QUICK_STYLES, QUICK_STYLE_IDS, type QuickStyleId } from './styles'

export const NODE_TYPES = {
  breakdown: 'story.breakdown',
  shotPrompt: 'shot.prompt',
  image: 'image.generate',
  video: 'video.generate',
  concat: 'video.concat',
  conceptPrompt: 'character.conceptPrompt',
  turnaroundPrompt: 'character.turnaroundPrompt',
  imageEdit: 'image.edit',
  locationConceptPrompt: 'location.conceptPrompt',
  locationAnglePrompt: 'location.anglePrompt',
  fixedImage: 'image.fixed',
} as const

/** 節點在節點圖上的白話名稱與色條分類。 */
export const NODE_INFO: Readonly<Record<string, { title: string; category: GraphCategory }>> = {
  $input: { title: '這個鏡頭', category: 'input' },
  $output: { title: '輸出', category: 'output' },
  forEach: { title: '對每個鏡頭執行', category: 'join' },
  [NODE_TYPES.breakdown]: { title: '把故事分成一個個畫面', category: 'prompt' },
  [NODE_TYPES.shotPrompt]: { title: '整理成 Prompt', category: 'prompt' },
  [NODE_TYPES.image]: { title: '生成第一張畫面', category: 'image' },
  [NODE_TYPES.fixedImage]: { title: '用上傳的圖當第一張畫面', category: 'image' },
  [NODE_TYPES.imageEdit]: { title: '用參考圖修改圖片', category: 'image' },
  [NODE_TYPES.video]: { title: '圖生影片', category: 'video' },
  [NODE_TYPES.concat]: { title: '接成一支影片', category: 'join' },
  [NODE_TYPES.conceptPrompt]: { title: '角色概念圖 Prompt', category: 'prompt' },
  [NODE_TYPES.turnaroundPrompt]: { title: '角色三視圖 Prompt', category: 'prompt' },
  [NODE_TYPES.locationConceptPrompt]: { title: '場景概念圖 Prompt', category: 'prompt' },
  [NODE_TYPES.locationAnglePrompt]: { title: '場景角度 Prompt', category: 'prompt' },
}

const StyleIdSchema = z.enum(QUICK_STYLE_IDS)

/** 已鎖定角色的固定外觀描述：出場的角色名字對得上，就原封不動帶進 Prompt。 */
export const CharacterAnchorSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
  /** 鎖定的是第幾版（只用來顯示；內容變了快取就會失效）。 */
  version: z.number().int().positive().optional(),
  /** 這個角色的參考圖：主圖與三視圖。有的話，生首幀時會依鏡頭挑出來帶進去。 */
  images: z
    .object({
      hero: AssetRefSchema.optional(),
      front: AssetRefSchema.optional(),
      side: AssetRefSchema.optional(),
      back: AssetRefSchema.optional(),
    })
    .optional(),
})
export type CharacterAnchor = z.infer<typeof CharacterAnchorSchema>

/** 已鎖定場景卡的固定描述與參考圖：鏡頭指定的地點（locationId）對得上，就帶進 Prompt 與參考圖。 */
export const SceneAnchorSchema = z.object({
  /** 地點的 id（鏡頭用 id 指定地點，改名不會對不上）。 */
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
  /** 主場景圖與另外兩個角度（沒有的角度用主圖頂替）。 */
  images: z
    .object({
      main: AssetRefSchema.optional(),
      reverse: AssetRefSchema.optional(),
      wide: AssetRefSchema.optional(),
    })
    .optional(),
})
export type SceneAnchor = z.infer<typeof SceneAnchorSchema>

/** 拆鏡結果裡的一個鏡頭。 */
export const ShotItemSchema = z.object({
  number: z.number().int().positive(),
  /** 這一鏡畫面裡發生什麼事（白話）。 */
  description: z.string().min(1),
  size: ShotSizeSchema.default('medium'),
  /** 拍攝角度；一般都是平視，只有明顯從側面或背後拍才是 side／back（自動挑參考圖用）。 */
  angle: ShotAngleSchema.default('eye_level'),
  /** 運鏡的白話描述，例如「慢慢推近」；固定鏡頭就是 null。 */
  cameraMove: z.string().nullable().default(null),
  durationSec: z.number().positive(),
  characters: z.array(z.string()).default([]),
  mood: z.string().default(''),
  /** 鏡頭發生的地點（場景卡用它對應；AI 拆鏡不會填，由分鏡表指定）。 */
  locationId: z.string().optional(),
  /** 使用者手動改過的 Prompt；有填就直接用它，不再由描述組出來。 */
  promptOverride: z.string().optional(),
  /** 這一鏡的旁白台詞（拆鏡時一句話勾了「旁白」才會寫）；不進圖片與影片的 Prompt。 */
  dialogue: z.string().optional(),
})
export type ShotItem = z.infer<typeof ShotItemSchema>

/** 請 LLM 輸出的格式（沒有 number 與 durationSec，由我們補）。 */
const LlmShotSchema = ShotItemSchema.omit({
  number: true,
  durationSec: true,
  promptOverride: true,
  cameraMove: true,
  locationId: true,
  dialogue: true,
}).extend({
  /** 只能從運鏡預設清單裡選（或 null 代表沒特別要求）。 */
  cameraMove: z.enum(CAMERA_MOVE_IDS).nullable().default(null),
})
const LlmBreakdownSchema = z.object({
  title: z.string(),
  shots: z.array(LlmShotSchema).min(1).max(12),
})
/** 要旁白時：每一鏡多一句台詞（旁白念的字）。 */
const LlmBreakdownWithNarrationSchema = z.object({
  title: z.string(),
  shots: z
    .array(LlmShotSchema.extend({ dialogue: z.string().min(1) }))
    .min(1)
    .max(12),
})

/** 旁白一秒大約念幾個字（中文），用來限制每鏡台詞的長度。 */
const NARRATION_CHARS_PER_SEC = 4

/** 模型寫的台詞（有要旁白才有）照每鏡秒數的上限截短；沒有就不帶這個欄位。 */
function dialogueOf(shot: object, durationSec: number): { dialogue?: string } {
  const raw = 'dialogue' in shot ? shot.dialogue : undefined
  return typeof raw === 'string'
    ? { dialogue: raw.trim().slice(0, narrationMaxChars(durationSec)) }
    : {}
}

/** 每一鏡的旁白最多幾個字：配合每鏡秒數，念得完。 */
export const narrationMaxChars = (durationSec: number): number =>
  Math.max(6, Math.round(durationSec * NARRATION_CHARS_PER_SEC))

function assetOf(output: GenerationOutput, kind: 'image' | 'video'): AssetRef {
  if (output.kind !== 'assets') {
    throw new AppError({ code: 'invalid_response', userMessage: '模型沒有回傳檔案。' })
  }
  const asset = output.assets.find((a) => a.kind === kind)
  if (!asset) {
    throw new AppError({
      code: 'invalid_response',
      userMessage: `模型回傳的檔案不是${kind === 'image' ? '圖片' : '影片'}。`,
    })
  }
  return asset
}

const costOf = (
  provider: string,
  modelId: string | undefined,
  costUsd: number | undefined,
  jobId: string,
): ReportedCost | undefined =>
  costUsd === undefined
    ? undefined
    : { provider, modelId: modelId ?? 'unknown', amountUsd: costUsd, jobId }

const needModel = (modelId: string | undefined, what: string): string => {
  if (!modelId) {
    throw new AppError({ code: 'invalid_request', userMessage: `還沒有選${what}模型。` })
  }
  return modelId
}

// ------------------------------------------------------------------ 拆鏡

export const breakdownNode = defineNode({
  type: NODE_TYPES.breakdown,
  version: 5,
  inputs: {},
  outputs: { shots: 'json', title: 'text' },
  params: z.object({
    story: z.string().min(1, '請先寫下你的故事'),
    shotCount: z.number().int().min(1).max(12).default(4),
    durationSec: z.number().positive().default(3),
    style: StyleIdSchema.default('realistic'),
    /** 想換一批結果時改這個數字。 */
    variation: z.number().int().nonnegative().default(0),
    /** 已經建好的角色名字：故事裡出現這些角色時，鏡頭裡要用同樣的名字。 */
    knownCharacters: z.array(z.string().min(1)).default([]),
    /** 分鏡準則（見 DEFAULT_STORYBOARD_GUIDE）；空字串表示不附。 */
    guide: z.string().default(''),
    /** 一句話勾了「旁白」：每一鏡另外寫一句短的旁白台詞（不勾就不寫台詞）。 */
    narration: z.boolean().default(false),
  }),
  estimateCost: ({ params, modelId, estimate }) =>
    estimate(needModel(modelId, '文字'), {
      inputTokens: Math.ceil((params.story.length + params.guide.length) * 1.5) + 500,
      outputTokens: params.shotCount * (params.narration ? 200 : 150) + 50,
    }),
  run: async ({ params, modelId, signal, nodeRunId, services, reportCost }) => {
    const studio = getStudio(services)
    const model = needModel(modelId, '文字')
    const result = await generateStructured(
      studio,
      {
        modelId: model,
        seed: params.variation,
        system:
          '你是短片的分鏡助手。把使用者的故事拆成幾個連續的鏡頭，每個鏡頭是一段約幾秒的畫面。' +
          '用白話描述畫面裡看得到的人事物與動作，不要寫抽象的感受。同一個角色在不同鏡頭裡用同一個名字。' +
          (params.narration
            ? `description 只寫畫面，不要寫對白。另外每個鏡頭都要有 dialogue：一句給旁白念的短句（中文，白話，不加引號、括號與動作說明），配合這一鏡的情節；每鏡 ${String(params.durationSec)} 秒，dialogue 最多 ${String(narrationMaxChars(params.durationSec))} 個字，要念得完。`
            : '不要寫對白。') +
          (params.knownCharacters.length > 0
            ? `已經建好的角色有：${params.knownCharacters.join('、')}。故事裡出現這些角色時，characters 欄位一定要用一模一樣的名字。`
            : '') +
          '每個鏡頭的 angle 預設是 eye_level；只有畫面明顯是從角色側面拍、或只拍到角色背影時，才用 side 或 back。' +
          `每個鏡頭的 cameraMove 只能是 null（沒特別要求）或下列其中一個：${CAMERA_MOVES.map((c) => `${c.id}（${c.label}）`).join('、')}。` +
          `畫風是「${QUICK_STYLES[params.style].label}」。只輸出 JSON。` +
          storyboardGuidePrompt(params.guide),
        messages: [
          {
            role: 'user',
            content: `故事：\n${params.story}\n\n請拆成 ${String(params.shotCount)} 個鏡頭。`,
          },
        ],
      },
      params.narration ? LlmBreakdownWithNarrationSchema : LlmBreakdownSchema,
      { signal, nodeRunId },
    )
    const shots: ShotItem[] = result.data.shots.slice(0, params.shotCount).map((shot, i) => ({
      ...shot,
      // 台詞照每鏡秒數的上限截短（模型寫太長念不完）
      ...dialogueOf(shot, params.durationSec),
      number: i + 1,
      durationSec: params.durationSec,
    }))
    const cost = costOf(result.provider, model, result.costUsd, result.jobId)
    if (cost) reportCost(cost)
    return { shots, title: result.data.title }
  },
})

// ------------------------------------------------------------------ 自動挑參考圖

/**
 * 依鏡頭的景別與角度挑參考圖。
 * 角色（出場且有參考圖的已鎖定角色）：側面 → 側視圖、背影 → 背視圖、近景／特寫 → 主圖，其他 → 主圖＋正視圖；
 * 缺的圖用主圖頂替。場景（鏡頭指定的地點有已鎖定的場景卡）：遠景以上 → 拉遠的全景、背面或過肩 → 反方向的角度，
 * 其他 → 主場景圖；缺的角度用主場景圖頂替。
 * 總數不超過 limit：場景占一張，其餘給角色（多個角色時每個角色先拿到第一張再拿第二張）；只剩一張名額時留給角色。
 */
export function pickReferences(
  shot: Pick<ShotItem, 'size' | 'angle' | 'locationId'> & { characters: readonly string[] },
  anchors: readonly CharacterAnchor[],
  limit: number,
  scenes: readonly SceneAnchor[] = [],
): AssetRef[] {
  if (limit <= 0) return []
  const perCharacter = anchors
    .filter((anchor) => shot.characters.includes(anchor.name) && anchor.images)
    .map((anchor): AssetRef[] => {
      const { hero, front, side, back } = anchor.images ?? {}
      const close = shot.size === 'close_up' || shot.size === 'extreme_close_up'
      const wanted =
        shot.angle === 'side'
          ? [side ?? hero]
          : shot.angle === 'back'
            ? [back ?? hero]
            : close
              ? [hero ?? front]
              : [hero ?? front, hero ? front : undefined]
      return wanted.flatMap((ref) => (ref ? [ref] : []))
    })
  const scene = pickSceneReference(shot, scenes)
  // 場景占一張；只剩一張名額時留給角色（有角色參考圖才算）
  const characterLimit =
    scene && (limit > 1 || perCharacter.length === 0) ? Math.max(limit - 1, 0) : limit
  const picked: AssetRef[] = []
  for (let round = 0; picked.length < characterLimit; round++) {
    let any = false
    for (const refs of perCharacter) {
      const ref = refs[round]
      if (!ref) continue
      any = true
      if (picked.length < characterLimit && !picked.some((p) => p.hash === ref.hash)) {
        picked.push(ref)
      }
    }
    if (!any) break
  }
  if (scene && picked.length < limit && !picked.some((p) => p.hash === scene.hash)) {
    picked.push(scene)
  }
  return picked
}

/** 鏡頭指定的地點有已鎖定的場景卡，就依景別與角度挑一張場景參考圖。 */
function pickSceneReference(
  shot: Pick<ShotItem, 'size' | 'angle' | 'locationId'>,
  scenes: readonly SceneAnchor[],
): AssetRef | undefined {
  const images = scenes.find((scene) => scene.id === shot.locationId)?.images
  if (!images) return undefined
  const { main, reverse, wide } = images
  const establishing = shot.size === 'extreme_wide' || shot.size === 'wide' || shot.size === 'full'
  if (establishing) return wide ?? main
  if (shot.angle === 'back' || shot.angle === 'over_shoulder') return reverse ?? main
  return main
}

// ------------------------------------------------------------------ 組 Prompt

/**
 * 由鏡頭內容組出給模型的 Prompt。使用者手動改過 Prompt 時就直接用它。
 * 畫面上「自動組出的 Prompt」也用這個函式，所以看到的就是實際會送出去的內容。
 */
export function composeShotPrompts(
  shot: ShotItem,
  styleId: QuickStyleId,
  anchors: readonly CharacterAnchor[] = [],
  scenes: readonly SceneAnchor[] = [],
): { imagePrompt: string; videoPrompt: string } {
  if (shot.promptOverride) {
    return { imagePrompt: shot.promptOverride, videoPrompt: shot.promptOverride }
  }
  const style = QUICK_STYLES[styleId].fragment
  const who = shot.characters.length > 0 ? `（出場：${shot.characters.join('、')}）` : ''
  const mood = shot.mood ? `，氣氛${shot.mood}` : ''
  const looks = anchors
    .filter((anchor) => shot.characters.includes(anchor.name))
    .map((anchor) => `${anchor.name}：${anchor.text}`)
  const place = scenes.find((scene) => scene.id === shot.locationId)
  // 固定外觀與場景描述原封不動放進去，不改寫、不縮短
  const base =
    `${shot.description}${who}${mood}` +
    (looks.length > 0 ? `。角色外觀——${looks.join('；')}` : '') +
    (place ? `。場景（${place.name}）——${place.text}` : '')
  // 運鏡不寫在這裡：送出影片請求時才依模型決定是用原生參數還是加進 Prompt（見 resolveCameraMove）
  return { imagePrompt: `${base}。${style}`, videoPrompt: `${base}。${style}` }
}

export const shotPromptNode = defineNode({
  type: NODE_TYPES.shotPrompt,
  version: 5,
  inputs: { shot: { type: 'json' } },
  outputs: { imagePrompt: 'text', videoPrompt: 'text', cameraMove: 'text', references: 'json' },
  params: z.object({
    style: StyleIdSchema.default('realistic'),
    /** 已鎖定角色的固定外觀描述（內容改了，快取就會失效而重新生成）。 */
    anchors: z.array(CharacterAnchorSchema).default([]),
    /** 已鎖定場景卡的固定描述與參考圖。 */
    scenes: z.array(SceneAnchorSchema).default([]),
    /** 最多帶幾張參考圖（依圖片模型的上限）。 */
    referenceLimit: z.number().int().nonnegative().default(3),
  }),
  run: ({ inputs, params }) => {
    const shot = ShotItemSchema.parse(inputs.shot)
    // 運鏡獨立輸出（空字串 = 沒有指定），手動改過 Prompt 時一樣有效
    return {
      ...composeShotPrompts(shot, params.style, params.anchors, params.scenes),
      cameraMove: shot.cameraMove ?? '',
      references: pickReferences(shot, params.anchors, params.referenceLimit, params.scenes),
    }
  },
})

// ------------------------------------------------------------------ 角色概念圖

export const ConceptSubjectSchema = z.object({
  name: z.string().min(1),
  age: z.string().optional(),
  appearance: z.string().default(''),
  outfit: z.string().default(''),
  /** 固定外觀描述（草稿或已鎖定都可以）；有的話優先用它，不再另外列長相與服裝。 */
  anchor: z.string().optional(),
})
export type ConceptSubject = z.input<typeof ConceptSubjectSchema>

/**
 * 角色概念圖的 Prompt：全身、正面、乾淨的背景，方便之後挑成主圖、再延伸成三視圖。
 * 有固定外觀描述就用它（原封不動），沒有才用長相與服裝。
 */
export function composeConceptPrompt(subject: ConceptSubject, styleId: QuickStyleId): string {
  const looks = subject.anchor?.trim()
    ? subject.anchor.trim()
    : [(subject.appearance ?? '').trim(), (subject.outfit ?? '').trim()]
        .filter((part) => part !== '')
        .join('，')
  const age = subject.age?.trim() ? `，${subject.age.trim()}` : ''
  const body = looks === '' ? subject.name : `${subject.name}${age}：${looks}`
  return `角色設定圖，${body}。全身站立，面向前方，表情自然，單色乾淨的背景。${QUICK_STYLES[styleId].fragment}`
}

export const conceptPromptNode = defineNode({
  type: NODE_TYPES.conceptPrompt,
  version: 1,
  inputs: { subject: { type: 'json' } },
  outputs: { prompt: 'text' },
  params: z.object({ style: StyleIdSchema.default('realistic') }),
  run: ({ inputs, params }) => ({
    prompt: composeConceptPrompt(ConceptSubjectSchema.parse(inputs.subject), params.style),
  }),
})

// ------------------------------------------------------------------ 角色三視圖

export const TurnaroundSubjectSchema = z.object({
  name: z.string().min(1),
  appearance: z.string().default(''),
  outfit: z.string().default(''),
  /** 固定外觀描述；有的話優先用它。 */
  anchor: z.string().optional(),
  /** 主圖：三視圖以它為參考。 */
  hero: AssetRefSchema,
})
export type TurnaroundSubject = z.input<typeof TurnaroundSubjectSchema>

/**
 * 三視圖設定稿的 Prompt：同一個角色，正面／側面／背面三個全身站姿並排在一張橫式圖上，白色背景。
 * 重點是「完全照參考圖」，不要重新設計角色。
 */
export function composeTurnaroundPrompt(
  subject: Omit<TurnaroundSubject, 'hero'>,
  styleId: QuickStyleId,
): string {
  const looks = subject.anchor?.trim()
    ? subject.anchor.trim()
    : [(subject.appearance ?? '').trim(), (subject.outfit ?? '').trim()]
        .filter((part) => part !== '')
        .join('，')
  const detail = looks === '' ? '' : `外觀：${looks}。`
  return (
    `角色三視圖設定稿（character turnaround sheet）：參考圖裡的角色「${subject.name}」，` +
    '在同一張橫式圖上由左到右並排三個全身站姿：正面、側面（面向右）、背面；A-pose，三個視角大小一致、站在同一條水平線上，' +
    '純白背景，沒有文字、標示或邊框。臉、髮型、服裝、配色必須和參考圖完全一致，不要重新設計。' +
    `${detail}${QUICK_STYLES[styleId].fragment}。` +
    'Full-body character turnaround sheet, front view, side view, back view side by side, A-pose, plain white background, no text, strictly consistent with the reference image.'
  )
}

export const turnaroundPromptNode = defineNode({
  type: NODE_TYPES.turnaroundPrompt,
  version: 1,
  inputs: { subject: { type: 'json' } },
  outputs: { prompt: 'text', references: 'json' },
  params: z.object({ style: StyleIdSchema.default('realistic') }),
  run: ({ inputs, params }) => {
    const { hero, ...subject } = TurnaroundSubjectSchema.parse(inputs.subject)
    return { prompt: composeTurnaroundPrompt(subject, params.style), references: [hero] }
  },
})

// ------------------------------------------------------------------ 場景卡

export const LocationSubjectSchema = z.object({
  name: z.string().min(1),
  /** 故事裡對這個地點的說明。 */
  description: z.string().default(''),
  /** 固定場景描述（草稿或已鎖定都可以）；有的話優先用它。 */
  anchor: z.string().optional(),
})
export type LocationSubject = z.input<typeof LocationSubjectSchema>

/** 場景概念圖的 Prompt：沒有人物的空景，方便之後挑成主場景圖、再延伸出其他角度。 */
export function composeLocationConceptPrompt(
  subject: LocationSubject,
  styleId: QuickStyleId,
): string {
  const looks = subject.anchor?.trim() ? subject.anchor.trim() : (subject.description ?? '').trim()
  const body = looks === '' ? subject.name : `${subject.name}：${looks}`
  return `場景設定圖，${body}。畫面裡沒有人物，只呈現這個地點的環境、佈置與光線氛圍。${QUICK_STYLES[styleId].fragment}`
}

export const locationConceptPromptNode = defineNode({
  type: NODE_TYPES.locationConceptPrompt,
  version: 1,
  inputs: { subject: { type: 'json' } },
  outputs: { prompt: 'text' },
  params: z.object({ style: StyleIdSchema.default('realistic') }),
  run: ({ inputs, params }) => ({
    prompt: composeLocationConceptPrompt(LocationSubjectSchema.parse(inputs.subject), params.style),
  }),
})

/** 主圖之外的兩個角度：從另一側看，或拉遠看全景。 */
export const LOCATION_ANGLE_DIRECTIONS = {
  reverse: '從相反的方向看同一個地點（站在原本畫面的對面，看向原本拍攝的位置）',
  wide: '拉遠的全景，一眼看到這個地點的整體格局',
} as const

export const LocationAngleSubjectSchema = z.object({
  name: z.string().min(1),
  anchor: z.string().optional(),
  description: z.string().default(''),
  /** 主場景圖：另外的角度以它為參考。 */
  main: AssetRefSchema,
  angle: z.enum(['reverse', 'wide']),
})
export type LocationAngleSubject = z.input<typeof LocationAngleSubjectSchema>

/** 另一個角度的 Prompt：同一個地點，只換拍攝的角度；佈置、建材、配色、光線必須和參考圖一致。 */
export function composeLocationAnglePrompt(
  subject: Omit<LocationAngleSubject, 'main'>,
  styleId: QuickStyleId,
): string {
  const looks = subject.anchor?.trim() ? subject.anchor.trim() : (subject.description ?? '').trim()
  const detail = looks === '' ? '' : `場景特徵：${looks}。`
  return (
    `場景設定圖：參考圖裡的地點「${subject.name}」，${LOCATION_ANGLE_DIRECTIONS[subject.angle]}。` +
    '畫面裡沒有人物。佈置、建材、配色、光線與氛圍必須和參考圖完全一致，不要重新設計。' +
    `${detail}${QUICK_STYLES[styleId].fragment}`
  )
}

export const locationAnglePromptNode = defineNode({
  type: NODE_TYPES.locationAnglePrompt,
  version: 1,
  inputs: { subject: { type: 'json' } },
  outputs: { prompt: 'text', references: 'json' },
  params: z.object({ style: StyleIdSchema.default('realistic') }),
  run: ({ inputs, params }) => {
    const { main, ...subject } = LocationAngleSubjectSchema.parse(inputs.subject)
    return { prompt: composeLocationAnglePrompt(subject, params.style), references: [main] }
  },
})

// ------------------------------------------------------------------ 圖片編輯（帶參考圖）

export const imageEditNode = defineNode({
  type: NODE_TYPES.imageEdit,
  version: 1,
  inputs: { prompt: { type: 'text' }, references: { type: 'json' } },
  outputs: { image: 'image' },
  params: z.object({
    aspectRatio: AspectRatioSchema.default('16:9'),
    variation: z.number().int().nonnegative().default(0),
  }),
  estimateCost: ({ modelId, estimate }) => estimate(needModel(modelId, '圖片'), { images: 1 }),
  run: async ({ inputs, params, modelId, signal, nodeRunId, services, reportCost }) => {
    const studio = getStudio(services)
    const model = needModel(modelId, '圖片')
    const references = z.array(AssetRefSchema).min(1).safeParse(inputs.references)
    if (!references.success) {
      throw new AppError({ code: 'invalid_request', userMessage: '需要至少一張參考圖。' })
    }
    const result = await studio.generate(
      {
        capability: 'edit',
        modelId: model,
        prompt: String(inputs.prompt),
        aspectRatio: params.aspectRatio,
        seed: params.variation,
        referenceAssets: references.data.map((ref) => ref.hash),
        count: 1,
      },
      { signal, nodeRunId },
    )
    const cost = costOf(result.provider, model, result.costUsd, result.jobId)
    if (cost) reportCost(cost)
    return { image: assetOf(result.output, 'image') }
  },
})

// ------------------------------------------------------------------ 首幀圖

/** 有參考圖時，附在 Prompt 後面的提醒（圖片編輯模型才看得懂「參考圖」）。 */
export const REFERENCE_PROMPT_SUFFIX =
  '。參考圖是設定圖：出場角色的臉、髮型、服裝、配色，以及場景的佈置與色調，必須和參考圖完全一致，不要重新設計。'

export const imageNode = defineNode({
  type: NODE_TYPES.image,
  version: 3,
  inputs: { prompt: { type: 'text' }, references: { type: 'json', optional: true } },
  outputs: { image: 'image' },
  params: z.object({
    aspectRatio: AspectRatioSchema.default('16:9'),
    variation: z.number().int().nonnegative().default(0),
    /** 鏡頭有角色參考圖時改用這個「可帶參考圖編輯」的模型；沒設就一律純文字生圖。 */
    editModel: z.string().min(1).optional(),
  }),
  estimateCost: ({ modelId, estimate }) => estimate(needModel(modelId, '圖片'), { images: 1 }),
  run: async ({ inputs, params, modelId, signal, nodeRunId, services, reportCost }) => {
    const studio = getStudio(services)
    const references = z.array(AssetRefSchema).safeParse(inputs.references ?? [])
    const refs = references.success ? references.data : []
    const editing = params.editModel !== undefined && refs.length > 0
    const model = editing ? needModel(params.editModel, '圖片') : needModel(modelId, '圖片')
    const result = await studio.generate(
      {
        capability: editing ? 'edit' : 't2i',
        modelId: model,
        prompt: editing
          ? `${String(inputs.prompt)}${REFERENCE_PROMPT_SUFFIX}`
          : String(inputs.prompt),
        aspectRatio: params.aspectRatio,
        seed: params.variation,
        referenceAssets: editing ? refs.map((ref) => ref.hash) : [],
        count: 1,
      },
      { signal, nodeRunId },
    )
    const cost = costOf(result.provider, model, result.costUsd, result.jobId)
    if (cost) reportCost(cost)
    return { image: assetOf(result.output, 'image') }
  },
})

/**
 * 固定的第一張畫面：鏡頭接了一張上傳的圖時用它，不生圖、不花錢。
 * 圖本身就是參數，換一張圖快取鍵就跟著變，影片會重生。
 */
export const fixedImageNode = defineNode({
  type: NODE_TYPES.fixedImage,
  version: 1,
  inputs: {},
  outputs: { image: 'image' },
  params: z.object({ image: AssetRefSchema }),
  run: ({ params }) => ({ image: params.image }),
})

// ------------------------------------------------------------------ 圖生影片

export const videoNode = defineNode({
  type: NODE_TYPES.video,
  version: 2,
  inputs: {
    image: { type: 'image' },
    prompt: { type: 'text' },
    cameraMove: { type: 'text', optional: true },
  },
  outputs: { video: 'video' },
  params: z.object({
    durationSec: z.number().positive().default(3),
    aspectRatio: AspectRatioSchema.default('16:9'),
    audio: z.boolean().default(false),
    variation: z.number().int().nonnegative().default(0),
  }),
  estimateCost: ({ params, modelId, estimate }) =>
    estimate(needModel(modelId, '影片'), { seconds: params.durationSec, audio: params.audio }),
  run: async ({ inputs, params, modelId, signal, nodeRunId, services, reportCost }) => {
    const studio = getStudio(services)
    const model = needModel(modelId, '影片')
    const frame = AssetRefSchema.parse(inputs.image)
    const result = await studio.generate(
      {
        capability: 'i2v',
        modelId: model,
        prompt: String(inputs.prompt),
        durationSec: params.durationSec,
        aspectRatio: params.aspectRatio,
        audio: params.audio,
        seed: params.variation,
        startFrameAsset: frame.hash,
        referenceAssets: [],
        ...(typeof inputs.cameraMove === 'string' && inputs.cameraMove !== ''
          ? { cameraMove: inputs.cameraMove }
          : {}),
      },
      { signal, nodeRunId },
    )
    const cost = costOf(result.provider, model, result.costUsd, result.jobId)
    if (cost) reportCost(cost)
    return { video: assetOf(result.output, 'video') }
  },
})

// ------------------------------------------------------------------ 接片

export const concatNode = defineNode({
  type: NODE_TYPES.concat,
  version: 1,
  inputs: { videos: { type: 'json' } },
  outputs: { video: 'video' },
  params: z.object({}),
  run: async ({ inputs, signal, services }) => {
    const studio = getStudio(services)
    const videos = z.array(AssetRefSchema).min(1).safeParse(inputs.videos)
    if (!videos.success) {
      throw new AppError({ code: 'invalid_request', userMessage: '沒有可以接起來的影片片段。' })
    }
    return { video: await studio.concatVideos(videos.data, { signal }) }
  },
})

/** 把快速開始用到的節點登錄到引擎的節點註冊表。 */
export function registerQuickStartNodes(registry: {
  register: (def: NodeDefinition) => unknown
}): void {
  for (const def of QUICK_START_NODES) registry.register(def)
}

export const QUICK_START_NODES: readonly NodeDefinition[] = [
  breakdownNode,
  shotPromptNode,
  conceptPromptNode,
  turnaroundPromptNode,
  locationConceptPromptNode,
  locationAnglePromptNode,
  imageEditNode,
  imageNode,
  fixedImageNode,
  videoNode,
  concatNode,
]
