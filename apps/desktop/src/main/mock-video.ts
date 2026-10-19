import { imageToVideo, probe, type MediaTools } from '@svs/media'
import { renderMockFrame, type MockProviderConfig } from '@svs/providers'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 示範影片：把帶文字的色塊畫面用 FFmpeg 拉成指定長度（含靜音音軌，之後接片規格一致）。 */
export function createMockVideoRenderer(
  tools: MediaTools,
  renderFrame?: MockProviderConfig['renderFrame'],
): NonNullable<MockProviderConfig['renderVideo']> {
  return async ({ frame: content, label, width, height, durationSec }) => {
    const dir = await mkdtemp(join(tmpdir(), 'svs-mockvideo-'))
    try {
      const frame = join(dir, 'frame.png')
      const out = join(dir, 'out.mp4')
      // 有系統字型的畫法就用它（中文正常），沒有就退回點陣字型
      const drawn = await renderFrame?.(content)
      await writeFile(frame, drawn ?? renderMockFrame(label, width, height))
      await imageToVideo(tools, frame, out, { durationSec, silentAudio: true })
      const info = await probe(tools, out)
      return {
        bytes: new Uint8Array(await readFile(out)),
        width: info.width ?? width,
        height: info.height ?? height,
        durationSec: info.durationSec,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}
