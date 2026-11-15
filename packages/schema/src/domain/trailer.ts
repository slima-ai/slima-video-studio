import { z } from 'zod'

import { t } from '../i18n'
import { getLocale, type Locale } from '../i18n/locale'
import { ContentHashSchema } from './common'

// 預告片的資料與規則（T1）。一支預告片＝一個專案＋一份預告片設定（`trailer_settings`，每個專案一列；沒有這一列就是一般專案）。
// 「這一格在成品裡幾秒」沒有新欄位：直接用鏡頭現有的 `durationSec`。
// 規則的出處與強度見 HQ 的預告片規劃第 2.3、2.5 節；這裡只做成機器可以檢查的樣子。

// ---- 格子種類與字卡（鏡頭多的兩個欄位） ----

/**
 * 格子種類。video＝影片鏡頭（預設，舊專案的鏡頭全是這個）、still＝靜態鏡頭（一張圖，之後加運鏡變成影片）、
 * card＝字卡（只有字）、title＝片名卡（用預告片設定的書名、作者、封面）。
 */
export const BeatKindSchema = z.enum(['video', 'still', 'card', 'title'])
export type BeatKind = z.infer<typeof BeatKindSchema>

/** 本機格子（靜態鏡頭、字卡、片名卡）的影片版本記的「模型」：在這台電腦上做，不花錢。 */
export const LOCAL_STILL_MODEL = 'local-still'
export const LOCAL_CARD_MODEL = 'local-card'
/**
 * 示範模式的記號：文本裡有這段字，假腳本就故意寫壞（第一格是字卡，程式修不了），
 * 讓示範模式看得到「檢查器擋下、專案沒被改」的畫面。
 */
export const DEMO_BAD_SCRIPT_MARK = '【腳本不合格】'

/** 寫腳本的使用者訊息裡的固定字樣（示範模式的假腳本靠它認出請求、讀出旁白開關）。 */
export const TRAILER_REQUEST_MARK = '請寫預告片腳本'

/** 旁白太長、請文字模型改短的請求開頭（示範模式的假模型靠它認得這種請求；送給模型的字，用雜湊釘住）。 */
export const NARRATION_SHORTEN_MARK = '請把這句旁白改短'
export const TRAILER_NARRATION_OFF_MARK = '旁白：關'

/** 秒數顯示用：最多兩位小數（腳本的秒數是 1/24 秒的整數倍，例如 2.0833…，畫面上寫 2.08）。 */
export const secLabel = (sec: number): string => String(Math.round(sec * 100) / 100)

/** 格子種類的白話名稱（卡片、面板、分鏡表都用同一組字）。 */
export const beatKindLabel = (kind: BeatKind): string =>
  kind === 'still'
    ? t('trailer.beatStill')
    : kind === 'card'
      ? t('trailer.beatCard')
      : kind === 'title'
        ? t('trailer.beatTitle')
        : t('trailer.beatVideo')

export const isLocalModel = (modelId: string): boolean =>
  modelId === LOCAL_STILL_MODEL || modelId === LOCAL_CARD_MODEL

/** 字卡的內容：主文字、副文字（可以沒有）。 */
export const ShotCardSchema = z.object({
  text: z.string().trim().min(1).max(60),
  subtext: z.string().trim().max(120).default(''),
})
export type ShotCard = z.infer<typeof ShotCardSchema>

/** 疊在不動的畫面上的字：主文字（金句）、小字（出處，可以沒有）。真正的字數上限由檢查器管，這裡的上限只是防呆。 */
export const ShotOverlaySchema = z.object({
  text: z.string().trim().min(1).max(80),
  subtext: z.string().trim().max(60).default(''),
})
export type ShotOverlay = z.infer<typeof ShotOverlaySchema>

/** 疊字的字數上限：主文字中文 24 個字、英文 12 個單字；小字中文 16 個字、英文 8 個單字。 */
export const OVERLAY_MAX_CJK = 24
export const OVERLAY_MAX_WORDS = 12
export const OVERLAY_SUB_MAX_CJK = 16
export const OVERLAY_SUB_MAX_WORDS = 8

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** 疊字用掉多少、上限多少：有中日文就數字（不含空白），否則數單字。面板的字數提示與檢查器共用。 */
export function overlaySize(
  text: string,
  part: 'text' | 'sub',
  /** 還沒有任何字的時候，用哪一種上限（面板：介面語言是中文就 true）。 */
  emptyIsCjk = false,
): { used: number; max: number; cjk: boolean } {
  const trimmed = text.trim()
  const cjk = trimmed === '' ? emptyIsCjk : CJK_RE.test(trimmed)
  const used = cjk
    ? Array.from(trimmed.replace(/\s+/g, '')).length
    : trimmed === ''
      ? 0
      : trimmed.split(/\s+/).length
  const max =
    part === 'text'
      ? cjk
        ? OVERLAY_MAX_CJK
        : OVERLAY_MAX_WORDS
      : cjk
        ? OVERLAY_SUB_MAX_CJK
        : OVERLAY_SUB_MAX_WORDS
  return { used, max, cjk }
}

// ---- 本機格子（靜態鏡頭、字卡、片名卡）：運鏡與要畫的卡 ----

/** 靜態圖的運鏡：慢推近、慢拉遠、鏡頭左移、鏡頭右移、不動。 */
export const STILL_MOTIONS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'none'] as const
export const StillMotionSchema = z.enum(STILL_MOTIONS)
export type StillMotion = z.infer<typeof StillMotionSchema>

/** 鏡頭上的運鏡預設（`shot.cameraMove`）→ 靜態圖的運鏡：推近、拉遠、搖鏡有對應，其他都是不動。 */
export function stillMotionOf(cameraMove: string | null | undefined): StillMotion {
  if (cameraMove === 'push_in') return 'zoom_in'
  if (cameraMove === 'pull_out') return 'zoom_out'
  if (cameraMove === 'pan') return 'pan_right'
  return 'none'
}

/** 要畫哪一種卡：字卡（文字加副文字）、片名卡（書名、作者、片尾那一行、封面素材、最底下一行小字）。 */
export const CardJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('card'),
    text: z.string(),
    subtext: z.string().optional(),
  }),
  z.object({
    kind: z.literal('title'),
    title: z.string(),
    author: z.string().optional(),
    endLine: z.string().optional(),
    coverAssetHash: z.string().optional(),
    /** 最底下一行小字（匯出時的 AI 服務標註，T9）。 */
    footnote: z.string().optional(),
  }),
  // 疊在不動畫面上的字（透明底的 PNG，只有字與暗帶）
  z.object({
    kind: z.literal('overlay'),
    text: z.string(),
    subtext: z.string().optional(),
  }),
])
export type CardJob = z.infer<typeof CardJobSchema>

// ---- 預告片設定 ----

/** 類型：story＝劇情型（小說、故事）、teaser＝懸念短版（15～30 秒，社群用）、idea＝觀點型（商業書、工具書、非虛構：沒有角色，字卡是主角）。 */
export const TrailerKindSchema = z.enum(['story', 'teaser', 'idea'])
export type TrailerKind = z.infer<typeof TrailerKindSchema>

export const TRAILER_MIN_TARGET_SEC = 10
export const TRAILER_MAX_TARGET_SEC = 120
/** 預設長度 30 秒（HQ 裁決 2026-11-12）。 */
export const TRAILER_DEFAULT_TARGET_SEC = 30

// 欄位各自定義一次：設定用的有預設值；更新用的（patch）沒有預設值——Zod 4 的 `.partial()` 還是會套預設值，
// 那會讓「只改一個欄位」的更新把其他欄位蓋回預設。
const TargetSecSchema = z.number().min(TRAILER_MIN_TARGET_SEC).max(TRAILER_MAX_TARGET_SEC)
const NameSchema = z.string().trim().max(100)
const LineSchema = z.string().trim().max(200)
const ClaimsSchema = z.array(z.string().trim().min(1).max(200)).max(20)

export const TrailerSettingsSchema = z.object({
  kind: TrailerKindSchema.default('story'),
  /** 目標總長（秒）：各格秒數加總要等於它。 */
  targetSec: TargetSecSchema.default(TRAILER_DEFAULT_TARGET_SEC),
  title: NameSchema.default(''),
  author: NameSchema.default(''),
  /** 標語。 */
  tagline: LineSchema.default(''),
  /** 片尾那一行：哪天上市、去哪裡買。 */
  endLine: LineSchema.default(''),
  /** 封面素材（內容雜湊）；沒有就沒有。 */
  coverAssetHash: ContentHashSchema.optional(),
  narration: z.boolean().default(true),
  music: z.boolean().default(true),
  /** 配樂情緒（自由文字，例如「緊張、壓迫」）。 */
  musicMood: LineSchema.default(''),
  /** 腳本附的配樂說明（有時間碼：開場留白、推進、片名前靜音、重音收尾）；寫腳本時產生，T6 做配樂時用。 */
  musicBrief: z.string().trim().max(2000).default(''),
  /** 寫腳本用的文本（重寫腳本時再用一次）。 */
  sourceText: z.string().max(60_000).default(''),
  /** 旁白與配樂已經自動加過的時間（ISO）；重新寫腳本就清掉，之後的「生成空的」再照設定加。 */
  soundAutoAddedAt: z.string().optional(),
  /** 腳本所在的場（寫腳本時建的「預告片」場）；重新寫腳本時取代這個場的鏡頭，其他鏡頭不動。 */
  sceneId: z.string().min(1).optional(),
  /**
   * 使用者自己提供的推薦語、獎項、銷量、名人背書的原文。字卡與旁白提到這類說法時，只能是這裡（或標語、片尾那一行）的原文
   * （規則 11：不編造）。
   */
  claims: ClaimsSchema.default([]),
})
export type TrailerSettings = z.infer<typeof TrailerSettingsSchema>

/** 更新設定：每個欄位都可以不給（不給就不動）；封面傳 null 代表拿掉。 */
export const TrailerSettingsPatchSchema = z.object({
  kind: TrailerKindSchema.optional(),
  targetSec: TargetSecSchema.optional(),
  title: NameSchema.optional(),
  author: NameSchema.optional(),
  tagline: LineSchema.optional(),
  endLine: LineSchema.optional(),
  coverAssetHash: ContentHashSchema.nullable().optional(),
  narration: z.boolean().optional(),
  music: z.boolean().optional(),
  musicMood: LineSchema.optional(),
  musicBrief: z.string().trim().max(2000).optional(),
  sourceText: z.string().max(60_000).optional(),
  soundAutoAddedAt: z.string().nullable().optional(),
  sceneId: z.string().min(1).nullable().optional(),
  claims: ClaimsSchema.optional(),
})
export type TrailerSettingsPatch = z.infer<typeof TrailerSettingsPatchSchema>

export const DEFAULT_TRAILER_SETTINGS: TrailerSettings = TrailerSettingsSchema.parse({})

// ---- 類型模板（資料） ----

/** 旁白密度：none＝這一段不說話、sparse＝一句或片語、normal＝每格一句短的。 */
export type NarrationDensity = 'none' | 'sparse' | 'normal'

export interface TrailerSegment {
  /** 段落的穩定代號（畫面上的名稱由介面文字檔給）。 */
  key: string
  /** 佔全片長度的比例；各段加總是 1。 */
  share: number
  narrationDensity: NarrationDensity
  /** 這一段最多幾張字卡（片名卡不算）。 */
  maxCards: number
}

export interface TrailerTemplate {
  kind: TrailerKind
  segments: readonly TrailerSegment[]
}

/**
 * 劇情型：開場鉤子＋三幕＋片名（規劃第 2.2 節 A）；懸念短版：最強畫面開場、快切夾字卡、片名（B）；
 * 觀點型：鉤子、核心主張、三個收穫、作者憑什麼、推薦語、封面與行動（C；這個六段是規劃自己設計的，不是業界結構）。
 */
export const TRAILER_TEMPLATES: Readonly<Record<TrailerKind, TrailerTemplate>> = {
  story: {
    kind: 'story',
    segments: [
      { key: 'hook', share: 0.13, narrationDensity: 'sparse', maxCards: 1 },
      { key: 'world', share: 0.2, narrationDensity: 'normal', maxCards: 0 },
      { key: 'turn', share: 0.17, narrationDensity: 'normal', maxCards: 0 },
      { key: 'escalate', share: 0.3, narrationDensity: 'sparse', maxCards: 2 },
      { key: 'suspense', share: 0.1, narrationDensity: 'sparse', maxCards: 1 },
      { key: 'title', share: 0.1, narrationDensity: 'none', maxCards: 0 },
    ],
  },
  teaser: {
    kind: 'teaser',
    segments: [
      { key: 'hook', share: 0.1, narrationDensity: 'none', maxCards: 0 },
      { key: 'montage', share: 0.73, narrationDensity: 'none', maxCards: 3 },
      { key: 'title', share: 0.17, narrationDensity: 'none', maxCards: 0 },
    ],
  },
  idea: {
    kind: 'idea',
    segments: [
      { key: 'hook', share: 0.15, narrationDensity: 'sparse', maxCards: 1 },
      { key: 'claim', share: 0.2, narrationDensity: 'normal', maxCards: 1 },
      { key: 'gains', share: 0.35, narrationDensity: 'normal', maxCards: 3 },
      { key: 'author', share: 0.12, narrationDensity: 'normal', maxCards: 1 },
      { key: 'praise', share: 0.08, narrationDensity: 'sparse', maxCards: 1 },
      { key: 'title', share: 0.1, narrationDensity: 'none', maxCards: 0 },
    ],
  },
}

// ---- 規則用的常數（規劃第 2.3 節） ----

/** 規則 1：各格秒數加總與目標相差不超過這麼多（秒）。 */
export const LENGTH_TOLERANCE_SEC = 0.05
/** 規則 2：第一格最長幾秒。 */
export const FIRST_BEAT_MAX_SEC = 4
/** 規則 4：旁白每秒最多幾個字（中文）／幾個單字（英文，約每分鐘 156 字）；有旁白的時間最多佔全片幾成。 */
export const NARRATION_MAX_CJK_PER_SEC = 4
export const NARRATION_MAX_WORDS_PER_SEC = 2.6
export const NARRATION_MAX_SHARE = 0.6
/** 規則 6：字卡每張最多幾個中文字／英文單字；全片最多幾張；停留秒數 ＝ 0.8 ＋ 字數 × 0.2。 */
export const CARD_MAX_CJK = 12
export const CARD_MAX_WORDS = 6
/** 全片字卡上限的預設值（劇情型、懸念短版）；觀點型的字卡是主角，上限另外算，見 `cardLimitOf`。 */
export const CARD_MAX_COUNT = 4
/** 觀點型的字卡上限：鉤子 1、核心主張 1、三個收穫 3、作者 1、推薦語 1。 */
export const IDEA_CARD_MAX_COUNT = 7
/** 觀點型的主視覺（用場景卡）要 3～5 個：太多每一個都要生成一張圖，太少看起來單調。 */
export const IDEA_VISUALS_MIN = 3
export const IDEA_VISUALS_MAX = 5
export const CARD_BASE_SEC = 0.8
export const CARD_SEC_PER_UNIT = 0.2
/** 疊字的格子比字卡的最短停留多停幾秒：字淡入、再看一眼畫面。 */
export const OVERLAY_STAY_EXTRA_SEC = 0.5
/** 觀點型的黑底字卡建議最多幾張（只提醒）：要讓人記住的句子改寫在畫面上（疊字）。 */
export const IDEA_BLACK_CARD_ADVISED = 2
/** 規則 7：片名卡最短幾秒。 */
export const TITLE_MIN_SEC = 3
/** 停太久的提醒（不擋）：字卡超過最短停留的幾倍、片名卡最長幾秒、第一格以外的畫面格最長幾秒。 */
export const CARD_HOLD_MAX_FACTOR = 2
export const TITLE_HOLD_MAX_SEC = 6
export const BEAT_HOLD_MAX_SEC = 6
/** 規則 3：最後三分之一的平均格長要不超過前三分之一的幾成（只提醒）；至少幾格才比。 */
export const ESCALATION_RATIO = 0.6
export const ESCALATION_MIN_BEATS = 6
/** 懸念短版是給社群看的：目標最長幾秒（畫面只列 15、30 秒；後端也擋超過的，Claude 透過 MCP 也一樣）。 */
export const TEASER_MAX_SEC = 30
/** 畫面格（影片、靜態）的最短秒數：再短看不清楚。 */
export const MIN_BEAT_SEC = 0.75
/** 會動的格子最短幾秒：再短就只是影片的一個開頭，付一整段影片的錢用不到；比這短的改成不動的畫面。 */
export const MIN_MOVING_BEAT_SEC = 1.5

const EPS = 1e-9
const HAN = /\p{Script=Han}/u
const WORD_CHAR = /[\p{L}\p{N}]/u

/** 有中文就一個字算一個（不算標點與空白）；沒有中文就算單字。 */
export function textUnits(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  if (HAN.test(trimmed)) return trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  return trimmed.split(/\s+/).filter((word) => WORD_CHAR.test(word)).length
}

const hasHan = (text: string): boolean => HAN.test(text)

// ---- 檢查器 ----

/** 檢查器看的一格。跟資料庫的鏡頭欄位同名：`beatKind`、`durationSec`、`dialogue`、`card`。 */
export interface TrailerBeat {
  beatKind: BeatKind
  durationSec: number
  /** 旁白念的句子（只有 video、still 算旁白）。 */
  dialogue?: string | undefined
  card?: { text: string; subtext?: string | undefined } | undefined
  /** 疊在不動的畫面上的字（只有 still 可以有）。 */
  overlay?: { text: string; subtext?: string | undefined } | undefined
  /** 這一格屬於模板的哪一段（`TrailerSegment.key`）；規則 3 用它略過「懸念」那一格。可以不填。 */
  segment?: string | undefined
  /** 這一格的地點（名字或代號，同一個地方要一樣）；觀點型用它數「主視覺」有幾個。可以不填。 */
  location?: string | undefined
}

/** 全片字卡最多幾張（片名卡不算）：依類型。 */
export function cardLimitOf(kind: TrailerKind): number {
  return kind === 'idea' ? IDEA_CARD_MAX_COUNT : CARD_MAX_COUNT
}

export type TrailerIssueCode =
  | 'empty'
  | 'length'
  | 'first_beat_not_picture'
  | 'first_beat_too_long'
  | 'beat_too_short'
  | 'moving_beat_too_short'
  | 'narration_too_dense'
  | 'narration_share'
  | 'narration_one_sentence'
  | 'card_empty'
  | 'card_too_long'
  | 'card_too_short'
  | 'too_many_cards'
  | 'no_title'
  | 'title_too_short'
  | 'title_missing_name'
  | 'title_no_action'
  | 'unverified_claim'
  | 'no_escalation'
  | 'overlay_too_long'
  | 'overlay_short_stay'
  | 'overlay_wrong_kind'
  | 'overlay_narration_differs'
  | 'many_black_cards'
  | 'unverified_author'
  | 'too_many_visuals'
  | 'few_visuals'
  | 'card_hold_too_long'
  | 'title_hold_too_long'
  | 'beat_hold_too_long'

export interface TrailerIssue {
  code: TrailerIssueCode
  /** 第幾格（從 0 開始）；整份腳本的問題沒有這個欄位。 */
  index?: number
  /** 白話說明（跟著介面語言），退回給寫腳本的 AI 重寫時用這個（一字不改，有雜湊與已存專案的快取靠它）。 */
  message: string
  /** 給使用者看的短版；沒有就直接顯示 `message`。 */
  userMessage?: string | undefined
}

export interface TrailerCheckResult {
  /** 要擋、要退回重寫的。 */
  errors: TrailerIssue[]
  /** 只提醒。 */
  warnings: TrailerIssue[]
  /** 成品實際總長（每格先對齊到整數格再加總）。 */
  totalSec: number
}

/**
 * 疊字的格子最短停留秒數：字卡的最短停留，再加淡入與看一眼畫面的 0.5 秒。
 * 旁白照念這一句（`narrated`）時，再跟「用這個語言的旁白速度念完要的秒數」比，取比較大的
 * （中文每秒 4 個字、英文每秒 2.6 個單字：英文 12 個單字念完要 4.6 秒，比字卡規則的 3.7 秒長）。
 */
export function overlayMinSec(
  overlay: { text: string; subtext?: string | undefined },
  narrated = false,
): number {
  const stay = cardMinSec(overlay) + OVERLAY_STAY_EXTRA_SEC
  if (!narrated) return stay
  const speed = hasHan(overlay.text) ? NARRATION_MAX_CJK_PER_SEC : NARRATION_MAX_WORDS_PER_SEC
  return Math.max(stay, textUnits(overlay.text) / speed)
}

/** 字卡最短停留秒數：0.8 ＋ 字數 × 0.2（主文字與副文字都算）。 */
export function cardMinSec(card: { text: string; subtext?: string | undefined }): number {
  return CARD_BASE_SEC + CARD_SEC_PER_UNIT * (textUnits(card.text) + textUnits(card.subtext ?? ''))
}

/** 規則 11 要小心的說法：暢銷、獎項、銷量、名人背書。 */
const CLAIM_PATTERN =
  /暢銷|銷量|萬冊|榜首|排行榜|得獎|獲獎|金獎|大獎|獎項|入圍|盛讚|好評如潮|名人推薦|best-?sell|award|prize|winner|million copies|#\s?1\b/i

const normalize = (text: string): string => text.replace(/[\s\p{P}]/gu, '').toLowerCase()

/** 一句一句切開（只切中文句號、驚嘆號、問號與後面接空白的英文句點）。 */
const sentencesOf = (text: string): string[] =>
  text
    .split(/[。！？!?]+|\.(?=\s|$)/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')

const frameSec = (durationSec: number, fps: number): number => Math.round(durationSec * fps) / fps

/**
 * 預告片腳本檢查器（規劃第 2.3 節）。回 errors（要擋）與 warnings（只提醒）。
 * errors：規則 1 長度、2 第一格、4 旁白密度、6 字卡、7 片名卡、11 不編造；warnings：規則 3 一路升高，以及片名卡沒有行動資訊。
 * 每格秒數先對齊到整數格再算（成品每段都是整數格，見 `buildConcatFilters`）。
 */
export function checkTrailerScript(
  beats: readonly TrailerBeat[],
  settings: TrailerSettings,
  fps: number,
): TrailerCheckResult {
  const errors: TrailerIssue[] = []
  const warnings: TrailerIssue[] = []
  const secs = beats.map((beat) => frameSec(beat.durationSec, fps))
  const totalSec = secs.reduce((sum, s) => sum + s, 0)
  const num = (index: number) => ({ n: index + 1 })
  const error = (code: TrailerIssueCode, message: string, index?: number, userMessage?: string) => {
    errors.push({
      code,
      message,
      ...(index === undefined ? {} : { index }),
      ...(userMessage === undefined ? {} : { userMessage }),
    })
  }

  if (beats.length === 0) {
    error('empty', t('trailer.ruleEmpty'))
    return { errors, warnings, totalSec }
  }

  // 規則 1：長度
  const diff = Math.abs(totalSec - settings.targetSec)
  if (diff > LENGTH_TOLERANCE_SEC + EPS) {
    const lengthArgs = {
      total: totalSec.toFixed(1),
      target: String(settings.targetSec),
      diff: diff.toFixed(1),
    }
    error(
      'length',
      t('trailer.ruleLength', lengthArgs),
      undefined,
      t('trailer.userRuleLength', lengthArgs),
    )
  }

  // 規則 2：第一格是畫面、4 秒以內
  const first = beats[0]
  if (first) {
    if (first.beatKind === 'card' || first.beatKind === 'title') {
      error('first_beat_not_picture', t('trailer.ruleFirstNotPicture'), 0)
    } else if ((secs[0] ?? 0) > FIRST_BEAT_MAX_SEC + EPS) {
      error(
        'first_beat_too_long',
        t('trailer.ruleFirstTooLong', {
          sec: (secs[0] ?? 0).toFixed(1),
          max: String(FIRST_BEAT_MAX_SEC),
        }),
        0,
      )
    }
  }

  // 格子最短：畫面格至少 0.75 秒（錯，要退回）；會動的至少 1.5 秒（只提醒，建議改成不動）
  beats.forEach((beat, index) => {
    if (beat.beatKind !== 'video' && beat.beatKind !== 'still') return
    const sec = secs[index] ?? 0
    if (sec < MIN_BEAT_SEC - EPS) {
      error(
        'beat_too_short',
        t('trailer.ruleBeatTooShort', {
          ...num(index),
          sec: sec.toFixed(2),
          min: String(MIN_BEAT_SEC),
        }),
        index,
      )
    } else if (beat.beatKind === 'video' && sec < MIN_MOVING_BEAT_SEC - EPS) {
      warnings.push({
        code: 'moving_beat_too_short',
        index,
        message: t('trailer.warnMovingTooShort', {
          ...num(index),
          sec: sec.toFixed(2),
          min: String(MIN_MOVING_BEAT_SEC),
        }),
      })
    }
  })

  // 規則 4：旁白密度（只有影片、靜態格有旁白）
  let narratedSec = 0
  beats.forEach((beat, index) => {
    const text = (beat.dialogue ?? '').trim()
    if (text === '' || beat.beatKind === 'card' || beat.beatKind === 'title') return
    const sec = secs[index] ?? 0
    narratedSec += sec
    const units = textUnits(text)
    const perSec = hasHan(text) ? NARRATION_MAX_CJK_PER_SEC : NARRATION_MAX_WORDS_PER_SEC
    const limit = Math.floor(perSec * sec + EPS)
    if (units > perSec * sec + EPS) {
      const denseArgs = {
        ...num(index),
        units: String(units),
        sec: sec.toFixed(1),
        limit: String(limit),
      }
      error(
        'narration_too_dense',
        t('trailer.ruleNarrationDense', denseArgs),
        index,
        t('trailer.userRuleNarrationDense', denseArgs),
      )
    }
    if (sentencesOf(text).length > 1) {
      error('narration_one_sentence', t('trailer.ruleNarrationOneSentence', num(index)), index)
    }
  })
  if (narratedSec > NARRATION_MAX_SHARE * totalSec + EPS) {
    const shareArgs = {
      sec: narratedSec.toFixed(1),
      limit: (NARRATION_MAX_SHARE * totalSec).toFixed(1),
    }
    error(
      'narration_share',
      t('trailer.ruleNarrationShare', shareArgs),
      undefined,
      t('trailer.userRuleNarrationShare', shareArgs),
    )
  }

  // 規則 6：字卡（上限依類型：觀點型的字卡是主角）
  const cardLimit = cardLimitOf(settings.kind)
  let cardCount = 0
  beats.forEach((beat, index) => {
    if (beat.beatKind !== 'card') return
    cardCount++
    const text = (beat.card?.text ?? '').trim()
    if (text === '' || !beat.card) {
      error('card_empty', t('trailer.ruleCardEmpty', num(index)), index)
      return
    }
    const units = textUnits(text)
    const limit = hasHan(text) ? CARD_MAX_CJK : CARD_MAX_WORDS
    if (units > limit) {
      error(
        'card_too_long',
        t('trailer.ruleCardTooLong', { ...num(index), units: String(units), limit: String(limit) }),
        index,
      )
    }
    const min = cardMinSec(beat.card)
    if ((secs[index] ?? 0) < min - EPS) {
      error(
        'card_too_short',
        t('trailer.ruleCardTooShort', {
          ...num(index),
          sec: (secs[index] ?? 0).toFixed(1),
          min: min.toFixed(1),
        }),
        index,
      )
    }
  })

  // 疊字：只有「不動」的格子可以有；字數、停留、旁白都有規定（金句壓在畫面上，不是另外一張黑底字卡）
  beats.forEach((beat, index) => {
    const overlay = beat.overlay
    if (!overlay || overlay.text.trim() === '') return
    if (beat.beatKind !== 'still') {
      error('overlay_wrong_kind', t('trailer.ruleOverlayWrongKind', num(index)), index)
      return
    }
    const mainSize = overlaySize(overlay.text, 'text')
    const subSize = overlaySize(overlay.subtext ?? '', 'sub')
    if (mainSize.used > mainSize.max || subSize.used > subSize.max) {
      const over = mainSize.used > mainSize.max ? mainSize : subSize
      error(
        'overlay_too_long',
        t('trailer.ruleOverlayTooLong', {
          ...num(index),
          units: String(over.used),
          limit: String(over.max),
        }),
        index,
      )
    }
    // 開了旁白又念這一句：最短停留要夠旁白念完（英文比中文慢）
    const min = overlayMinSec(overlay, settings.narration && (beat.dialogue ?? '').trim() !== '')
    if ((secs[index] ?? 0) < min - EPS) {
      error(
        'overlay_short_stay',
        t('trailer.ruleOverlayShortStay', {
          ...num(index),
          sec: (secs[index] ?? 0).toFixed(1),
          min: min.toFixed(1),
        }),
        index,
      )
    }
    const spoken = (beat.dialogue ?? '').trim()
    if (settings.narration && spoken !== '' && normalize(spoken) !== normalize(overlay.text)) {
      error('overlay_narration_differs', t('trailer.ruleOverlayNarration', num(index)), index)
    }
  })

  // 字卡總數：黑底字卡和有疊字的格子加起來算（金句壓在畫面上也是一句話）
  {
    let sentences = 0
    beats.forEach((beat, index) => {
      const hasOverlay = (beat.overlay?.text ?? '').trim() !== ''
      if (beat.beatKind !== 'card' && !hasOverlay) return
      sentences++
      if (sentences === cardLimit + 1) {
        error('too_many_cards', t('trailer.ruleTooManyCards', { limit: String(cardLimit) }), index)
      }
    })
  }
  if (settings.kind === 'idea' && cardCount > IDEA_BLACK_CARD_ADVISED) {
    warnings.push({
      code: 'many_black_cards',
      message: t('trailer.warnManyBlackCards', {
        count: String(cardCount),
        max: String(IDEA_BLACK_CARD_ADVISED),
      }),
    })
  }

  // 規則 7：片名卡
  const titleIndexes = beats.flatMap((beat, index) => (beat.beatKind === 'title' ? [index] : []))
  if (titleIndexes.length === 0) error('no_title', t('trailer.ruleNoTitle'))
  for (const index of titleIndexes) {
    if ((secs[index] ?? 0) < TITLE_MIN_SEC - EPS) {
      error(
        'title_too_short',
        t('trailer.ruleTitleTooShort', {
          ...num(index),
          sec: (secs[index] ?? 0).toFixed(1),
          min: String(TITLE_MIN_SEC),
        }),
        index,
      )
    }
  }
  if (settings.title.trim() === '') error('title_missing_name', t('trailer.ruleTitleMissingName'))
  if (settings.endLine.trim() === '') {
    warnings.push({ code: 'title_no_action', message: t('trailer.ruleTitleNoAction') })
  }

  // 規則 11：不編造（推薦語、獎項、銷量、名人背書只能是使用者提供的原文）
  const allowed = [
    ...settings.claims,
    settings.tagline,
    settings.endLine,
    settings.title,
    settings.author,
  ]
    .map(normalize)
    .filter((s) => s !== '')
  beats.forEach((beat, index) => {
    const narrated = beat.beatKind === 'video' || beat.beatKind === 'still'
    const texts = [
      beat.card?.text,
      beat.card?.subtext,
      narrated ? beat.dialogue : undefined,
      beat.overlay?.text,
      beat.overlay?.subtext,
    ]
    // 觀點型的「推薦語」那一段：整段都只能是使用者給的原文（不只是看起來像推薦語的字）
    const quoted = settings.kind === 'idea' && beat.segment === 'praise'
    const invented = texts.some((text) => {
      const value = (text ?? '').trim()
      if (value === '' || !(quoted || CLAIM_PATTERN.test(value))) return false
      const flat = normalize(value)
      return !allowed.some((source) => source.includes(flat))
    })
    if (invented) {
      error(
        'unverified_claim',
        t('trailer.ruleUnverifiedClaim', num(index)),
        index,
        t('trailer.userRuleUnverifiedClaim', num(index)),
      )
    }
  })

  // 觀點型的「作者憑什麼」那一段（作者經歷）：比照推薦語，只能是使用者給的字（作者欄、推薦語、標語…）或文本裡明明寫著的原文
  if (settings.kind === 'idea') {
    const bioSources = [...allowed, normalize(settings.sourceText)].filter((s) => s !== '')
    beats.forEach((beat, index) => {
      if (beat.segment !== 'author') return
      const narrated = beat.beatKind === 'video' || beat.beatKind === 'still'
      const texts = [
        beat.card?.text,
        beat.card?.subtext,
        narrated ? beat.dialogue : undefined,
        beat.overlay?.text,
        beat.overlay?.subtext,
      ]
      const invented = texts.some((text) => {
        const value = (text ?? '').trim()
        if (value === '') return false
        // 「作者：某某」「by 某某」前面的稱呼不算
        const flat = normalize(value).replace(/^(作者|by)/, '')
        return !bioSources.some((source) => source.includes(flat))
      })
      if (invented) {
        error('unverified_author', t('trailer.ruleUnverifiedAuthor', num(index)), index)
      }
    })
  }

  // 觀點型：主視覺（地點）3～5 個（短片放不下那麼多：15 秒約 1 個、20 秒約 2 個）
  if (settings.kind === 'idea') {
    const minVisuals = Math.min(IDEA_VISUALS_MIN, Math.max(1, Math.floor(settings.targetSec / 8)))
    const visuals = new Set(
      beats.flatMap((beat) =>
        (beat.beatKind === 'video' || beat.beatKind === 'still') && (beat.location ?? '') !== ''
          ? [(beat.location ?? '').trim().toLowerCase()]
          : [],
      ),
    )
    if (visuals.size > IDEA_VISUALS_MAX) {
      error(
        'too_many_visuals',
        t('trailer.ruleTooManyVisuals', {
          count: String(visuals.size),
          max: String(IDEA_VISUALS_MAX),
        }),
      )
    } else if (visuals.size > 0 && visuals.size < minVisuals) {
      warnings.push({
        code: 'few_visuals',
        message: t('trailer.ruleFewVisuals', {
          count: String(visuals.size),
          min: String(minVisuals),
        }),
      })
    }
  }

  // 規則 3：一路升高（只提醒）。片名卡與「懸念」那一格不算。觀點型是講道理，節奏平沒關係，不比。
  const counted = beats.flatMap((beat, index) =>
    beat.beatKind === 'title' || beat.segment === 'suspense' ? [] : [secs[index] ?? 0],
  )
  if (settings.kind !== 'idea' && counted.length >= ESCALATION_MIN_BEATS) {
    const third = Math.floor(counted.length / 3)
    const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length
    const head = avg(counted.slice(0, third))
    const tail = avg(counted.slice(counted.length - third))
    if (tail > ESCALATION_RATIO * head + EPS) {
      warnings.push({
        code: 'no_escalation',
        message: t('trailer.ruleNoEscalation', { first: head.toFixed(1), last: tail.toFixed(1) }),
      })
    }
  }

  // 停太久（只提醒）：字很少的字卡、片名卡、第一格以外的畫面格停得太長，節奏就拖住了
  beats.forEach((beat, index) => {
    const sec = secs[index] ?? 0
    if (beat.beatKind === 'card' && beat.card) {
      const max = CARD_HOLD_MAX_FACTOR * cardMinSec(beat.card)
      if (sec > max + EPS) {
        warnings.push({
          code: 'card_hold_too_long',
          index,
          message: t('trailer.warnCardHoldTooLong', {
            ...num(index),
            sec: sec.toFixed(1),
            max: max.toFixed(1),
          }),
        })
      }
    } else if (beat.beatKind === 'title') {
      if (sec > TITLE_HOLD_MAX_SEC + EPS) {
        warnings.push({
          code: 'title_hold_too_long',
          index,
          message: t('trailer.warnTitleHoldTooLong', {
            sec: sec.toFixed(1),
            max: String(TITLE_HOLD_MAX_SEC),
          }),
        })
      }
    } else if (index > 0 && sec > BEAT_HOLD_MAX_SEC + EPS) {
      warnings.push({
        code: 'beat_hold_too_long',
        index,
        message: t('trailer.warnBeatHoldTooLong', {
          ...num(index),
          sec: sec.toFixed(1),
          max: String(BEAT_HOLD_MAX_SEC),
        }),
      })
    }
  })

  return { errors, warnings, totalSec }
}

// ---- fitToTarget ----

/** 一格調長度時最少要幾格（frame）：字卡照停留秒數、片名卡 3 秒、其他（影片、靜態）0.75 秒。 */
export function beatMinFrames(
  beat: Pick<TrailerBeat, 'beatKind' | 'card' | 'overlay' | 'dialogue'>,
  fps: number,
): number {
  if (beat.beatKind === 'title') return Math.ceil(TITLE_MIN_SEC * fps - EPS)
  if (beat.beatKind === 'card') {
    const sec = beat.card ? cardMinSec(beat.card) : CARD_BASE_SEC
    return Math.ceil(sec * fps - EPS)
  }
  // 疊字的格子：字卡的最短停留再加 0.5 秒（不動的格子才有疊字）
  if (beat.beatKind === 'still' && beat.overlay && beat.overlay.text.trim() !== '') {
    return Math.ceil(overlayMinSec(beat.overlay, (beat.dialogue ?? '').trim() !== '') * fps - EPS)
  }
  return Math.ceil(MIN_BEAT_SEC * fps - EPS)
}

export interface FitResult {
  /** 每一格的新秒數（整數格／fps）。 */
  durations: number[]
  /** false＝每一格的最短秒數加起來就超過目標，放不下：這時每格取最短秒數，加總會比目標長。 */
  ok: boolean
}

/**
 * 把每一格的秒數調成：每格都是 1/fps 的整數倍、加總剛好等於目標、字卡與片名卡不低於最短秒數。
 * 照原本的比例分配；被壓到最短的格子就停在最短，多出來的時間由其他格按比例分攤；最後用最大餘數法湊整格數。
 */
export function fitToTarget(
  beats: readonly Pick<TrailerBeat, 'beatKind' | 'durationSec' | 'card' | 'overlay' | 'dialogue'>[],
  targetSec: number,
  fps: number,
): FitResult {
  if (beats.length === 0) return { durations: [], ok: false }
  const total = Math.round(targetSec * fps)
  const mins = beats.map((beat) => beatMinFrames(beat, fps))
  const minSum = mins.reduce((sum, f) => sum + f, 0)
  if (minSum > total) return { durations: mins.map((f) => f / fps), ok: false }

  const weights = beats.map((beat) =>
    Number.isFinite(beat.durationSec) && beat.durationSec > 0 ? beat.durationSec : 1,
  )
  const frames: number[] = mins.slice()
  const fractions: number[] = beats.map(() => 0)
  let free = beats.map((_, i) => i)
  let remaining = total
  // 被壓到最短的格子固定在最短，其餘的重新分配，直到沒有格子低於自己的最短秒數
  for (;;) {
    const weightSum = free.reduce((sum, i) => sum + (weights[i] ?? 1), 0)
    const shares = free.map((i) => (remaining * (weights[i] ?? 1)) / weightSum)
    const low = free.filter((_, k) => (shares[k] ?? 0) < (mins[free[k] ?? 0] ?? 0) - EPS)
    if (low.length === 0) {
      free.forEach((i, k) => {
        const share = shares[k] ?? 0
        const base = Math.max(Math.floor(share + EPS), mins[i] ?? 0)
        frames[i] = base
        fractions[i] = share - base
      })
      break
    }
    for (const i of low) {
      frames[i] = mins[i] ?? 0
      remaining -= mins[i] ?? 0
    }
    free = free.filter((i) => !low.includes(i))
  }
  // 最大餘數法：還差幾格，就補給小數部分最大的格子
  let leftover = total - frames.reduce((sum, f) => sum + f, 0)
  const order = free.slice().sort((a, b) => (fractions[b] ?? 0) - (fractions[a] ?? 0) || a - b)
  for (let k = 0; leftover > 0 && order.length > 0; k = (k + 1) % order.length) {
    const i = order[k] ?? 0
    frames[i] = (frames[i] ?? 0) + 1
    leftover--
  }
  return { durations: frames.map((f) => f / fps), ok: true }
}

export interface FitAroundResult {
  /** 每一格的新秒數（整數格／fps）；ok 為 false 時沒有意義。 */
  durations: number[]
  ok: boolean
  /** ok 為 false 時：固定的那一格最多能到幾秒（其他格都已經是最短）；其他情況沒有。 */
  maxSec?: number
}

/**
 * 固定幾格的秒數（`pins`：格子序號 → 秒數），其餘的格子用 `fitToTarget` 重排成「目標 − 固定的那幾格」，
 * 總長不變。固定的秒數也對齊 1/fps，字卡與片名卡不低於最短停留。其餘的格子排不下時 ok 是 false，
 * 並說固定的第一格最多能到幾秒；這時沒有任何一格被動到，由呼叫的人決定要不要改。
 */
export function fitAround(
  beats: readonly Pick<TrailerBeat, 'beatKind' | 'durationSec' | 'card'>[],
  pins: ReadonlyMap<number, number>,
  targetSec: number,
  fps: number,
): FitAroundResult {
  const total = Math.round(targetSec * fps)
  const pinned = new Map<number, number>()
  for (const [index, sec] of pins) {
    const beat = beats[index]
    if (beat) pinned.set(index, Math.max(Math.round(sec * fps), beatMinFrames(beat, fps)))
  }
  const restIndexes = beats.map((_, i) => i).filter((i) => !pinned.has(i))
  const rest = restIndexes.flatMap((i) => (beats[i] ? [beats[i]] : []))
  const pinnedSum = [...pinned.values()].reduce((sum, f) => sum + f, 0)
  const restMin = rest.reduce((sum, beat) => sum + beatMinFrames(beat, fps), 0)
  const firstPinned = pinned.values().next().value ?? 0
  if (rest.length === 0 || total - pinnedSum < restMin) {
    const ok = rest.length === 0 && pinnedSum === total
    return {
      durations: beats.map((b, i) => (pinned.get(i) ?? Math.round(b.durationSec * fps)) / fps),
      ok,
      ...(ok ? {} : { maxSec: Math.max(0, total - restMin - (pinnedSum - firstPinned)) / fps }),
    }
  }
  const fit = fitToTarget(rest, (total - pinnedSum) / fps, fps)
  const durations = beats.map((_, i) => (pinned.get(i) ?? 0) / fps)
  restIndexes.forEach((beatIndex, k) => {
    durations[beatIndex] = fit.durations[k] ?? 0
  })
  return { durations, ok: fit.ok }
}

// ---- 預告片準則（內建，先不開放在設定頁改；第二階段再開放） ----

/**
 * 預告片準則：寫腳本的 AI 照著做、寫完由 `checkTrailerScript` 檢查，不過就退回重寫。
 * 中文與英文各一份，跟著介面語言挑。數字都是 `checkTrailerScript` 的常數，改一邊要改另一邊（測試會看）。
 */
export const DEFAULT_TRAILER_GUIDE = `1. 預告片不是把故事講完
目的是讓人想看那個故事。只給處境、賭注和一個問題，不給答案。小說只用前三分之一的情節，不揭露結局與反轉。

2. 長度要剛好
每一格的秒數加總，要等於使用者選的長度，誤差不超過 0.05 秒。成品每一格都是整數格，所以秒數要算到那一格。

3. 第一格是畫面
第一格必須是畫面（影片或靜態畫面），不能是字卡或片名卡，也不放 logo；最長 4 秒。前幾秒就要有鉤子。

4. 越來越快，然後停一拍
一路把強度堆高：後面三分之一的平均格長，要不超過前三分之一的 60%。片名之前可以停一拍（只用一次）。

5. 旁白只講處境、賭注、問題
每格最多一句，句子不跨格。中文每秒最多 4 個字，英文每秒最多 2.6 個單字（約每分鐘 156 字）。有旁白的時間加起來不超過全片的 60%，可以整段不說話。

6. 字卡是主角之一，但要短
每張字卡最多 12 個中文字（英文 6 個單字）；停留秒數至少 0.8 秒加上每個字 0.2 秒，12 個字要停 3.2 秒。全片最多 4 張（片名卡不算）。

7. 片名卡收尾
片名卡至少 3 秒，放書名，有封面就放封面原圖，並放上「哪天上市、去哪裡買」這類行動資訊。

8. 關掉聲音也看得懂
只看字卡，也要知道這是什麼書、為什麼想看。

9. 不編造
推薦語、獎項、銷量、名人背書，只能用使用者自己提供的原文；沒填就沒有那一格。

10. 畫面裡不生成文字
圖片與影片的提示一律寫「畫面中沒有文字」，所有的字都用字卡。

11. 替影片模型著想
一格只做一件事。會動的格子優先選遠景、剪影、物件與環境，少用臉部特寫。

12. 配樂
純音樂、不要人聲；依照腳本的時間寫成開場留白、推進、片名前的短暫靜音、重音收尾。`

export const DEFAULT_TRAILER_GUIDE_EN = `1. A trailer is not the whole story
The goal is to make people want the story. Give the situation, the stakes and one question, never the answer. For a novel, use only the first third of the plot; do not reveal the ending or the twists.

2. Hit the length exactly
The seconds of all shots add up to the length the user picked, within 0.05 seconds. Every shot in the final film is a whole number of frames, so work the seconds out to that frame.

3. The first shot is a picture
The first shot must be a picture (video or a still), never a text card or the title card, and no logo. At most 4 seconds. Hook people in the first seconds.

4. Faster and faster, then one beat of silence
Keep raising the intensity: the average shot length in the last third should be at most 60% of the first third. You may stop for one beat before the title (use it once).

5. Narration gives the situation, the stakes, the question
At most one sentence per shot, and no sentence runs across shots. At most 4 characters per second in Chinese and 2.6 words per second in English (about 156 words per minute). The time with narration adds up to at most 60% of the film; whole stretches may be silent.

6. Text cards are a lead character, but keep them short
At most 12 Chinese characters (6 English words) per card; hold time is at least 0.8 seconds plus 0.2 seconds per character, so 12 characters stay 3.2 seconds. At most 4 cards in the whole film (the title card does not count).

7. End on the title card
At least 3 seconds. Show the book title, the cover as it is if there is one, and a line of action such as the release date or where to buy.

8. It must work with the sound off
From the text cards alone, people should know what the book is and why they would want it.

9. Never invent
Blurbs, awards, sales figures and endorsements come only from text the user provided; if the user gave none, there is no such shot.

10. No generated text inside pictures
Every picture and video prompt says "no text in the picture"; all words go on text cards.

11. Think of the video model
One action per shot. Moving shots prefer wide shots, silhouettes, objects and environments over close-ups of faces.

12. Music
Instrumental only, no vocals; write it along the script's timeline as a quiet open, a build, a short silence before the title, and a final hit.`

/** 目前介面語言對應的預告片準則：繁體中文用中文版，其他用英文版。 */
export function defaultTrailerGuide(locale: Locale = getLocale()): string {
  return locale === 'zh-TW' ? DEFAULT_TRAILER_GUIDE : DEFAULT_TRAILER_GUIDE_EN
}
