import { AppError } from '@svs/schema'

import { probe } from './probe'
import { runTool, runToolRaw, type MediaTools, type RunOptions } from './run'

const BASE = ['-hide_banner', '-loglevel', 'error', '-y'] as const
const RATE = 48_000
/** 每條音軌先統一成 48 kHz、立體聲、浮點，後面的濾鏡才接得起來。 */
const STEREO = `aresample=${String(RATE)},aformat=sample_fmts=fltp:channel_layouts=stereo`

/** 旁白或音效：放在影片時間軸的 startSec 開始。 */
export interface MixClip {
  file: string
  /** 從整支影片開頭算起的秒數（鏡頭起點加上這一段在鏡頭內的偏移）。 */
  startSec: number
  gainDb?: number
  fadeInSec?: number
  fadeOutSec?: number
}

/** 整支的配樂：比影片短就接著循環（接縫做交叉淡化），比影片長就截掉。 */
export interface MixMusic {
  file: string
  gainDb?: number
  fadeInSec?: number
  fadeOutSec?: number
}

export interface MixOptions extends RunOptions {
  narration?: readonly MixClip[]
  sfx?: readonly MixClip[]
  music?: MixMusic
  /** 影片自己的聲音（例如 Kling 的原聲）的增益；預設 0 dB。 */
  nativeGainDb?: number
  /** 靜音影片原聲（仍然保留影片長度）。 */
  muteNative?: boolean
  /** 只靜音影片原聲的某幾段（例如不想要原聲的鏡頭）；秒數從影片開頭算起。 */
  nativeMutes?: readonly { startSec: number; endSec: number }[]
  /** 旁白出現時自動壓低原聲與配樂；預設開。 */
  duck?: boolean
  /** 整體響度正規化；預設開，目標 −16 LUFS、真峰值 −1.5 dBTP。 */
  normalize?: boolean
  targetLufs?: number
  truePeakDb?: number
}

const DEFAULTS = {
  narrationGainDb: 0,
  narrationFadeIn: 0.05,
  narrationFadeOut: 0.15,
  sfxFadeIn: 0.02,
  sfxFadeOut: 0.1,
  musicGainDb: -18,
  musicFadeIn: 1.5,
  musicFadeOut: 3,
  musicLoopCrossfade: 2,
  targetLufs: -16,
  truePeakDb: -1.5,
} as const

/** 壓低用的側鏈壓縮器：旁白一出現就把原聲和配樂壓下去，停了約 0.4 秒內回來。 */
const DUCK = 'sidechaincompress=threshold=0.015:ratio=6:attack=20:release=400:makeup=1'
const MAX_LOOP_COPIES = 40

const num = (n: number): string => n.toFixed(3)

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

interface ClipPlan extends MixClip {
  durationSec: number
}

/** 單一旁白／音效的濾鏡鏈：統一格式、增益、前後淡化、移到影片時間軸上的位置。 */
function clipChain(
  index: number,
  clip: ClipPlan,
  defaults: { fadeIn: number; fadeOut: number },
  label: string,
): string {
  const fadeIn = Math.min(clip.fadeInSec ?? defaults.fadeIn, clip.durationSec)
  const fadeOut = Math.min(clip.fadeOutSec ?? defaults.fadeOut, clip.durationSec)
  const chain = [`[${String(index)}:a]${STEREO}`, `volume=${num(clip.gainDb ?? 0)}dB`]
  if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${num(fadeIn)}`)
  if (fadeOut > 0) chain.push(`afade=t=out:st=${num(clip.durationSec - fadeOut)}:d=${num(fadeOut)}`)
  chain.push(`adelay=${String(Math.round(clip.startSec * 1000))}:all=1`)
  return `${chain.join(',')}[${label}]`
}

interface MusicPlan extends MixMusic {
  durationSec: number
}

/** 配樂要重複幾次才蓋得住整支影片（比影片長就是 1）。 */
function musicCopies(music: MusicPlan, videoSec: number): number {
  if (music.durationSec >= videoSec - 0.05) return 1
  const fade = Math.min(DEFAULTS.musicLoopCrossfade, music.durationSec / 4)
  const copies = Math.ceil((videoSec - fade) / (music.durationSec - fade))
  if (copies > MAX_LOOP_COPIES) {
    throw invalid('配樂太短，無法循環到整支影片的長度，請換一首長一點的。')
  }
  return copies
}

/**
 * 配樂的濾鏡鏈：循環（必要時）、截到影片長度、淡入淡出、增益。
 * 循環時同一個檔案會被當成多個輸入（第一個輸入編號 firstIndex，共 copies 個）接起來，
 * 不用 asplit：FFmpeg 6.0 對 asplit 後接 acrossfade 只會輸出前兩秒。
 */
function musicChain(
  firstIndex: number,
  copies: number,
  music: MusicPlan,
  videoSec: number,
  label: string,
): string[] {
  const parts: string[] = []
  /** 接在後面的濾鏡鏈起頭：直接吃輸入（要加逗號），或吃循環接好的標籤（不加）。 */
  let source: string
  if (copies > 1) {
    const fade = Math.min(DEFAULTS.musicLoopCrossfade, music.durationSec / 4)
    const names = Array.from({ length: copies }, (_, i) => `mc${String(i)}`)
    for (const [i, name] of names.entries()) {
      parts.push(`[${String(firstIndex + i)}:a]${STEREO}[${name}]`)
    }
    let joined = names[0] ?? ''
    for (const [i, name] of names.slice(1).entries()) {
      const next = `mj${String(i)}`
      parts.push(`[${joined}][${name}]acrossfade=d=${num(fade)}[${next}]`)
      joined = next
    }
    source = `[${joined}]`
  } else {
    source = `[${String(firstIndex)}:a]${STEREO},`
  }
  // 影片太短時，淡入加淡出不能超過全長
  const scale = Math.min(
    1,
    videoSec /
      Math.max(
        0.001,
        (music.fadeInSec ?? DEFAULTS.musicFadeIn) + (music.fadeOutSec ?? DEFAULTS.musicFadeOut),
      ),
  )
  const fadeIn = (music.fadeInSec ?? DEFAULTS.musicFadeIn) * scale
  const fadeOut = (music.fadeOutSec ?? DEFAULTS.musicFadeOut) * scale
  const tail = [`${source}atrim=0:${num(videoSec)}`, 'asetpts=PTS-STARTPTS']
  if (fadeIn > 0) tail.push(`afade=t=in:st=0:d=${num(fadeIn)}`)
  if (fadeOut > 0) tail.push(`afade=t=out:st=${num(videoSec - fadeOut)}:d=${num(fadeOut)}`)
  tail.push(`volume=${num(music.gainDb ?? DEFAULTS.musicGainDb)}dB`)
  parts.push(`${tail.join(',')}[${label}]`)
  return parts
}

export interface MixPlan {
  /** 影片（第 0 個輸入）之後依序是這些音檔。 */
  inputs: string[]
  /** 以 `[mix]` 結尾的濾鏡圖（還沒做響度正規化）。 */
  graph: string
}

/**
 * 組出混音用的 filter_complex（純函式，方便測試）。
 * 輸入編號：0 = 影片，其後依序是旁白、音效、配樂。
 */
export function buildMixGraph(input: {
  video: string
  videoSec: number
  videoHasAudio: boolean
  narration: readonly ClipPlan[]
  sfx: readonly ClipPlan[]
  music?: MusicPlan
  nativeGainDb: number
  muteNative: boolean
  nativeMutes?: readonly { startSec: number; endSec: number }[]
  duck: boolean
}): MixPlan {
  const { videoSec } = input
  const inputs: string[] = [input.video]
  const parts: string[] = []

  // 影片原聲（沒有聲音的影片就用靜音墊著，讓整支長度對得上）
  const rangeMutes = (input.nativeMutes ?? []).map(
    (r) => `volume=0:enable='between(t,${num(r.startSec)},${num(r.endSec)})'`,
  )
  const nativeGain = [
    input.muteNative ? 'volume=0' : `volume=${num(input.nativeGainDb)}dB`,
    ...(input.muteNative ? [] : rangeMutes),
  ].join(',')
  parts.push(
    input.videoHasAudio
      ? `[0:a]${STEREO},${nativeGain}[nat]`
      : `anullsrc=r=${String(RATE)}:cl=stereo,atrim=0:${num(videoSec)},${nativeGain}[nat]`,
  )

  // 旁白匯流排
  const voLabels: string[] = []
  for (const [i, clip] of input.narration.entries()) {
    inputs.push(clip.file)
    const label = `vo${String(i)}`
    parts.push(
      clipChain(
        inputs.length - 1,
        { ...clip, gainDb: clip.gainDb ?? DEFAULTS.narrationGainDb },
        { fadeIn: DEFAULTS.narrationFadeIn, fadeOut: DEFAULTS.narrationFadeOut },
        label,
      ),
    )
    voLabels.push(label)
  }

  // 音效
  const sfxLabels: string[] = []
  for (const [i, clip] of input.sfx.entries()) {
    inputs.push(clip.file)
    const label = `sx${String(i)}`
    parts.push(
      clipChain(
        inputs.length - 1,
        clip,
        { fadeIn: DEFAULTS.sfxFadeIn, fadeOut: DEFAULTS.sfxFadeOut },
        label,
      ),
    )
    sfxLabels.push(label)
  }

  // 配樂
  let musicLabel: string | undefined
  if (input.music) {
    const copies = musicCopies(input.music, videoSec)
    const firstIndex = inputs.length
    for (let i = 0; i < copies; i++) inputs.push(input.music.file)
    musicLabel = 'mus'
    parts.push(...musicChain(firstIndex, copies, input.music, videoSec, musicLabel))
  }

  // 旁白合成一軌；要壓低時，這一軌同時當原聲與配樂的壓縮觸發訊號
  const mixLabels: string[] = []
  let nativeOut = 'nat'
  let musicOut = musicLabel
  if (voLabels.length > 0) {
    parts.push(
      voLabels.length === 1
        ? `[${voLabels[0] ?? ''}]anull[vo]`
        : `${voLabels.map((l) => `[${l}]`).join('')}amix=inputs=${String(voLabels.length)}:normalize=0:dropout_transition=0[vo]`,
    )
    const targets = input.duck ? 1 + (musicLabel ? 1 : 0) : 0
    if (targets > 0) {
      // 側鏈要補靜音到全片長度，否則壓縮器會在旁白結束時跟著收尾，把後面的原聲和配樂截掉
      const sidechains = Array.from({ length: targets }, (_, i) => `sc${String(i)}`)
      parts.push(
        `[vo]apad=whole_dur=${num(videoSec)},asplit=${String(targets + 1)}[vomix]${sidechains.map((s) => `[${s}]`).join('')}`,
      )
      parts.push(`[nat][sc0]${DUCK}[natd]`)
      nativeOut = 'natd'
      if (musicLabel) {
        parts.push(`[${musicLabel}][sc1]${DUCK}[musd]`)
        musicOut = 'musd'
      }
      mixLabels.push('vomix')
    } else {
      mixLabels.push('vo')
    }
  }
  mixLabels.unshift(nativeOut, ...sfxLabels)
  if (musicOut) mixLabels.push(musicOut)

  parts.push(
    mixLabels.length === 1
      ? `[${mixLabels[0] ?? ''}]anull[mix]`
      : `${mixLabels.map((l) => `[${l}]`).join('')}amix=inputs=${String(mixLabels.length)}:normalize=0:dropout_transition=0:duration=first[mix]`,
  )
  return { inputs, graph: parts.join(';') }
}

export interface Loudness {
  /** 整體響度（LUFS）；整段靜音時是 undefined。 */
  integratedLufs: number | undefined
  truePeakDb: number | undefined
  loudnessRange: number | undefined
  /** 套用線性正規化需要的量測值（只有 measureLoudness 內部用）。 */
  thresholdLufs: number | undefined
  offsetDb: number | undefined
}

const finite = (value: unknown): number | undefined => {
  const n = Number(value)
  return typeof value === 'string' && Number.isFinite(n) ? n : undefined
}

function parseLoudnorm(stderr: string): Loudness {
  const match = /\{[^{}]*"input_i"[^{}]*\}/s.exec(stderr)
  if (!match) {
    throw new AppError({
      code: 'internal_error',
      userMessage: '量測音量失敗。',
      cause: new Error(stderr.slice(-500)),
    })
  }
  const json = JSON.parse(match[0]) as Record<string, unknown>
  return {
    integratedLufs: finite(json.input_i),
    truePeakDb: finite(json.input_tp),
    loudnessRange: finite(json.input_lra),
    thresholdLufs: finite(json.input_thresh),
    offsetDb: finite(json.target_offset),
  }
}

/** 量一個音訊或影片檔的整體響度（EBU R128）與真峰值。 */
export async function measureLoudness(
  tools: MediaTools,
  file: string,
  options: RunOptions & { targetLufs?: number; truePeakDb?: number } = {},
): Promise<Loudness> {
  const target = options.targetLufs ?? DEFAULTS.targetLufs
  const peak = options.truePeakDb ?? DEFAULTS.truePeakDb
  const { stderr } = await runToolRaw(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vn',
      '-af',
      `loudnorm=I=${String(target)}:TP=${String(peak)}:LRA=11:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    options,
  )
  return parseLoudnorm(stderr)
}

/**
 * 量某一段的平均音量（RMS，dB；整段靜音回傳 −Infinity）。
 * `filter` 可以先接一段濾鏡，例如 `bandpass=f=330:width_type=h:w=40`，只量某個頻率。
 */
export async function measureRmsDb(
  tools: MediaTools,
  file: string,
  options: RunOptions & { startSec?: number; durationSec?: number; filter?: string } = {},
): Promise<number> {
  const { stderr } = await runToolRaw(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      ...(options.startSec === undefined ? [] : ['-ss', String(options.startSec)]),
      ...(options.durationSec === undefined ? [] : ['-t', String(options.durationSec)]),
      '-i',
      file,
      '-vn',
      '-af',
      `${options.filter === undefined ? '' : `${options.filter},`}astats=metadata=0:reset=0`,
      '-f',
      'null',
      '-',
    ],
    options,
  )
  const overall = stderr.slice(stderr.lastIndexOf('Overall'))
  const rms = /RMS level dB:\s*(-?inf|-?[\d.]+)/.exec(overall)?.[1]
  if (rms === undefined) {
    throw new AppError({
      code: 'internal_error',
      userMessage: '量測音量失敗。',
      cause: new Error(stderr.slice(-500)),
    })
  }
  return rms.endsWith('inf') ? Number.NEGATIVE_INFINITY : Number(rms)
}

async function planClips(
  tools: MediaTools,
  clips: readonly MixClip[],
  videoSec: number,
  what: string,
  options: RunOptions,
): Promise<ClipPlan[]> {
  const plans: ClipPlan[] = []
  for (const clip of clips) {
    if (!(clip.startSec >= 0) || clip.startSec >= videoSec) {
      throw invalid(`${what}的位置超出影片長度，請調整它的起點。`)
    }
    const info = await probe(tools, clip.file, options)
    if (!info.hasAudio) throw invalid(`${what}的檔案裡沒有聲音。`)
    plans.push({ ...clip, durationSec: info.durationSec })
  }
  return plans
}

/**
 * 把旁白、音效、配樂混進一支影片：影像直接複製（不重編），只重編音訊，輸出 AAC 立體聲的 MP4。
 *
 * - 旁白、音效依 `startSec` 對齊影片時間軸；
 * - 配樂淡入淡出、比影片短就循環；
 * - 旁白出現時，影片原聲與配樂自動壓低；
 * - 最後做兩趟響度正規化（先量再套用）到目標響度，整段靜音則略過。
 */
export async function mixAudio(
  tools: MediaTools,
  video: string,
  output: string,
  options: MixOptions = {},
): Promise<void> {
  const videoInfo = await probe(tools, video, options)
  if (!videoInfo.hasVideo || !(videoInfo.durationSec > 0)) {
    throw invalid('要混音的檔案沒有影像，無法處理。')
  }
  const videoSec = videoInfo.durationSec
  const narration = await planClips(tools, options.narration ?? [], videoSec, '旁白', options)
  const sfx = await planClips(tools, options.sfx ?? [], videoSec, '音效', options)
  let music: MusicPlan | undefined
  if (options.music) {
    const info = await probe(tools, options.music.file, options)
    if (!info.hasAudio || !(info.durationSec > 0)) throw invalid('配樂的檔案裡沒有聲音。')
    music = { ...options.music, durationSec: info.durationSec }
  }

  const plan = buildMixGraph({
    video,
    videoSec,
    videoHasAudio: videoInfo.hasAudio,
    narration,
    sfx,
    ...(music ? { music } : {}),
    nativeGainDb: options.nativeGainDb ?? 0,
    muteNative: options.muteNative ?? false,
    ...(options.nativeMutes === undefined ? {} : { nativeMutes: options.nativeMutes }),
    duck: options.duck ?? true,
  })
  const inputArgs = plan.inputs.flatMap((file) => ['-i', file])

  let tail = `[mix]aresample=${String(RATE)}[out]`
  if (options.normalize ?? true) {
    const target = options.targetLufs ?? DEFAULTS.targetLufs
    const peak = options.truePeakDb ?? DEFAULTS.truePeakDb
    const norm = `I=${String(target)}:TP=${String(peak)}:LRA=11`
    // 第一趟：只算混音後的響度（不輸出檔案）
    const { stderr } = await runToolRaw(
      tools.ffmpegPath,
      [
        '-hide_banner',
        '-nostats',
        ...inputArgs,
        '-filter_complex',
        `${plan.graph};[mix]loudnorm=${norm}:print_format=json[m]`,
        '-map',
        '[m]',
        '-t',
        num(videoSec),
        '-f',
        'null',
        '-',
      ],
      options,
    )
    const measured = parseLoudnorm(stderr)
    if (
      measured.integratedLufs !== undefined &&
      measured.truePeakDb !== undefined &&
      measured.loudnessRange !== undefined &&
      measured.thresholdLufs !== undefined &&
      measured.offsetDb !== undefined
    ) {
      tail =
        `[mix]loudnorm=${norm}:measured_I=${String(measured.integratedLufs)}` +
        `:measured_TP=${String(measured.truePeakDb)}:measured_LRA=${String(measured.loudnessRange)}` +
        `:measured_thresh=${String(measured.thresholdLufs)}:offset=${String(measured.offsetDb)}` +
        `:linear=true,aresample=${String(RATE)},aformat=channel_layouts=stereo[out]`
    }
  }

  await runTool(
    tools.ffmpegPath,
    [
      ...BASE,
      ...inputArgs,
      '-filter_complex',
      `${plan.graph};${tail}`,
      '-map',
      '0:v',
      '-map',
      '[out]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      num(videoSec),
      '-movflags',
      '+faststart',
      output,
    ],
    options,
  )
}

export interface SilenceSpan {
  startSec: number
  endSec: number
}

/**
 * 找出安靜的段落（低於 noiseDb 持續至少 minSec 秒）。成品檢查用：旁白該出現的地方不該整段安靜、
 * 整支片子也不該前後都沒有聲音。
 */
export async function detectSilences(
  tools: MediaTools,
  file: string,
  options: RunOptions & { noiseDb?: number; minSec?: number } = {},
): Promise<SilenceSpan[]> {
  const { stderr } = await runToolRaw(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vn',
      '-af',
      `silencedetect=noise=${String(options.noiseDb ?? -50)}dB:d=${String(options.minSec ?? 0.5)}`,
      '-f',
      'null',
      '-',
    ],
    options,
  )
  const spans: SilenceSpan[] = []
  let open: number | undefined
  for (const line of stderr.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)?.[1]
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)?.[1]
    if (start !== undefined) open = Math.max(0, Number(start))
    if (end !== undefined && open !== undefined) {
      spans.push({ startSec: open, endSec: Number(end) })
      open = undefined
    }
  }
  // 一直安靜到檔案結尾：只有 start 沒有 end
  if (open !== undefined) {
    const info = await probe(tools, file, options)
    spans.push({ startSec: open, endSec: info.durationSec })
  }
  return spans
}
