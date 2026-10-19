import type { ProjectHandle } from '@svs/db'
import type { ModelRegistry } from '@svs/providers'

/** 把一組文字畫成一張指定大小的 PNG（正式版用 Electron 離屏視窗；測試給假的）。 */
export type CardRenderer = (input: {
  lines: readonly string[]
  width: number
  height: number
  /** 被取消（例如等太久）時要放掉手上的資源（離屏視窗）。 */
  signal?: AbortSignal
}) => Promise<Uint8Array>

/** 畫片尾字卡最多等多久；超過就改匯出沒有字卡的版本（匯出不能被一張字卡無限期卡住）。 */
export const CREDITS_RENDER_TIMEOUT_MS = 20_000

/** 最後一行：產品本身。 */
export const MADE_WITH = 'Made with Slima Video Studio'

/** 標註的排列順序：影片、圖片、聲音、配樂、其他（文字模型）。 */
const ORDER = ['Video', 'Images', 'Voice', 'Music']

const rank = (line: string): number => {
  const index = ORDER.findIndex((prefix) => line.startsWith(prefix))
  return index === -1 ? ORDER.length : index
}

/**
 * 這個專案實際用了哪些 AI 服務（要標註的）：各鏡採用中的首幀圖與影片、採用中的旁白與配樂、成功的文字生成。
 * 用模型卡上的 attribution；沒有 attribution 的（示範模型）不列。去重，依影片、圖片、聲音、配樂、其他排序。
 */
export function collectAttributions(
  handle: ProjectHandle,
  models: Pick<ModelRegistry, 'get'>,
): string[] {
  const modelIds = new Set<string>()
  for (const shot of handle.repos.shots.list()) {
    for (const kind of ['first_frame', 'video'] as const) {
      const take = handle.repos.shots.listTakes(shot.id, kind).find((t) => t.adopted)
      if (take) modelIds.add(take.modelId)
    }
  }
  for (const clip of handle.repos.sound.listClips({ adoptedOnly: true })) modelIds.add(clip.modelId)
  for (const job of handle.repos.jobs.list()) {
    if (job.kind === 'llm' && job.status === 'succeeded') modelIds.add(job.modelId)
  }
  const lines = new Set<string>()
  for (const id of modelIds) {
    const line = models.get(id)?.attribution
    if (line) lines.add(line)
  }
  return [...lines].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** 字卡上的文字：各項標註，最後是「Made with Slima Video Studio」。 */
export function creditLines(attributions: readonly string[]): string[] {
  return [...attributions, MADE_WITH]
}
