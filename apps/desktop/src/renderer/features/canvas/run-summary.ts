import type { CanvasRunStep } from '@svs/schema'

/** 一行列得下幾個鏡頭；再多就寫「等 N 個鏡頭」。 */
const MAX_GROUPS = 3

/**
 * 確認面板那份清單的一行摘要，給「開始生成」「完成」的提示用，和面板說的一致：
 * 「第 4 鏡 第一張畫面、影片（2 步）」「第 1 鏡 影片；第 3 鏡 第一張畫面、影片、接成成品（4 步）」。
 */
export function runSummary(steps: readonly CanvasRunStep[]): string {
  const groups: { shot: string; parts: string[] }[] = []
  let join = false
  for (const step of steps) {
    if (step.kind === 'cut') {
      join = true
      continue
    }
    const [shot = '', part = step.label] = step.label.split('：')
    const group = groups.find((g) => g.shot === shot)
    if (group) group.parts.push(part)
    else groups.push({ shot, parts: [part] })
  }
  const shown = groups.slice(0, MAX_GROUPS).map((g) => `${g.shot} ${g.parts.join('、')}`)
  const more = groups.length > MAX_GROUPS ? `等 ${String(groups.length)} 個鏡頭` : ''
  const list = [shown.join('；') + more, ...(join ? ['接成成品'] : [])]
    .filter((text) => text !== '')
    .join('、')
  return `${list}（${String(steps.length)} 步）`
}
