import type { ChatPanelMessage } from '@svs/schema'

/** 引用的原話最多這麼長（太長的話只留開頭，Claude 看專案現在的狀態就知道做到哪）。 */
const QUOTE_MAX_CHARS = 300

const PREFIX = '剛才那句「'
const SUFFIX = '」被用量上限打斷。'
/** 上一次按「繼續」送出的話又被打斷：要引用的是使用者最早的原話，不要一層包一層。 */
const OWN_FORM = /^剛才那句「([\s\S]*)」被用量上限打斷。先看專案現在的狀態/u

/**
 * 按「繼續」時送出的話：只續做**被打斷的那一句**，不是「接著剛才的做下去」。
 * 後者會讓 Claude 把它上一輪預告要做的影片、配樂、匯出全做了——使用者根本沒叫它做，真實模式下就是沒問就花錢。
 * `index` 是出現「繼續」的那則（Claude 的訊息）；被打斷的是它前面最近的一則使用者的話。
 */
export function continueText(messages: readonly ChatPanelMessage[], index: number): string {
  let said: string | undefined
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') {
      said = m.text
      break
    }
  }
  const original = said === undefined ? undefined : (OWN_FORM.exec(said)?.[1] ?? said)
  const quote = (original ?? '').trim().replace(/\s+/gu, ' ')
  const shown = quote.length > QUOTE_MAX_CHARS ? `${quote.slice(0, QUOTE_MAX_CHARS)}…` : quote
  const rest = '先看專案現在的狀態，把那句還沒做完的部分做完；不要做那句以外的事。'
  if (shown === '') return `剛才的事被用量上限打斷了。${rest.replaceAll('那句', '那件事')}`
  return `${PREFIX}${shown}${SUFFIX}${rest}`
}
