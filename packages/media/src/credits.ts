import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { concatVideos, imageToVideo } from './ops'
import { probe } from './probe'
import { runTool, type MediaTools, type RunOptions } from './run'

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

/**
 * 把一張字卡圖蓋在影片的某一段上（預告片匯出：AI 服務標註併進片名卡，影片長度不變）。
 * 字卡圖跟被蓋住的那一段一樣大小、同一個版面（只多了標註），所以蓋上去只看得到多出來的那一行；
 * 只重編畫面，聲音原封不動。只用在匯出的檔案，不會改到專案裡的成品。
 */
export async function overlayCard(
  tools: MediaTools,
  video: string,
  cardImage: string,
  output: string,
  range: { fromSec: number; toSec: number },
  options: RunOptions = {},
): Promise<void> {
  const info = await probe(tools, video, options)
  const fps = String(Math.round(info.fps ?? 24))
  // 影格的時間戳會差半格以內：起訖各提早 0.02 秒，第一格與最後一格都不會漏或多蓋
  const from = Math.max(0, range.fromSec - 0.02).toFixed(3)
  const to = Math.max(0, range.toSec - 0.02).toFixed(3)
  const size = info.width && info.height ? `${String(info.width)}:${String(info.height)}` : 'iw:ih'
  await runTool(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      video,
      '-loop',
      '1',
      '-framerate',
      fps,
      '-i',
      cardImage,
      '-filter_complex',
      `[1:v]scale=${size}[card];[0:v][card]overlay=0:0:shortest=1:enable='gte(t,${from})*lt(t,${to})',format=yuv420p[v]`,
      '-map',
      '[v]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ],
    options,
  )
}
