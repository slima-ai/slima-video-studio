import { MOCK_MUSIC_MP3_BASE64, MOCK_NARRATION_MP3_BASE64 } from './mp3-samples'

/** MPEG-1 Layer III 的位元率表（kbps）與取樣率表（Hz）；樣本只會用到這一種。 */
const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const SAMPLE_RATES = [44100, 48000, 32000]
const SAMPLES_PER_FRAME = 1152

export type MockMp3Kind = 'narration' | 'music'

interface FrameSet {
  frames: Buffer[]
  frameSec: number
}

const cache = new Map<MockMp3Kind, FrameSet>()

/** 把 mp3 樣本切成一個個影格；樣本沒有 ID3／Xing，從頭到尾都是影格。 */
function splitFrames(bytes: Buffer): FrameSet {
  const frames: Buffer[] = []
  let sampleRate = 0
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const header = bytes.readUInt32BE(offset)
    const bitrate = BITRATES_KBPS[(header >>> 12) & 0xf]
    const rate = SAMPLE_RATES[(header >>> 10) & 0x3]
    if (header >>> 21 !== 0x7ff || !bitrate || !rate) {
      throw new Error(`示範 mp3 樣本在 ${offset} 處不是有效影格`)
    }
    sampleRate = rate
    const size = Math.floor((144 * bitrate * 1000) / rate) + ((header >>> 9) & 1)
    frames.push(bytes.subarray(offset, offset + size))
    offset += size
  }
  return { frames, frameSec: SAMPLES_PER_FRAME / sampleRate }
}

function frameSet(kind: MockMp3Kind): FrameSet {
  let set = cache.get(kind)
  if (!set) {
    const base64 = kind === 'narration' ? MOCK_NARRATION_MP3_BASE64 : MOCK_MUSIC_MP3_BASE64
    set = splitFrames(Buffer.from(base64, 'base64'))
    cache.set(kind, set)
  }
  return set
}

/**
 * 產生約 `durationSec` 秒的 mp3（重複樣本的影格，長度取到最近的整個影格）。
 * `durationSec` 回傳的是實際長度（影格數 × 每格秒數），素材庫的長度以它為準。
 */
export function makeMp3(
  kind: MockMp3Kind,
  durationSec: number,
): { bytes: Buffer; durationSec: number } {
  const { frames, frameSec } = frameSet(kind)
  const count = Math.max(1, Math.round(durationSec / frameSec))
  const parts: Buffer[] = []
  for (let i = 0; i < count; i++) {
    const frame = frames[i % frames.length]
    if (frame) parts.push(frame)
  }
  return { bytes: Buffer.concat(parts), durationSec: count * frameSec }
}
