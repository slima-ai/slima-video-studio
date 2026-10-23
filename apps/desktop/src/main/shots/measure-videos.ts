import type { ProjectHandle } from '@svs/db'
import { countVideoFrames, probe, type MediaTools } from '@svs/media'

/**
 * 影片素材的長度要是檔案實際的長度。供應商存進來的影片，長度記的是「送出去的要求秒數」（5 秒），
 * 實際檔案常常是 5.0417 秒（121 格）：聲音時間軸、旁白位置都靠這個長度，差 0.04 秒累積到第 8 鏡就差 0.3 秒。
 * 量過的影片一定有大小（width），沒有大小的就是還沒量過。
 */
export async function measureVideoAsset(
  handle: ProjectHandle,
  tools: MediaTools,
  hash: string,
): Promise<{ width?: number; height?: number; durationSec: number } | undefined> {
  const found = handle.assets.find(hash)
  if (!found) return undefined
  try {
    const info = await probe(tools, found.path)
    if (!info.hasVideo) return undefined
    // App 內建的 FFmpeg 沒有 ffprobe，長度只到百分之一秒（5.0417 秒印成 5.04）：沒有音軌的影片改用「格數 ÷ 幀率」，
    // 才不會每一鏡差 0.002 秒、50 鏡累積成 0.1 秒
    const frames =
      tools.ffprobePath === null && !info.hasAudio && info.fps
        ? await countVideoFrames(tools, found.path)
        : undefined
    const measured = {
      ...(info.width ? { width: info.width } : {}),
      ...(info.height ? { height: info.height } : {}),
      durationSec:
        frames !== undefined && info.fps
          ? Math.round((frames / Math.round(info.fps)) * 1e6) / 1e6
          : info.durationSec,
    }
    handle.assets.updateMeta(hash, measured)
    return measured
  } catch {
    // 量不到就維持原樣（長度還是要求的秒數）；不讓一支壞掉的影片擋住整個專案
    return undefined
  }
}

/** 專案裡還沒量過的影片（舊專案）全部量一次；回傳有幾支被更正。 */
export async function measureVideoAssets(
  handle: ProjectHandle,
  tools: MediaTools,
): Promise<number> {
  let changed = 0
  for (const asset of handle.assets.list()) {
    if (handle.closed) break
    if (asset.kind !== 'video' || asset.width !== undefined) continue
    const before = asset.durationSec
    const measured = await measureVideoAsset(handle, tools, asset.hash)
    if (measured && before !== undefined && Math.abs(measured.durationSec - before) > 0.001)
      changed++
  }
  return changed
}
