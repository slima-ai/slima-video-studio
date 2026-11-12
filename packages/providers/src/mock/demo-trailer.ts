import {
  CARD_MAX_CJK,
  DEMO_BAD_SCRIPT_MARK,
  TRAILER_NARRATION_OFF_MARK,
  TRAILER_REQUEST_MARK,
  NARRATION_MAX_CJK_PER_SEC,
  NARRATION_MAX_WORDS_PER_SEC,
  fitToTarget,
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
}

/** 規則 11 會擋的字眼：示範用的旁白與描述不能帶（使用者貼的文本可能有）。 */
const CLAIMISH =
  /暢銷|銷量|萬冊|榜首|排行榜|得獎|獲獎|金獎|大獎|獎項|入圍|盛讚|好評如潮|名人推薦|best-?sell|award|prize|winner|million copies|#\s?1\b/i

const MOTIONS = ['push_in', 'pull_out', 'pan'] as const

const cut = (text: string, max: number): string => {
  const cjk = /\p{Script=Han}/u.test(text)
  if (cjk) return Array.from(text.replace(/\s+/gu, '')).slice(0, max).join('')
  return text.split(/\s+/u).slice(0, max).join(' ')
}

/** 請求裡的目標與類型（寫腳本的使用者訊息：「…類型：story。目標總長：30 秒。旁白：開。」）。 */
export function parseTrailerRequest(
  request: LlmRequest,
): { story: string; kind: 'story' | 'teaser'; targetSec: number; narration: boolean } | undefined {
  const last = request.messages.find((m) => m.role === 'user')?.content ?? ''
  if (!last.includes(TRAILER_REQUEST_MARK)) return undefined
  const kind = /類型：(story|teaser)/.exec(last)?.[1] === 'teaser' ? 'teaser' : 'story'
  const target = Number(/目標總長：([\d.]+)\s*秒/.exec(last)?.[1] ?? '30')
  const story = (/故事：\s*([\s\S]*?)\s*請寫預告片腳本/.exec(last)?.[1] ?? '').trim()
  return {
    story,
    kind,
    targetSec: Number.isFinite(target) && target > 0 ? target : 30,
    narration: !last.includes(TRAILER_NARRATION_OFF_MARK),
  }
}

export function demoTrailerScript(request: LlmRequest): unknown {
  const parsed = parseTrailerRequest(request)
  if (!parsed) return undefined
  const { story, kind, targetSec, narration } = parsed
  const clauses = story
    .split(/[，。！？；、,.!?;\n]+/u)
    .map((c) => c.trim())
    .filter((c) => c !== '' && !CLAIMISH.test(c))
  const pick = (i: number): string =>
    clauses.length > 0 ? (clauses[i % clauses.length] ?? '') : t('mock.demoPicture')
  const cards = [
    t('mock.trailerCard1'),
    t('mock.trailerCard2'),
    t('mock.trailerCard3'),
    t('mock.trailerCard4'),
  ]

  // 排格子：每一格先給一個「大概比重」，最後交給 fitToTarget 排成剛好的秒數
  const build = (cardCount: number): DemoBeat[] => {
    const beats: DemoBeat[] = []
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
        clause: talk && narration ? pick(i) : '',
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
    const visuals = Math.max(3, Math.min(10, Math.round(targetSec / 3.5)))
    if (kind === 'teaser') {
      picture('hook', 2, false)
      const montage = visuals - 1
      for (let k = 0; k < montage; k++) {
        picture('montage', 1.5, false)
        if (k < cardCount) card('montage', 2.2, cards[k] ?? '')
      }
    } else {
      picture('hook', 3, true)
      const world = Math.max(1, Math.round(visuals * 0.3))
      for (let k = 0; k < world; k++) picture('world', 2, true)
      const turn = Math.max(1, Math.round(visuals * 0.2))
      for (let k = 0; k < turn; k++) picture('turn', 2, true)
      const escalate = Math.max(1, visuals - 1 - world - turn)
      for (let k = 0; k < escalate; k++) {
        picture('escalate', 1.5, false)
        if (k === 0 && cardCount > 0) card('escalate', 2.2, cards[0] ?? '')
        if (k === escalate - 1 && cardCount > 1) card('escalate', 2.2, cards[1] ?? '')
      }
      if (cardCount > 2) card('suspense', 2.2, cards[2] ?? '')
      else picture('suspense', 3, false)
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
  const maxCards = targetSec >= 25 ? 3 : targetSec >= 15 ? 2 : 1
  // 第一格固定幾秒（規則 2：最長 4 秒），其餘的格子分剩下的時間
  const headSec = kind === 'teaser' ? 2 : 3
  const arrange = (cardCount: number) => {
    const list = build(cardCount)
    const rest = fitToTarget(list.slice(1), targetSec - headSec, 24)
    return { list, fit: { ok: rest.ok, durations: [headSec, ...rest.durations] } }
  }
  let { list: beats, fit } = arrange(maxCards)
  for (let c = maxCards - 1; !fit.ok && c >= 0; c--) {
    ;({ list: beats, fit } = arrange(c))
  }

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
      beatKind: beat.beatKind,
      durationSec: sec,
      description: beat.description,
      action: '',
      size: i % 3 === 0 ? 'wide' : i % 3 === 1 ? 'medium' : 'full',
      angle: 'eye_level',
      cameraMove: beat.cameraMove,
      characters: [],
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
    title: story === '' ? t('mock.trailerTitle') : cut(pick(0), 16),
    music: t('mock.trailerMusic'),
    beats: out,
  }
}
