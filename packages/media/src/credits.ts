import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { concatVideos, imageToVideo } from './ops'
import { probe } from './probe'
import type { MediaTools, RunOptions } from './run'

/**
 * 在影片最後面接一張靜態字卡（匯出時的片尾「用了哪些 AI 服務」）。
 * 字卡圖先變成指定長度、有靜音音軌的影片，再用接片的方式接在最後；解析度與幀率跟著原本的影片。
 * 只用在匯出的檔案，不會改到專案裡的成品。
 */
export async function appendEndCard(
  tools: MediaTools,
  video: string,
  cardImage: string,
  output: string,
  options: RunOptions & { cardSeconds?: number } = {},
): Promise<void> {
  const info = await probe(tools, video, options)
  const dir = await mkdtemp(join(tmpdir(), 'svs-card-'))
  try {
    const card = join(dir, 'card.mp4')
    await imageToVideo(tools, cardImage, card, {
      durationSec: options.cardSeconds ?? 3,
      silentAudio: true,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    await concatVideos(tools, [video, card], output, {
      ...(info.width ? { width: info.width } : {}),
      ...(info.height ? { height: info.height } : {}),
      ...(info.fps ? { fps: Math.round(info.fps) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
