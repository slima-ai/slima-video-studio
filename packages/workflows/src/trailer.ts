import {
  AppError,
  CAMERA_MOVES,
  CARD_BASE_SEC,
  CARD_MAX_CJK,
  CARD_MAX_COUNT,
  CARD_MAX_WORDS,
  CARD_SEC_PER_UNIT,
  FIRST_BEAT_MAX_SEC,
  NARRATION_MAX_CJK_PER_SEC,
  NARRATION_MAX_SHARE,
  NARRATION_MAX_WORDS_PER_SEC,
  TITLE_MIN_SEC,
  TRAILER_REQUEST_MARK,
  TRAILER_TEMPLATES,
  type TrailerKind,
  TrailerScriptSchema,
  checkTrailerScript,
  fitToTarget,
  snapToFrame,
  storyLanguageNote,
  t,
  textUnits,
  type TrailerBeat,
  type TrailerCheckResult,
  type TrailerScript,
  type TrailerScriptBeat,
  type TrailerSettings,
} from '@svs/schema'

import { LOCAL_BEAT_FPS } from './nodes'
import { QUICK_STYLES, type QuickStyleId } from './styles'
import type { GenerateContext, StudioServices } from './services'
import { generateStructured } from './structured'

// 寫預告片腳本（T5）：文本＋預告片設定 → 一串格子，加起來剛好等於目標秒數。
// 流程：AI 寫 → 檢查器檢查 → 有錯就把錯誤退回重寫一次 → 還有錯就用程式修正（截字、調秒數）→ 再檢查，還不過就丟白話錯誤。
// 不管走哪條路，回傳的腳本加總一定等於目標（過不了就不回傳）。

/**
 * 地點外觀的要求（寫進 system prompt；用雜湊釘住）。場景卡的說明會帶進發生在這個地點的每一鏡，
 * 所以只能寫地方本身：寫了人或動作，每一鏡都會多出那個人在做那件事。
 */
export const PLACE_LOOK_INSTRUCTION =
  'places 欄位：location 裡用到的每個地點各寫一筆 { name, look }，name 跟 location 一模一樣；look 是這個地方本身的外觀（材質、光線、氣氛，一兩句），絕對不要寫人、角色、動作或正在發生的事，也不要寫畫面裡的文字。'

const SEGMENT_NAMES: Readonly<Record<string, string>> = {
  hook: '鉤子（全片最強的畫面，第一格不放字卡）',
  world: '世界與主角（誰、在哪裡、平常的樣子）',
  turn: '轉折（出事的那一刻）',
  escalate: '升高（快切，每格 1.5～2.5 秒，旁白只剩片語或整段不說話）',
  suspense: '懸念（一個定住的畫面，一個問題或一句沒說完的話；可以停一拍）',
  montage: '快切（3～5 個畫面夾幾張短字卡，字卡合起來是一個問題）',
  title: '片名與行動（片名卡，什麼都不用寫）',
}

const DENSITY_TEXT = {
  none: '不說話',
  sparse: '旁白只有片語或一句',
  normal: '每格一句短的旁白',
} as const

const SIZE_HINTS =
  'size 只能是：extreme_wide、wide、full、medium、close_up、extreme_close_up（會動的格子優先用遠景、剪影、物件、環境）'
const ANGLE_HINTS =
  'angle 只能是：eye_level、high、low、overhead、over_shoulder、side、back、dutch；平常用 eye_level'

/** 目標秒數寫成「30」「7.5」。 */
const secText = (sec: number): string => String(Math.round(sec * 100) / 100)

/** 寫腳本給文字模型的 system prompt。故事不是中文時多一句「用故事的語言寫」；中文的內容不變。 */
export function trailerSystemPrompt(input: {
  text: string
  settings: TrailerSettings
  guide: string
  knownCharacters: readonly string[]
  /** 已經建好的場景卡名字：同一個地方要用一模一樣的名字（沿用既有的卡）。 */
  knownLocations?: readonly string[]
  style: QuickStyleId
}): string {
  const { settings } = input
  const template = TRAILER_TEMPLATES[settings.kind]
  const outline = template.segments
    .map(
      (segment) =>
        `${segment.key}＝${SEGMENT_NAMES[segment.key] ?? segment.key}，約 ${secText(segment.share * settings.targetSec)} 秒，${DENSITY_TEXT[segment.narrationDensity]}，字卡最多 ${String(segment.maxCards)} 張`,
    )
    .join('；')
  const given = [
    settings.title ? `書名「${settings.title}」（title 欄位照這個寫）` : '',
    settings.author ? `作者「${settings.author}」` : '',
    settings.tagline ? `標語「${settings.tagline}」：放成一張字卡，字一個都不要改` : '',
    settings.endLine ? `片尾那一行「${settings.endLine}」（片名卡會放，你不用寫）` : '',
    settings.musicMood ? `配樂情緒：${settings.musicMood}` : '',
  ].filter((line) => line !== '')
  return (
    '你是書籍預告片的腳本助手。讀使用者給的文本，寫一支預告片的腳本：一串依序排列的格子（beats），每一格有種類與秒數。' +
    '預告片的目的是讓人想看那個故事：只給處境、賭注和一個問題，不給答案，不講劇情摘要。' +
    `格子種類 beatKind 只有四種：video（會動的畫面）、still（一張靜態畫面慢慢推近或拉遠）、card（只有字的字卡）、title（片名卡，最後一格，只放書名與行動，不用寫其他欄位）。` +
    `類型是「${settings.kind === 'story' ? '劇情型' : '懸念短版'}」，依序分成這幾段：${outline}。每一格的 segment 填段落代號。` +
    `目標總長 ${secText(settings.targetSec)} 秒：所有格子的 durationSec 加起來必須剛好等於 ${secText(settings.targetSec)}，每格秒數是 1/${String(LOCAL_BEAT_FPS)} 秒的整數倍（例如 2.5、0.75）。` +
    `第一格必須是畫面（video 或 still），不能是字卡，最長 ${String(FIRST_BEAT_MAX_SEC)} 秒。越到後面剪得越快（格子越短），最後一格是片名卡，至少 ${String(TITLE_MIN_SEC)} 秒。` +
    `字卡 card：cardText 最多 ${String(CARD_MAX_CJK)} 個中文字（英文最多 ${String(CARD_MAX_WORDS)} 個單字），cardSubtext 可以留空；停留秒數至少 ${String(CARD_BASE_SEC)} 加上每個字 ${String(CARD_SEC_PER_UNIT)} 秒；全片最多 ${String(CARD_MAX_COUNT)} 張（片名卡不算）。` +
    (settings.narration
      ? `旁白 dialogue：每格最多一句、不跨格，中文每秒最多 ${String(NARRATION_MAX_CJK_PER_SEC)} 個字（英文每秒最多 ${String(NARRATION_MAX_WORDS_PER_SEC)} 個單字），有旁白的格子加起來不超過全片的 ${String(Math.round(NARRATION_MAX_SHARE * 100))}%；只講處境、賭注、問題，字卡與片名卡的 dialogue 留空字串。`
      : '這一支不要旁白：每一格的 dialogue 都是空字串。') +
    '推薦語、獎項、銷量、名人背書只能用使用者提供的原文；沒提供就不要寫，也不要暗示。' +
    '描述畫面（description）只寫看得到的人事物與動作，一格只做一件事，不要寫招牌、字幕、標題這類畫面裡的文字；所有的字都用字卡。' +
    `${SIZE_HINTS}。${ANGLE_HINTS}。cameraMove 只能是 null（固定）或下列其中一個：${CAMERA_MOVES.map((c) => `${c.id}（${c.label}）`).join('、')}（still 格的運鏡決定推近、拉遠或搖鏡）。` +
    (input.knownCharacters.length > 0
      ? `已經建好的角色有：${input.knownCharacters.join('、')}。出現這些角色時，characters 一定要用一模一樣的名字。`
      : '同一個角色在不同格子用同一個名字。') +
    `location 欄位：這一格發生的地點名字（短，例如「斷橋」「河岸」），整支用 1 到 3 個地點，同一個地方每次用同一個名字；字卡與片名卡留空。` +
    PLACE_LOOK_INSTRUCTION +
    ((input.knownLocations ?? []).length > 0
      ? `已經建好的場景卡有：${(input.knownLocations ?? []).join('、')}。發生在這些地方時，location 一定要用一模一樣的名字。`
      : '') +
    `music 欄位：一段配樂說明，照腳本的時間寫成有時間碼的描述（開場留白、推進、片名前的短暫靜音、重音收尾），純音樂、不要人聲。` +
    `title 欄位：書名${settings.title ? '（使用者已提供，照寫）' : '（使用者沒提供，從文本取）'}。` +
    (given.length > 0 ? `使用者提供的資訊：${given.join('；')}。` : '') +
    `畫風是「${QUICK_STYLES[input.style].label}」。只輸出 JSON。` +
    storyLanguageNote(
      input.text,
      '文本不是中文：description、action、dialogue、cardText、cardSubtext、music、title 這些給人看的文字請用文本使用的語言寫，角色名照原文，不要翻成中文；beatKind、size、angle、cameraMove 這類固定選項照上面規定的值。',
    ) +
    (input.guide.trim() === ''
      ? ''
      : `\n\n預告片準則（安排格子時照這些原則，但不要違反上面的輸出格式）：\n${input.guide.trim()}`)
  )
}

/** 給模型的使用者訊息；示範模式的假模型也從這裡讀目標秒數與類型。 */
export function trailerUserMessage(text: string, settings: TrailerSettings): string {
  return `故事：\n${text}\n\n${TRAILER_REQUEST_MARK}。類型：${settings.kind}。目標總長：${secText(settings.targetSec)} 秒。旁白：${settings.narration ? '開' : '關'}。`
}

/** 腳本的一格 → 檢查器看的一格。 */
export function toCheckBeat(beat: TrailerScriptBeat): TrailerBeat {
  const picture = beat.beatKind === 'video' || beat.beatKind === 'still'
  return {
    beatKind: beat.beatKind,
    durationSec: beat.durationSec,
    ...(picture && beat.dialogue.trim() !== '' ? { dialogue: beat.dialogue.trim() } : {}),
    ...(beat.beatKind === 'card'
      ? { card: { text: beat.cardText.trim(), subtext: beat.cardSubtext.trim() } }
      : {}),
    ...(beat.segment === '' ? {} : { segment: beat.segment }),
  }
}

const FPS = LOCAL_BEAT_FPS

const checkScript = (script: TrailerScript, settings: TrailerSettings): TrailerCheckResult =>
  checkTrailerScript(
    script.beats.map(toCheckBeat),
    // 使用者沒給書名時，書名取 AI 從文本取的
    { ...settings, title: settings.title === '' ? script.title.trim() : settings.title },
    FPS,
  )

/**
 * 使用者給了標語：它一定要原封不動出現在某一張字卡上。已經有就不動；沒有就換掉第一張字卡的字（沒有字卡就不動，檢查器不管這件事）。
 */
export function ensureTagline(script: TrailerScript, settings: TrailerSettings): TrailerScript {
  const tagline = settings.tagline.trim()
  if (
    tagline === '' ||
    script.beats.some((b) => b.beatKind === 'card' && b.cardText.trim() === tagline)
  ) {
    return script
  }
  const at = script.beats.findIndex((b) => b.beatKind === 'card')
  if (at < 0) return script
  return {
    ...script,
    beats: script.beats.map((beat, i) => (i === at ? { ...beat, cardText: tagline } : beat)),
  }
}

/** 照字數上限截短一段字：中文截前 N 個字（句讀不算），英文截前 N 個單字。 */
export function truncateUnits(text: string, max: number): string {
  const trimmed = text.trim()
  if (textUnits(trimmed) <= max) return trimmed
  if (/\p{Script=Han}/u.test(trimmed)) {
    let units = 0
    let out = ''
    for (const ch of trimmed) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        if (units === max) break
        units++
      }
      out += ch
    }
    return out.replace(/[，、；,;\s]+$/u, '')
  }
  return trimmed.split(/\s+/).slice(0, max).join(' ')
}

/** 旁白只留第一句，再照這一格的秒數截短。 */
function shortenDialogue(text: string, durationSec: number): string {
  const first = text.split(/(?<=[。！？!?])|\.(?=\s|$)/u)[0]?.trim() ?? ''
  const cjk = /\p{Script=Han}/u.test(first)
  const max = cjk
    ? Math.max(1, Math.floor(durationSec * NARRATION_MAX_CJK_PER_SEC))
    : Math.max(1, Math.floor(durationSec * NARRATION_MAX_WORDS_PER_SEC))
  return truncateUnits(first, max)
}

/**
 * 重寫之後還有問題時，用程式修正能修的：字卡太長截字、旁白太長截短（只留一句）、沒要旁白就清掉、第一格太長縮短，
 * 最後把各格秒數調成剛好等於目標。回傳修正後的腳本與做了什麼（白話）。
 */
export function repairScript(
  script: TrailerScript,
  settings: TrailerSettings,
): { script: TrailerScript; fixes: string[] } {
  const fixes: string[] = []
  const beats = script.beats.map((beat) => ({ ...beat }))
  beats.forEach((beat, i) => {
    const n = String(i + 1)
    // 使用者給的標語一個字都不改（太長就讓檢查器擋下，回白話錯誤）
    if (beat.beatKind === 'card' && beat.cardText.trim() !== settings.tagline.trim()) {
      const limit = /\p{Script=Han}/u.test(beat.cardText) ? CARD_MAX_CJK : CARD_MAX_WORDS
      const cut = truncateUnits(beat.cardText, limit)
      if (cut !== beat.cardText.trim()) {
        beat.cardText = cut
        fixes.push(t('trailer.fixCardCut', { n }))
      }
    }
  })
  const fit = fitToTarget(
    beats.map((b) => ({
      beatKind: b.beatKind,
      durationSec: b.durationSec,
      ...(b.beatKind === 'card' ? { card: { text: b.cardText, subtext: b.cardSubtext } } : {}),
    })),
    settings.targetSec,
    FPS,
  )
  if (fit.ok) {
    const before = beats.reduce((sum, b) => sum + snapToFrame(b.durationSec, FPS), 0)
    fit.durations.forEach((sec, i) => {
      const beat = beats[i]
      if (beat) beat.durationSec = sec
    })
    // 第一格最長 4 秒：多出來的時間讓給其他格
    const first = beats[0]
    if (first && first.durationSec > FIRST_BEAT_MAX_SEC && beats.length > 1) {
      const rest = beats.slice(1)
      const refit = fitToTarget(
        rest.map((b) => ({
          beatKind: b.beatKind,
          durationSec: b.durationSec,
          ...(b.beatKind === 'card' ? { card: { text: b.cardText, subtext: b.cardSubtext } } : {}),
        })),
        settings.targetSec - FIRST_BEAT_MAX_SEC,
        FPS,
      )
      if (refit.ok) {
        first.durationSec = FIRST_BEAT_MAX_SEC
        refit.durations.forEach((sec, i) => {
          const beat = rest[i]
          if (beat) beat.durationSec = sec
        })
        fixes.push(t('trailer.fixFirstShortened'))
      }
    }
    const after = beats.reduce((sum, b) => sum + b.durationSec, 0)
    if (Math.abs(after - before) > 1e-6 || Math.abs(before - settings.targetSec) > 0.05) {
      fixes.push(t('trailer.fixLengthFitted', { target: secText(settings.targetSec) }))
    }
  }
  // 旁白依最後的秒數截短（秒數定了才知道念不念得完）：沒要旁白就清掉，其餘只留一句
  beats.forEach((beat, i) => {
    if (beat.dialogue.trim() === '') return
    const n = String(i + 1)
    if (!settings.narration || (beat.beatKind !== 'video' && beat.beatKind !== 'still')) {
      beat.dialogue = ''
      fixes.push(t('trailer.fixNarrationRemoved', { n }))
      return
    }
    const cutText = shortenDialogue(beat.dialogue, snapToFrame(beat.durationSec, FPS))
    if (cutText !== beat.dialogue.trim()) {
      beat.dialogue = cutText
      fixes.push(t('trailer.fixNarrationCut', { n }))
    }
  })
  return { script: { ...script, beats }, fixes }
}

export interface WrittenTrailer {
  /** 通過檢查的腳本（加總＝目標）。 */
  script: TrailerScript
  check: TrailerCheckResult
  /** 第一版沒過檢查，退回重寫了一次。 */
  retried: boolean
  /** 重寫後還有問題，用程式修正了什麼。 */
  fixes: string[]
  costUsd: number | undefined
  provider: string
  jobId: string
}

export interface WriteTrailerInput {
  modelId: string
  text: string
  settings: TrailerSettings
  guide: string
  knownCharacters: readonly string[]
  knownLocations?: readonly string[]
  style: QuickStyleId
}

/** 白話的錯誤清單：最多三條。 */
const problemsText = (check: TrailerCheckResult): string =>
  check.errors
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ')

/**
 * 寫預告片腳本。呼叫文字模型（格式不對由 generateStructured 自己重試一次），用 T1 的檢查器檢查：
 * 有 error 就把錯誤回給模型重寫一次；還有 error 就用程式修正再檢查；還是不過丟白話錯誤（沒有任何東西被改）。
 */
export async function writeTrailerScript(
  studio: StudioServices,
  input: WriteTrailerInput,
  ctx: GenerateContext,
): Promise<WrittenTrailer> {
  const system = trailerSystemPrompt(input)
  const user = trailerUserMessage(input.text, input.settings)
  let cost: number | undefined
  const addCost = (usd: number | undefined): void => {
    if (usd !== undefined) cost = (cost ?? 0) + usd
  }
  const first = await generateStructured(
    studio,
    { modelId: input.modelId, system, messages: [{ role: 'user', content: user }] },
    TrailerScriptSchema,
    ctx,
  )
  addCost(first.costUsd)
  let script = ensureTagline(first.data, input.settings)
  let provider = first.provider
  let jobId = first.jobId
  let check = checkScript(script, input.settings)
  let retried = false
  if (check.errors.length > 0) {
    retried = true
    const second = await generateStructured(
      studio,
      {
        modelId: input.modelId,
        system,
        messages: [
          { role: 'user', content: user },
          { role: 'assistant', content: JSON.stringify(script) },
          {
            role: 'user',
            content: `這一版沒有通過檢查，請照下面的問題修正後重新輸出整份腳本（只輸出 JSON）：\n${check.errors.map((issue) => `- ${issue.message}`).join('\n')}`,
          },
        ],
      },
      TrailerScriptSchema,
      ctx,
    )
    addCost(second.costUsd)
    script = ensureTagline(second.data, input.settings)
    provider = second.provider
    jobId = second.jobId
    check = checkScript(script, input.settings)
  }
  let fixes: string[] = []
  if (check.errors.length > 0) {
    const repaired = repairScript(script, input.settings)
    script = repaired.script
    fixes = repaired.fixes
    check = checkScript(script, input.settings)
  }
  if (check.errors.length > 0) {
    throw new AppError({
      code: 'invalid_response',
      retryable: true,
      userMessage: t('trailer.scriptRejected', { problems: problemsText(check) }),
    })
  }
  return { script, check, retried, fixes, costUsd: cost, provider, jobId }
}

// ---- 配樂描述（T6b）：跟著腳本的時間與起伏 ----
// 給配樂模型的字用英文（模型對英文描述最穩；使用者選的情緒照他寫的原文放進去）。
// 這段字會進節點輸入與生成紀錄，所以用雜湊釘住（prompts-golden.test.ts）。

/** 要的配樂長度＝成品長度加這麼多秒：模型的長度不準，寧可長一點再切掉。 */
export const MUSIC_EXTRA_SEC = 3
/** 配樂最後淡出多久（秒）；混音時從成品的最後一刻往回算。 */
export const MUSIC_END_FADE_SEC = 1.5
/** 片名出現前先留多久的靜音（秒）。 */
const MUSIC_SILENCE_BEFORE_TITLE_SEC = 0.8

const SEGMENT_MUSIC_MOODS: Readonly<Record<string, string>> = {
  hook: 'a quiet, mysterious opening with sparse texture, an unanswered question',
  world: 'establish the world, steady and restrained, slowly warming',
  turn: 'something changes, tension starts to build',
  escalate: 'rising intensity, driving rhythm, getting faster and louder',
  suspense: 'held breath, sustained tension at its peak, almost still',
  montage: 'fast cuts, relentless momentum, building to a peak',
  title: 'the music falls away, then a single strong ending',
}

export interface MusicSpan {
  key: string
  startSec: number
  endSec: number
}

/**
 * 腳本各段的時間範圍：格子依序累加秒數，連續同一段併成一段。
 * 沒有格子、或有格子沒存段落（舊專案的腳本）時，照類型模板的比例排。
 */
export function musicSpansOf(
  shots: readonly { segment?: string | undefined; durationSec: number }[] | undefined,
  kind: TrailerKind,
  filmSec: number,
): MusicSpan[] {
  if (
    shots !== undefined &&
    shots.length > 0 &&
    shots.every((s) => s.segment !== undefined && s.segment !== '')
  ) {
    const spans: MusicSpan[] = []
    let at = 0
    for (const shot of shots) {
      const end = at + shot.durationSec
      const last = spans.at(-1)
      if (last && last.key === shot.segment) last.endSec = end
      else spans.push({ key: shot.segment ?? '', startSec: at, endSec: end })
      at = end
    }
    return spans
  }
  let at = 0
  return TRAILER_TEMPLATES[kind].segments.map((segment, index, all) => {
    const startSec = at
    at = index === all.length - 1 ? filmSec : at + segment.share * filmSec
    return { key: segment.key, startSec, endSec: at }
  })
}

const sec1 = (value: number): string => value.toFixed(1)

/** 人聲類的字：配樂一律是純音樂，模型寫的說明只要提到人聲就整句不要（英文用單字邊界，免得 wrap 變 rap）。 */
const VOCAL_WORDS =
  /\b(?:vocals?|voices?|singers?|singing|sung|sing|choirs?|chorus|choral|lyrics?|rapping|rap|humming|hummed|whispers?|whispered|spoken|a cappella)\b|人聲|歌聲|歌詞|合唱|獨唱|歌唱|唱|女聲|男聲|童聲|哼|吟誦|旁白/i
/** 時間碼：「0:06」「12 s」「6 秒」；時間軸是另外照格長產生的，模型寫的時間不能混進去。 */
const TIME_CODES =
  /\d+:\d{2}|\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds?)\b|\d+(?:\.\d+)?\s*[秒″]|[零一二三四五六七八九十百]+\s*秒/i
/** 風格與配器那一句的長度上限（字）。 */
const STYLE_HINT_MAX = 240

/**
 * 把模型寫在腳本裡的 musicBrief 整理成「風格、配器」那一句：切成短句，帶人聲字或時間碼的短句丟掉，
 * 其餘用「; 」接起來，總長不超過 240 字。全部被濾光就回空字串（提示詞照沒有這一句的樣子）。
 */
export function musicStyleHint(brief: string): string {
  const clauses = brief
    .split(/[.。!！?？;；,，、\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '' && !VOCAL_WORDS.test(clause) && !TIME_CODES.test(clause))
  const kept: string[] = []
  let length = 0
  for (const clause of clauses) {
    const next = length + clause.length + (kept.length > 0 ? 2 : 0)
    if (next > STYLE_HINT_MAX) break
    kept.push(clause)
    length = next
  }
  return kept.join('; ')
}

/** 預告片的配樂描述：純音樂、各段的時間與情緒、片名前短暫靜音、結尾一個重音、使用者選的情緒。 */
export function trailerMusicPrompt(input: {
  settings: Pick<TrailerSettings, 'musicMood'> & { musicBrief?: string | undefined }
  spans: readonly MusicSpan[]
  filmSec: number
  /** 專案的畫風代號；沒有就不寫。 */
  style?: string | undefined
}): string {
  const { spans, filmSec } = input
  const length = Math.round((filmSec + MUSIC_EXTRA_SEC) * 10) / 10
  const mood = input.settings.musicMood.trim()
  const style = musicStyleHint(input.settings.musicBrief ?? '')
  const timeline = spans
    .map(
      (span) =>
        `${sec1(span.startSec)}–${sec1(span.endSec)} s ${span.key}: ${SEGMENT_MUSIC_MOODS[span.key] ?? 'follow the picture'}`,
    )
    .join('; ')
  const title = spans.find(
    (span) => span.key === 'title' && span.startSec > MUSIC_SILENCE_BEFORE_TITLE_SEC,
  )
  const ending = title
    ? `Leave a short silence at ${sec1(title.startSec - MUSIC_SILENCE_BEFORE_TITLE_SEC)}–${sec1(title.startSec)} s, right before the title card. Land one final accent at ${sec1(title.startSec)} s (when the title appears) and let it ring until ${sec1(filmSec)} s.`
    : `Land one final accent at ${sec1(filmSec)} s (the end of the film).`
  return [
    'Instrumental only, no vocals, no singing, no spoken words.',
    `Original cinematic score for a book trailer, ${String(length)} s long. The film itself is ${String(Math.round(filmSec * 10) / 10)} s: the track is cut there and ends with a ${String(MUSIC_END_FADE_SEC)} s fade-out.`,
    input.style ? `Visual style: ${input.style}.` : '',
    mood === '' ? '' : `Overall mood: ${mood}.`,
    style === '' ? '' : `Style and instrumentation (from the script): ${style}.`,
    `Timeline: ${timeline}.`,
    ending,
  ]
    .filter((part) => part !== '')
    .join(' ')
}
