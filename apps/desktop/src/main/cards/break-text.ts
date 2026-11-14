// 字卡、疊字的斷行（純函式）：自己決定在哪裡換行，不交給瀏覽器，這樣才不會在行尾留下一個孤字。

const BREAK_PUNCT = /[，、；：,;:]/u
/** 算「字」：文字與數字各算一個，標點、空白不算。 */
const unitsOf = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length
const trimPunct = (text: string): string =>
  text.replace(/^[\s，、；：,;:]+|[\s，、；：,;:]+$/gu, '')

/** 從頭數 n 個字（標點不算）的地方切開。 */
function splitAtUnits(text: string, n: number): [string, string] {
  const chars = Array.from(text)
  let seen = 0
  for (let i = 0; i < chars.length; i++) {
    if (/[\p{L}\p{N}]/u.test(chars[i] ?? '')) seen++
    if (seen === n) return [chars.slice(0, i + 1).join(''), chars.slice(i + 1).join('')]
  }
  return [text, '']
}

/** 平均分成 k 行（不看標點）。 */
function evenSplit(text: string, k: number): string[] {
  const lines: string[] = []
  let rest = text
  for (let left = k; left > 1; left--) {
    const [first, remaining] = splitAtUnits(rest, Math.round(unitsOf(rest) / left))
    lines.push(trimPunct(first))
    rest = remaining
  }
  lines.push(trimPunct(rest))
  return lines
}

/** 先找離「每行該有的字數」最近的標點（3 個字以內）斷開，行尾的標點拿掉；找不到就從那個字數切。 */
function punctSplit(text: string, k: number): string[] {
  if (k <= 1) return [trimPunct(text)]
  const target = Math.round(unitsOf(text) / k)
  const chars = Array.from(text)
  let seen = 0
  let best: { index: number; diff: number } | undefined
  chars.forEach((ch, index) => {
    if (/[\p{L}\p{N}]/u.test(ch)) seen++
    else if (BREAK_PUNCT.test(ch) && seen >= 1) {
      const diff = Math.abs(seen - target)
      if (diff <= 3 && (best === undefined || diff < best.diff)) best = { index, diff }
    }
  })
  const [first, rest] = best
    ? [chars.slice(0, best.index).join(''), chars.slice(best.index + 1).join('')]
    : splitAtUnits(text, target)
  return [trimPunct(first), ...punctSplit(rest, k - 1)]
}

/**
 * 一段字斷成幾行：一行放得下（perLine 個中文字、英文約兩倍字母）就一行；要多行時，先在離平均長度最近、
 * 3 個字以內的標點斷開（行尾的標點拿掉），沒有就從平均長度切；任何一行少於 3 個字（孤字）就改成平均分。
 * 英文照單字斷，行與行的長度盡量平均。行數不超過 maxLines。
 */
export function breakText(text: string, limits: { perLine: number; maxLines: number }): string[] {
  const clean = text.trim()
  if (clean === '') return []
  const { perLine, maxLines } = limits
  if (/\p{Script=Han}/u.test(clean)) {
    const total = unitsOf(clean)
    if (total <= perLine || maxLines <= 1) return [clean]
    const k = Math.min(maxLines, Math.max(2, Math.ceil(total / perLine)))
    const lines = punctSplit(clean, k)
    return lines.some((line) => unitsOf(line) < 3) ? evenSplit(clean, k) : lines
  }
  // 英文：一行放得下就一行，不然照單字平均分
  const words = clean.split(/\s+/u)
  const capacity = perLine * 2
  if (clean.length <= capacity || words.length < 2 || maxLines <= 1) return [clean]
  const k = Math.min(maxLines, words.length, Math.max(2, Math.ceil(clean.length / capacity)))
  const widthOf = (from: number, to: number): number => words.slice(from, to).join(' ').length
  let best: number[] = []
  let bestMax = Infinity
  const search = (start: number, left: number, cuts: number[]): void => {
    if (left === 1) {
      const all = [...cuts, words.length]
      let from = 0
      const max = Math.max(
        ...all.map((to) => {
          const w = widthOf(from, to)
          from = to
          return w
        }),
      )
      if (max < bestMax) {
        bestMax = max
        best = all
      }
      return
    }
    for (let cut = start + 1; cut <= words.length - (left - 1); cut++)
      search(cut, left - 1, [...cuts, cut])
  }
  search(0, k, [])
  let from = 0
  return best.map((to) => {
    const line = words.slice(from, to).join(' ')
    from = to
    return line
  })
}
