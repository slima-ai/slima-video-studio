import {
  CARD_MAX_CJK,
  DEMO_BAD_SCRIPT_MARK,
  cardMinSec,
  TRAILER_NARRATION_OFF_MARK,
  TRAILER_REQUEST_MARK,
  NARRATION_MAX_CJK_PER_SEC,
  NARRATION_MAX_WORDS_PER_SEC,
  fitToTarget,
  MIN_MOVING_BEAT_SEC,
  t,
  textUnits,
  type LlmRequest,
  type TrailerBeat,
} from '@svs/schema'

// 示範模式的假「寫預告片腳本」：不呼叫任何模型，依目標秒數與類型排出一份形狀正確、一定過檢查器的腳本。
// 內容取自使用者貼的文本（一句一句當畫面描述與旁白），所以示範時看得出腳本跟自己的文字有關。

interface DemoBeat extends TrailerBeat {
  segment: string
  description: string
  cameraMove: string | null
  cardText: string
  /** 旁白的原句（之後依秒數截短）。 */
  clause: string
  characters?: string[]
  location?: string
}

/** 規則 11 會擋的字眼：示範用的旁白與描述不能帶（使用者貼的文本可能有）。 */
const CLAIMISH =
  /暢銷|銷量|萬冊|榜首|排行榜|得獎|獲獎|金獎|大獎|獎項|入圍|盛讚|好評如潮|名人推薦|best-?sell|award|prize|winner|million copies|#\s?1\b/i

const MOTIONS = ['push_in', 'pull_out', 'pan'] as const
/** 示範腳本每個畫面格最長幾秒（檢查器 6 秒才提醒，留一點空）。 */
const DEMO_PICTURE_MAX_SEC = 5.5

/** 示範的畫面描述與旁白句（互相不重複；介面語言跟著變）。 */
const SHOT_KEYS = [
  'mock.trailerShot1',
  'mock.trailerShot2',
  'mock.trailerShot3',
  'mock.trailerShot4',
  'mock.trailerShot5',
  'mock.trailerShot6',
  'mock.trailerShot7',
  'mock.trailerShot8',
  'mock.trailerShot9',
  'mock.trailerShot10',
  'mock.trailerShot11',
  'mock.trailerShot12',
  'mock.trailerShot13',
  'mock.trailerShot14',
  'mock.trailerShot15',
  'mock.trailerShot16',
  'mock.trailerShot17',
  'mock.trailerShot18',
  'mock.trailerShot19',
  'mock.trailerShot20',
  'mock.trailerShot21',
  'mock.trailerShot22',
  'mock.trailerShot23',
  'mock.trailerShot24',
] as const
const LINE_KEYS = [
  'mock.trailerLine1',
  'mock.trailerLine2',
  'mock.trailerLine3',
  'mock.trailerLine4',
  'mock.trailerLine5',
  'mock.trailerLine6',
  'mock.trailerLine7',
  'mock.trailerLine8',
] as const

const cut = (text: string, max: number): string => {
  const cjk = /\p{Script=Han}/u.test(text)
  if (cjk) return Array.from(text.replace(/\s+/gu, '')).slice(0, max).join('')
  return text.split(/\s+/u).slice(0, max).join(' ')
}

/** 請求裡的目標與類型（寫腳本的使用者訊息：「…類型：story。目標總長：30 秒。旁白：開。」）。 */
export function parseTrailerRequest(
  request: LlmRequest,
):
  | { story: string; kind: 'story' | 'teaser' | 'idea'; targetSec: number; narration: boolean }
  | undefined {
  const last = request.messages.find((m) => m.role === 'user')?.content ?? ''
  if (!last.includes(TRAILER_REQUEST_MARK)) return undefined
  const kindText = /類型：(story|teaser|idea)/.exec(last)?.[1]
  const kind = kindText === 'teaser' || kindText === 'idea' ? kindText : 'story'
  const target = Number(/目標總長：([\d.]+)\s*秒/.exec(last)?.[1] ?? '30')
  const story = (/故事：\s*([\s\S]*?)\s*請寫預告片腳本/.exec(last)?.[1] ?? '').trim()
  return {
    story,
    kind,
    targetSec: Number.isFinite(target) && target > 0 ? target : 30,
    narration: !last.includes(TRAILER_NARRATION_OFF_MARK),
  }
}

const IDEA_SHOT_KEYS = [
  'mock.ideaShot1',
  'mock.ideaShot2',
  'mock.ideaShot3',
  'mock.ideaShot4',
  'mock.ideaShot5',
  'mock.ideaShot6',
  'mock.ideaShot7',
  'mock.ideaShot8',
  'mock.ideaShot9',
  'mock.ideaShot10',
  'mock.ideaShot11',
  'mock.ideaShot12',
  'mock.ideaShot13',
  'mock.ideaShot14',
  'mock.ideaShot15',
  'mock.ideaShot16',
  'mock.ideaShot17',
  'mock.ideaShot18',
  'mock.ideaShot19',
  'mock.ideaShot20',
  'mock.ideaShot21',
  'mock.ideaShot22',
  'mock.ideaShot23',
  'mock.ideaShot24',
] as const
const IDEA_CARD_KEYS = [
  'mock.ideaCard1',
  'mock.ideaCard2',
  'mock.ideaCard3',
  'mock.ideaCard4',
  'mock.ideaCard5',
] as const

/**
 * 觀點型的假腳本：沒有角色，3 個主視覺（地點）；要讓人記住的句子（鉤子、核心主張、三個收穫）壓在不動的畫面上（疊字），
 * 旁白念的就是那一句；沒有黑底字卡 → 片名卡。示範只收到文本，不知道作者與推薦語，所以不放 author、praise 兩段
 * （那兩段只用使用者提供的字）。節奏平穩，每一格差不多長；句子放不下（目標很短）時依「三個收穫、鉤子、主張」的順序少放幾句。
 */
function demoIdeaScript(story: string, targetSec: number, narration: boolean): unknown {
  const places = [t('mock.ideaPlace1'), t('mock.ideaPlace2'), t('mock.ideaPlace3')]
  const looks = [t('mock.ideaPlaceLook1'), t('mock.ideaPlaceLook2'), t('mock.ideaPlaceLook3')]
  const clauses = story
    .split(/[，。！？；、,.!?;\n]+/u)
    .map((c) => c.trim())
    .filter((c) => c !== '' && !CLAIMISH.test(c))
  // 每一格的字都不一樣：先用文本裡的句子（第一句留給書名），用完了接示範的畫面描述
  const shots = [...new Set([...clauses.slice(1), ...IDEA_SHOT_KEYS.map((key) => t(key))])]
  const sentences = IDEA_CARD_KEYS.map((key) => t(key))
  // 句子的位置：0 鉤子、1 主張、2～4 三個收穫；放不下就依這個順序少放
  const priority = [2, 0, 3, 1, 4]
  const build = (sentenceCount: number, pictureCount: number) => {
    // 鉤子 1 格、主張 1 格，其餘平分給三個收穫（每個收穫至少一格：句子就寫在它的第一格上）
    const gainPictures = [1, 1, 1]
    for (let i = 0; i < pictureCount - 5; i++) gainPictures[i % 3] = (gainPictures[i % 3] ?? 1) + 1
    const has = (slot: number): boolean => priority.slice(0, sentenceCount).includes(slot)
    const beats: DemoBeat[] = []
    let n = 0
    // slot：這一格要不要把那一句疊在畫面上（有的話一定是不動的格子）
    const picture = (segment: string, weight: number, slot?: number): void => {
      const i = n++
      const overlay = slot !== undefined && has(slot) ? (sentences[slot] ?? '') : ''
      const still = overlay !== '' || i % 2 === 1
      beats.push({
        beatKind: still ? 'still' : 'video',
        durationSec: weight,
        segment,
        description: shots[i % shots.length] ?? t('mock.demoPicture'),
        cameraMove: still ? (MOTIONS[i % MOTIONS.length] ?? null) : null,
        cardText: '',
        // 旁白念的就是疊的那一句；沒有疊字的畫面不說話
        clause: narration ? overlay : '',
        ...(overlay === '' ? {} : { overlay: { text: overlay } }),
        // 旁白念疊的那一句：最短停留要夠念完（英文比中文慢）
        ...(narration && overlay !== '' ? { dialogue: overlay } : {}),
        characters: [],
        // 三個主視覺輪流用：每個都至少用到一次
        location: places[i % places.length] ?? '',
      })
    }
    picture('hook', 3, 0)
    picture('claim', 3.5, 1)
    for (let g = 0; g < 3; g++) {
      picture('gains', 3.5, 2 + g)
      for (let k = 1; k < (gainPictures[g] ?? 1); k++) picture('gains', 3.5)
    }
    beats.push({
      beatKind: 'title',
      durationSec: 4,
      segment: 'title',
      description: '',
      cameraMove: null,
      cardText: '',
      clause: '',
    })
    return beats
  }
  // 第一格固定 3 秒；片名卡與字卡也各停固定的秒數（不拖長）；其餘的畫面格分剩下的時間，每格不超過上限
  const headSec = 3
  const frame = (sec: number): number => Math.round(sec * 24) / 24
  const titleSec = frame(Math.min(5.5, Math.max(3, targetSec * 0.15)))
  const arrange = (sentenceCount: number, pictureCount: number) => {
    const list = build(sentenceCount, pictureCount)
    const fixed = list.map((beat, i) =>
      i === 0 ? headSec : beat.beatKind === 'title' ? titleSec : undefined,
    )
    const fixedSum = fixed.reduce<number>((sum, sec) => sum + (sec ?? 0), 0)
    const pictures = list.filter((_, i) => fixed[i] === undefined)
    const budget = targetSec - fixedSum
    const filled = capWeights(
      pictures.map((beat) => beat.durationSec),
      budget,
      DEMO_PICTURE_MAX_SEC,
    )
    const rest = fitToTarget(
      pictures.map((beat, i) => ({ ...beat, durationSec: filled[i] ?? beat.durationSec })),
      budget,
      24,
    )
    let k = 0
    const durations = fixed.map((sec) => sec ?? rest.durations[k++] ?? 1)
    return { list, fit: { ok: rest.ok, durations }, longest: Math.max(0, ...rest.durations) }
  }
  // 畫面的數目跟著長度：每 4.5 秒左右一格，至少 5 格（鉤子、主張、各收穫至少一格）；畫面格停太久就多排幾格（描述用完為止）；放不下就少放幾句
  const maxSentences = targetSec >= 25 ? 5 : targetSec >= 20 ? 3 : targetSec >= 15 ? 2 : 1
  const base = Math.max(5, Math.round(targetSec / 4.5))
  const cap = Math.max(base, shots.length)
  let chosen: ReturnType<typeof arrange> | undefined
  let fallback: ReturnType<typeof arrange> | undefined
  for (let c = maxSentences; c >= 0 && chosen === undefined; c--) {
    for (let v = base; v <= cap; v++) {
      const attempt = arrange(c, v)
      if (!attempt.fit.ok) break
      fallback ??= attempt
      if (attempt.longest <= DEMO_PICTURE_MAX_SEC + 1e-9) {
        chosen = attempt
        break
      }
    }
  }
  const { list: beats, fit } = chosen ?? fallback ?? arrange(0, 5)
  // 有旁白的格子加起來不超過全片的 5 成半（檢查器的上限是 6 成）：念不完的句子就不念，疊字還在
  let narratedSec = 0
  const out = beats.map((beat, i) => {
    const sec = fit.durations[i] ?? beat.durationSec
    const spoken = beat.clause !== '' && narratedSec + sec <= targetSec * 0.55
    if (spoken) narratedSec += sec
    return {
      segment: beat.segment,
      // 會動的格被排到比 1.5 秒短：做不出像樣的影片，示範腳本自己就寫成不動的畫面
      beatKind:
        beat.beatKind === 'video' && sec < MIN_MOVING_BEAT_SEC - 1e-9 ? 'still' : beat.beatKind,
      durationSec: sec,
      description: beat.description,
      action: '',
      size: i % 3 === 0 ? 'wide' : i % 3 === 1 ? 'medium' : 'full',
      angle: 'eye_level',
      cameraMove: beat.cameraMove,
      characters: [],
      location: beat.location ?? '',
      dialogue: spoken ? beat.clause : '',
      cardText: '',
      cardSubtext: '',
      overlayText: beat.overlay?.text ?? '',
      overlaySubtext: '',
    }
  })
  const first = out[0]
  if (first && story.includes(DEMO_BAD_SCRIPT_MARK)) {
    out[0] = {
      ...first,
      beatKind: 'card',
      description: '',
      cardText: sentences[1] ?? '',
      dialogue: '',
      overlayText: '',
    }
  }
  return {
    title: story === '' ? t('mock.trailerTitle') : cut(clauses[0] ?? t('mock.trailerTitle'), 16),
    music: t('mock.ideaMusic'),
    places: places.map((name, i) => ({ name, look: looks[i] ?? '' })),
    people: [],
    beats: out,
  }
}

/**
 * 把比重換成秒數：加總等於 total、照比重分配，但每格最多 max 秒；超過的削到 max，多出來的時間分給沒到上限的格子。
 * 全部都削到上限還排不滿時，每格都是 max（加總會比 total 小，呼叫的人再決定要不要多排幾格）。
 */
export function capWeights(weights: readonly number[], total: number, max: number): number[] {
  const out = weights.map(() => 0)
  let free = weights.map((_, i) => i)
  let left = total
  for (let round = 0; round < weights.length + 1 && free.length > 0; round++) {
    const sum = free.reduce((acc, i) => acc + (weights[i] ?? 0), 0)
    if (sum <= 0) break
    const scale = left / sum
    const over = free.filter((i) => (weights[i] ?? 0) * scale > max)
    if (over.length === 0) {
      for (const i of free) out[i] = (weights[i] ?? 0) * scale
      return out
    }
    for (const i of over) {
      out[i] = max
      left -= max
    }
    free = free.filter((i) => !over.includes(i))
  }
  for (const i of free) out[i] = Math.max(0, left / Math.max(1, free.length))
  return out
}

export function demoTrailerScript(request: LlmRequest): unknown {
  const parsed = parseTrailerRequest(request)
  if (!parsed) return undefined
  const { story, kind, targetSec, narration } = parsed
  if (kind === 'idea') return demoIdeaScript(story, targetSec, narration)
  const clauses = story
    .split(/[，。！？；、,.!?;\n]+/u)
    .map((c) => c.trim())
    .filter((c) => c !== '' && !CLAIMISH.test(c))
  // 每一格的字都不一樣：先用文本裡的句子（第一句留給書名，不重複用），用完了接示範的畫面與旁白句
  const unique = (list: readonly string[]): string[] => [...new Set(list)]
  const descriptions = unique([...clauses.slice(1), ...SHOT_KEYS.map((key) => t(key))])
  const lines = LINE_KEYS.map((key) => t(key))
  const heroes = [t('mock.trailerChar1'), t('mock.trailerChar2')]
  const places = [t('mock.trailerPlace1'), t('mock.trailerPlace2')]
  const pick = (i: number): string => descriptions[i % descriptions.length] ?? t('mock.demoPicture')
  let talked = 0
  const cards = [
    t('mock.trailerCard1'),
    t('mock.trailerCard2'),
    t('mock.trailerCard3'),
    t('mock.trailerCard4'),
  ]

  // 排格子：每一格先給一個「大概比重」，最後交給 fitToTarget 排成剛好的秒數
  const build = (cardCount: number, visuals: number): DemoBeat[] => {
    const beats: DemoBeat[] = []
    talked = 0
    let n = 0
    const picture = (segment: string, weight: number, talk: boolean): void => {
      const i = n++
      const still = i % 2 === 1
      beats.push({
        beatKind: still ? 'still' : 'video',
        durationSec: weight,
        segment,
        description: pick(i),
        cameraMove: still ? (MOTIONS[i % MOTIONS.length] ?? null) : null,
        cardText: '',
        // 旁白句用完了就不再配（每格的旁白不重複）
        clause: talk && narration && talked < lines.length ? (lines[talked++] ?? '') : '',
        // 1～2 個角色、1～2 個地點：第一個角色每格都在，第二個角色隔一格才出場；前半在第一個地點、後半在第二個
        characters: i % 2 === 0 ? [heroes[0] ?? ''] : [heroes[0] ?? '', heroes[1] ?? ''],
        location: (i < 4 ? places[0] : places[1]) ?? '',
      })
    }
    const card = (segment: string, weight: number, text: string): void => {
      beats.push({
        beatKind: 'card',
        durationSec: weight,
        segment,
        description: '',
        cameraMove: null,
        cardText: text,
        clause: '',
        card: { text, subtext: '' },
      })
    }
    // 越到後面越短（規則 3：後面三分之一的平均要比前面三分之一短很多）：
    // 字卡放在前面，後半的畫面一格比一格短
    // 一段有很多格（長片）時，縮短得慢一點：整段從 first 縮到約 3 成，不然前面幾格會被排得很長
    const shrink = (k: number, first: number, count: number): number =>
      Math.max(0.4, first * (count > 8 ? 0.3 ** (1 / (count - 1)) : 0.72) ** k)
    if (kind === 'teaser') {
      picture('hook', 2, false)
      const montage = visuals - 1
      for (let k = 0; k < montage; k++) {
        picture('montage', shrink(k, 2, montage), false)
        if (k < cardCount) card('montage', 2.2, cards[k] ?? '')
      }
    } else {
      picture('hook', 3, true)
      const world = Math.max(1, Math.round(visuals * 0.3))
      for (let k = 0; k < world; k++) picture('world', 2.6, true)
      if (cardCount > 0) card('world', 2.2, cards[0] ?? '')
      const turn = Math.max(1, Math.round(visuals * 0.2))
      for (let k = 0; k < turn; k++) picture('turn', 1.8 * 0.85 ** k, true)
      if (cardCount > 1) card('turn', 2.2, cards[1] ?? '')
      const escalate = Math.max(1, visuals - 1 - world - turn)
      for (let k = 0; k < escalate; k++) picture('escalate', shrink(k, 1.2, escalate), false)
      if (cardCount > 2) card('suspense', 2.2, cards[2] ?? '')
      else picture('suspense', 1, false)
    }
    beats.push({
      beatKind: 'title',
      durationSec: 4,
      segment: 'title',
      description: '',
      cameraMove: null,
      cardText: '',
      clause: '',
    })
    return beats
  }

  // 放得下最多的字卡數；放不下（目標很短）就少放幾張
  const maxCards = targetSec >= 25 ? 3 : targetSec >= 20 ? 2 : 1
  // 第一格固定幾秒（規則 2：最長 4 秒）；片名卡與字卡也各停固定的秒數（不拖長）；其餘的畫面格分剩下的時間
  const headSec = kind === 'teaser' ? 2 : 3
  const frame = (sec: number): number => Math.round(sec * 24) / 24
  const titleSec = frame(Math.min(5.5, Math.max(3, targetSec * 0.15)))
  const holdOf = (beat: DemoBeat): number | undefined =>
    beat.beatKind === 'title'
      ? titleSec
      : beat.beatKind === 'card'
        ? frame(cardMinSec(beat.card ?? { text: beat.cardText }) * 1.25)
        : undefined
  // 畫面描述每格都不一樣：最多排到描述用完為止
  const cap = Math.max(3, descriptions.length)
  const arrange = (cardCount: number, visuals: number) => {
    const list = build(cardCount, visuals)
    const fixed = list.map((beat, i) => (i === 0 ? headSec : holdOf(beat)))
    const fixedSum = fixed.reduce<number>((sum, sec) => sum + (sec ?? 0), 0)
    const pictures = list.filter((_, i) => fixed[i] === undefined)
    const budget = targetSec - fixedSum
    // 比重照原本的（越後面越短），但每格不超過上限：超過的削到上限，多出來的時間分給其他格
    const filled = capWeights(
      pictures.map((beat) => beat.durationSec),
      budget,
      DEMO_PICTURE_MAX_SEC,
    )
    const rest = fitToTarget(
      pictures.map((beat, i) => ({ ...beat, durationSec: filled[i] ?? beat.durationSec })),
      budget,
      24,
    )
    let k = 0
    const durations = fixed.map((sec) => sec ?? rest.durations[k++] ?? 1)
    return { list, fit: { ok: rest.ok, durations }, longest: Math.max(0, ...rest.durations) }
  }
  // 畫面格停太久（超過 5.5 秒）就多排幾格（長片）；放不下就少放幾張字卡
  const base = Math.max(3, Math.round(targetSec / 3.5))
  let chosen: ReturnType<typeof arrange> | undefined
  let fallback: ReturnType<typeof arrange> | undefined
  for (let c = maxCards; c >= 0 && chosen === undefined; c--) {
    for (let v = Math.min(base, cap); v <= cap; v++) {
      const attempt = arrange(c, v)
      if (!attempt.fit.ok) break
      fallback ??= attempt
      if (attempt.longest <= DEMO_PICTURE_MAX_SEC + 1e-9) {
        chosen = attempt
        break
      }
    }
  }
  const { list: beats, fit } = chosen ?? fallback ?? arrange(0, 3)

  const out = beats.map((beat, i) => {
    const sec = fit.durations[i] ?? beat.durationSec
    const cjk = /\p{Script=Han}/u.test(beat.clause)
    const max = Math.max(
      1,
      Math.floor(sec * (cjk ? NARRATION_MAX_CJK_PER_SEC : NARRATION_MAX_WORDS_PER_SEC)),
    )
    const dialogue =
      beat.clause === '' || textUnits(beat.clause) === 0 ? '' : cut(beat.clause, Math.min(max, 12))
    return {
      segment: beat.segment,
      // 會動的格被排到比 1.5 秒短：做不出像樣的影片，示範腳本自己就寫成不動的畫面
      beatKind:
        beat.beatKind === 'video' && sec < MIN_MOVING_BEAT_SEC - 1e-9 ? 'still' : beat.beatKind,
      durationSec: sec,
      description: beat.description,
      action: '',
      size: i % 3 === 0 ? 'wide' : i % 3 === 1 ? 'medium' : 'full',
      angle: 'eye_level',
      cameraMove: beat.cameraMove,
      characters: beat.characters ?? [],
      location: beat.location ?? '',
      dialogue,
      cardText: cut(beat.cardText, CARD_MAX_CJK),
      cardSubtext: '',
    }
  })
  const first = out[0]
  if (first && story.includes(DEMO_BAD_SCRIPT_MARK)) {
    out[0] = { ...first, beatKind: 'card', description: '', cardText: cards[1] ?? '', dialogue: '' }
  }
  return {
    title: story === '' ? t('mock.trailerTitle') : cut(clauses[0] ?? t('mock.trailerTitle'), 16),
    music: t('mock.trailerMusic'),
    places: [
      { name: places[0] ?? '', look: t('mock.trailerPlaceLook1') },
      { name: places[1] ?? '', look: t('mock.trailerPlaceLook2') },
    ],
    // 角色的外觀：只寫有出場的角色（草稿角色卡就是從這裡填的）
    people: [
      {
        name: heroes[0] ?? '',
        look: t('mock.trailerCharLook1'),
        outfit: t('mock.trailerCharOutfit1'),
      },
      {
        name: heroes[1] ?? '',
        look: t('mock.trailerCharLook2'),
        outfit: t('mock.trailerCharOutfit2'),
      },
    ].filter((person) => out.some((beat) => beat.characters.includes(person.name))),
    beats: out,
  }
}
