import type { ProjectHandle } from '@svs/db'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { budgetExceededError, checkBudget } from '@svs/engine'
import { mixAudio, probe, type MediaTools, type MixClip } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import {
  AppError,
  DEFAULT_NARRATION_OFFSET_SEC,
  NARRATION_MAX_CHARS,
  billableChars,
  isAppError,
  type AssetRef,
  type SoundClip,
  type SoundClipPatchInput,
  type SoundPlan,
  type SoundPlanRequest,
  type SoundSettings,
  type SoundSettingsPatch,
  type SoundShotView,
  type SoundState,
  type SoundWarning,
} from '@svs/schema'

import type { ShotService } from '../shots/shot-service'
import type { Logger } from '../logger'
import type { ProjectManager } from '../project-manager'
import { findTools, type Broadcast, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import type { SettingsStore } from '../settings/settings-store'
import { createStudioServices } from '../studio-services'

export interface SoundServiceDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settings: SettingsStore
  settingsService: SettingsService
  models: ModelRegistry
  broadcast: Broadcast
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  tools?: () => MediaTools | undefined
  /** 混音後成品有變動時，叫鏡頭服務推送最新的快照（成品面板跟著更新）。 */
  shots?: Pick<ShotService, 'list'>
}

export interface SoundService {
  state: () => SoundState
  plan: (request: SoundPlanRequest) => SoundPlan
  generateNarration: (input: {
    shotId: string
    text?: string | undefined
    voiceId?: string | undefined
  }) => Promise<SoundClip>
  generateMusic: (input: {
    prompt?: string | undefined
    durationSec?: number | undefined
  }) => Promise<SoundClip>
  updateClip: (clipId: string, patch: SoundClipPatchInput) => SoundClip
  adoptClip: (clipId: string) => SoundClip
  removeClip: (clipId: string) => void
  updateSettings: (patch: SoundSettingsPatch) => SoundSettings
  /** 目前聲音的指紋（採用中的片段與設定）；沒有聲音要處理是 undefined。成品記著它，不一樣就是過期。 */
  soundKey: (handle: ProjectHandle) => string | undefined
  /** 把聲音混進接好的影片（接片時用）；沒有聲音要處理回傳 undefined。 */
  mixInto: (
    handle: ProjectHandle,
    base: AssetRef,
    signal: AbortSignal,
  ) => Promise<{ asset: AssetRef; soundKey: string } | undefined>
  /** 用最新成品的接片結果重新混音（不花錢、不用重新接片），存成新的成品版本。 */
  mix: () => Promise<{ videoHash: string; version: number }>
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 旁白長過鏡頭時，最多可以溢出到下一鏡幾秒；超過就警示。 */
const NARRATION_SPILL_SEC = 1.5

const outputAsset = (output: unknown): { hash: string; mime: string } => {
  const assets = (output as { kind?: string; assets?: { hash: string; mime: string }[] }).assets
  const first = assets?.[0]
  if (!first) {
    throw new AppError({ code: 'invalid_response', userMessage: '供應商沒有回傳聲音。' })
  }
  return first
}

/**
 * 聲音：每鏡的旁白、整支的配樂。生成走跟其他生成一樣的任務佇列（並行與重試、花費入帳、預算上限），
 * 結果存成「版本」，新的自動採用；調整音量、起點、淡化都不花錢。
 */
export function createSoundService(deps: SoundServiceDeps): SoundService {
  const { projects, runtime, settings, settingsService, models, broadcast, log } = deps
  const tools = deps.tools ?? findTools
  /** 正在生成的項目（旁白是 narration:<鏡頭>，配樂是 music），不能重複開始。 */
  const busy = new Set<string>()

  projects.onChange(() => {
    busy.clear()
  })

  const need = (): ProjectHandle => {
    const handle = projects.current()
    if (!handle) {
      throw new AppError({
        code: 'project_not_found',
        userMessage: '請先開啟或建立一個專案。',
      })
    }
    return handle
  }

  /** 會接進成品的鏡頭（照鏡號），各自採用中的影片長度；還沒有影片的用鏡頭設定的秒數。 */
  const timeline = (handle: ProjectHandle): SoundShotView[] => {
    const { sound, shots } = handle.repos
    const clips = sound.listClips({ adoptedOnly: true })
    const muted = new Set(sound.getSettings().muteNativeShotIds)
    let start = 0
    return shots
      .list()
      .filter((shot) => shot.inCut)
      .map((shot) => {
        const take = shots.listTakes(shot.id, 'video').find((t) => t.adopted)
        const meta = take ? handle.assets.getMeta(take.assetHash) : undefined
        const durationSec = meta?.durationSec ?? shot.durationSec
        const view: SoundShotView = {
          shotId: shot.id,
          number: shot.number,
          startSec: start,
          durationSec,
          hasVideo: take !== undefined,
          dialogue: shot.dialogue,
          nativeMuted: muted.has(shot.id),
          ...(clips.find((c) => c.kind === 'narration' && c.shotId === shot.id)
            ? { narration: clips.find((c) => c.kind === 'narration' && c.shotId === shot.id) }
            : {}),
          sfx: clips.filter((c) => c.kind === 'sfx' && c.shotId === shot.id),
        }
        start += durationSec
        return view
      })
  }

  const warningsOf = (
    views: readonly SoundShotView[],
    music: SoundClip | undefined,
    total: number,
  ) => {
    const warnings: SoundWarning[] = []
    for (const view of views) {
      const clip = view.narration
      if (!clip?.durationSec) continue
      const over = clip.offsetSec + clip.durationSec - view.durationSec
      if (over > NARRATION_SPILL_SEC) {
        warnings.push({
          kind: 'narration_too_long',
          shotId: view.shotId,
          message: `第 ${String(view.number)} 鏡的旁白有 ${clip.durationSec.toFixed(1)} 秒，鏡頭只有 ${view.durationSec.toFixed(1)} 秒，會蓋到下一鏡。請縮短台詞，或換一個比較長的鏡頭。`,
        })
      }
    }
    if (music?.durationSec !== undefined && total > 0 && music.durationSec < total - 0.5) {
      warnings.push({
        kind: 'music_shorter_than_film',
        message: `配樂只有 ${music.durationSec.toFixed(0)} 秒，比整支片子（${total.toFixed(0)} 秒）短，混音時會接著重複。`,
      })
    }
    return warnings
  }

  const stateOf = (handle: ProjectHandle): SoundState => {
    const latestFinal = handle.repos.finalCuts.latest()
    const views = timeline(handle)
    const totalSec = views.reduce((sum, v) => sum + v.durationSec, 0)
    const music = handle.repos.sound
      .listClips({ adoptedOnly: true })
      .find((c) => c.kind === 'music')
    const tts = settingsService.resolveModel('tts')
    const musicModel = settingsService.resolveModel('music')
    const voice = tts === undefined ? undefined : settingsService.resolveVoice(tts)
    return {
      settings: handle.repos.sound.getSettings(),
      shots: views,
      totalSec,
      ...(music ? { music } : {}),
      ...(latestFinal
        ? {
            final: {
              version: latestFinal.version,
              hasSound: latestFinal.soundKey !== undefined,
              soundStale: soundKeyOf(handle) !== latestFinal.soundKey,
            },
          }
        : {}),
      warnings: warningsOf(views, music, totalSec),
      models: {
        ...(tts ? { tts } : {}),
        ...(musicModel ? { music: musicModel } : {}),
        ...(voice ? { voice } : {}),
      },
    }
  }

  const changed = (handle: ProjectHandle): void => {
    if (!handle.closed && projects.current() === handle) broadcast('sound.changed', stateOf(handle))
  }

  /** 專案預算（單次上限、專案上限）：超過就回報白話說明。 */
  /** 要不要混音：有採用中的旁白或配樂，或原聲設定不是預設（增益、靜音某幾鏡）。 */
  const soundWork = (handle: ProjectHandle): boolean => {
    const s = handle.repos.sound.getSettings()
    return (
      handle.repos.sound.listClips({ adoptedOnly: true }).length > 0 ||
      s.nativeGainDb !== 0 ||
      s.muteNativeShotIds.length > 0
    )
  }

  const soundKeyOf = (handle: ProjectHandle): string | undefined => {
    if (!soundWork(handle)) return undefined
    const s = handle.repos.sound.getSettings()
    const clips = handle.repos.sound.listClips({ adoptedOnly: true })
    // 旁白的位置跟各鏡的起點有關，所以鏡頭起點也算進去
    const starts = timeline(handle).map((v) => [v.shotId, Number(v.startSec.toFixed(3))])
    return JSON.stringify({
      c: clips.map((c) => [c.id, c.offsetSec, c.gainDb, c.fadeInSec, c.fadeOutSec]),
      s: [
        s.nativeGainDb,
        [...s.muteNativeShotIds].sort(),
        s.duck,
        s.narrationGainDb,
        s.musicGainDb,
      ],
      t: starts,
    })
  }

  const mixInto = async (
    handle: ProjectHandle,
    base: AssetRef,
    signal: AbortSignal,
  ): Promise<{ asset: AssetRef; soundKey: string } | undefined> => {
    const soundKey = soundKeyOf(handle)
    if (soundKey === undefined) return undefined
    const tool = tools()
    if (!tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '找不到影片處理工具（FFmpeg），沒辦法混音。',
      })
    }
    const pathOf = (hash: string): string => {
      const found = handle.assets.find(hash)
      if (!found) throw invalid('找不到聲音檔，可能已被刪除。')
      return found.path
    }
    const settings = handle.repos.sound.getSettings()
    const views = timeline(handle)
    const totalSec = views.reduce((sum, v) => sum + v.durationSec, 0)
    const narration: MixClip[] = []
    for (const view of views) {
      const clip = view.narration
      if (!clip) continue
      const startSec = view.startSec + clip.offsetSec
      if (startSec >= totalSec - 0.05) continue // 超出片長的旁白沒辦法混，state 的警示會提醒
      narration.push({
        file: pathOf(clip.assetHash),
        startSec,
        gainDb: clip.gainDb ?? settings.narrationGainDb,
        ...(clip.fadeInSec === undefined ? {} : { fadeInSec: clip.fadeInSec }),
        ...(clip.fadeOutSec === undefined ? {} : { fadeOutSec: clip.fadeOutSec }),
      })
    }
    const music = handle.repos.sound
      .listClips({ adoptedOnly: true })
      .find((c) => c.kind === 'music')
    const mutes = views
      .filter((v) => v.nativeMuted)
      .map((v) => ({ startSec: v.startSec, endSec: v.startSec + v.durationSec }))
    const dir = await mkdtemp(join(tmpdir(), 'svs-mix-'))
    try {
      const out = join(dir, 'mixed.mp4')
      await mixAudio(tool, pathOf(base.hash), out, {
        signal,
        narration,
        ...(music
          ? {
              music: {
                file: pathOf(music.assetHash),
                gainDb: music.gainDb ?? settings.musicGainDb,
                ...(music.fadeInSec === undefined ? {} : { fadeInSec: music.fadeInSec }),
                ...(music.fadeOutSec === undefined ? {} : { fadeOutSec: music.fadeOutSec }),
              },
            }
          : {}),
        nativeGainDb: settings.nativeGainDb,
        nativeMutes: mutes,
        duck: settings.duck,
      })
      const info = await probe(tool, out, { signal })
      const meta = {
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
        durationSec: info.durationSec,
      }
      const stored = await handle.assets.put(new Uint8Array(await readFile(out)), 'video/mp4', meta)
      return {
        asset: {
          hash: stored.hash,
          kind: 'video',
          mime: 'video/mp4',
          bytes: stored.bytes,
          ...meta,
        },
        soundKey,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  const budgetIssue = (handle: ProjectHandle, usd: number): string | undefined => {
    const exceeded = checkBudget({
      budget: settings.get().budget,
      runProjectedUsd: usd,
      projectBaseUsd: handle.repos.costs.totalUsd(handle.projectId),
    })
    return exceeded ? budgetExceededError(exceeded).userMessage : undefined
  }

  const narrationEstimate = (modelId: string, text: string): number => {
    const card = models.get(modelId)
    return card ? models.estimate(modelId, { chars: billableChars(card, text) }) : 0
  }

  const plan = (request: SoundPlanRequest): SoundPlan => {
    const handle = need()
    const views = timeline(handle)
    const items: SoundPlan['items'] = []
    let issue: string | undefined
    if (request.narration) {
      const model = settingsService.resolveModel('tts')
      const wanted = request.narration.shotIds
      const picked = views.filter((v) =>
        wanted ? wanted.includes(v.shotId) : v.dialogue.trim() !== '' && !v.narration,
      )
      if (!model) {
        issue = '還沒有可用的旁白模型：請到設定填入 OpenRouter 的服務金鑰（或打開示範模式）。'
      } else {
        for (const view of picked) {
          const text = view.dialogue.trim()
          if (text === '') continue
          items.push({
            kind: 'narration',
            shotId: view.shotId,
            modelId: model,
            estimatedUsd: narrationEstimate(model, text),
          })
        }
      }
    }
    if (request.music && issue === undefined) {
      const model = settingsService.resolveModel('music')
      if (!model) issue = '還沒有可用的配樂模型：請到設定填入 OpenRouter 的服務金鑰。'
      else
        items.push({
          kind: 'music',
          modelId: model,
          estimatedUsd: models.estimate(model, { tracks: 1 }),
        })
    }
    const totalUsd = items.reduce((sum, item) => sum + item.estimatedUsd, 0)
    issue ??= budgetIssue(handle, totalUsd)
    return { items, totalUsd, ok: issue === undefined, ...(issue === undefined ? {} : { issue }) }
  }

  /** 生成一次，結果存成新版本並記帳；回傳新的片段。 */
  const generate = async (
    handle: ProjectHandle,
    request: Parameters<ReturnType<typeof createStudioServices>['generate']>[0],
    estimateUsd: number,
    clip: {
      kind: 'narration' | 'music'
      shotId?: string
      text: string
      voiceId?: string
      offsetSec: number
    },
  ): Promise<SoundClip> => {
    const queue = runtime.queue()
    const tool = tools()
    if (!queue) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '生成服務還沒準備好，請重新啟動 App。',
      })
    }
    const studio = createStudioServices({
      queue,
      handle,
      tools: tool ?? { ffmpegPath: '', ffprobePath: null },
      models,
    })
    const result = await studio.generate(request, { signal: new AbortController().signal })
    if (handle.closed) throw invalid('專案已經關閉，沒有儲存這段聲音。')
    const asset = outputAsset(result.output)
    // 長度：用 FFmpeg 量；沒有工具或量不到就不填（之後混音時還是會量）
    let durationSec: number | undefined
    const found = handle.assets.find(asset.hash)
    if (tool && found) {
      try {
        durationSec = (await probe(tool, found.path)).durationSec
      } catch (error) {
        log.warn(`量不到聲音的長度：${String(error)}`)
      }
    }
    const costUsd = result.costUsd ?? estimateUsd
    handle.repos.costs.record({
      projectId: handle.projectId,
      provider: result.provider,
      modelId: request.modelId,
      amountUsd: costUsd,
      estimated: result.costUsd === undefined,
      jobId: result.jobId,
    })
    return handle.repos.sound.addClip({
      kind: clip.kind,
      shotId: clip.shotId,
      assetHash: asset.hash,
      durationSec,
      offsetSec: clip.offsetSec,
      text: clip.text,
      voiceId: clip.voiceId,
      modelId: request.modelId,
      costUsd,
      costEstimated: result.costUsd === undefined,
    })
  }

  const guard = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    if (busy.has(key)) throw invalid('這個項目正在生成中，請稍後。')
    busy.add(key)
    try {
      return await work()
    } finally {
      busy.delete(key)
    }
  }

  const rethrow = (error: unknown): never => {
    if (isAppError(error)) throw error
    throw error
  }

  return {
    state: () => stateOf(need()),
    plan,

    async generateNarration(input) {
      const handle = need()
      const shot = handle.repos.shots.get(input.shotId)
      if (!shot) throw invalid('找不到這個鏡頭。')
      const text = (input.text ?? shot.dialogue).trim()
      if (text === '') throw invalid('這一鏡還沒有台詞，請先寫下要念的內容。')
      if (text.length > NARRATION_MAX_CHARS) {
        throw invalid(`旁白太長了（上限 ${String(NARRATION_MAX_CHARS)} 字），請縮短。`)
      }
      const model = settingsService.resolveModel('tts')
      if (!model)
        throw invalid(
          '還沒有可用的旁白模型：請到設定填入 OpenRouter 的服務金鑰（或打開示範模式）。',
        )
      const voiceId = input.voiceId ?? settingsService.resolveVoice(model)
      const estimate = narrationEstimate(model, text)
      const issue = budgetIssue(handle, estimate)
      if (issue) throw invalid(issue)
      try {
        const clip = await guard(`narration:${shot.id}`, () =>
          generate(
            handle,
            {
              capability: 'tts',
              modelId: model,
              text,
              ...(voiceId === undefined ? {} : { voiceId }),
            },
            estimate,
            {
              kind: 'narration',
              shotId: shot.id,
              text,
              ...(voiceId === undefined ? {} : { voiceId }),
              offsetSec: DEFAULT_NARRATION_OFFSET_SEC,
            },
          ),
        )
        changed(handle)
        return clip
      } catch (error) {
        return rethrow(error)
      }
    },

    async generateMusic(input) {
      const handle = need()
      const model = settingsService.resolveModel('music')
      if (!model) throw invalid('還沒有可用的配樂模型：請到設定填入 OpenRouter 的服務金鑰。')
      const views = timeline(handle)
      const totalSec = views.reduce((sum, v) => sum + v.durationSec, 0)
      const durationSec = input.durationSec ?? (totalSec > 0 ? totalSec : undefined)
      const typed = input.prompt?.trim()
      const prompt = typed === undefined || typed === '' ? defaultMusicPrompt(handle) : typed
      const estimate = models.estimate(model, { tracks: 1 })
      const issue = budgetIssue(handle, estimate)
      if (issue) throw invalid(issue)
      try {
        const clip = await guard('music', () =>
          generate(
            handle,
            {
              capability: 'music',
              modelId: model,
              prompt,
              ...(durationSec === undefined ? {} : { durationSec }),
            },
            estimate,
            { kind: 'music', text: prompt, offsetSec: 0 },
          ),
        )
        changed(handle)
        return clip
      } catch (error) {
        return rethrow(error)
      }
    },

    updateClip(clipId, patch) {
      const handle = need()
      const clip = handle.repos.sound.updateClip(clipId, {
        ...(patch.offsetSec === undefined ? {} : { offsetSec: patch.offsetSec }),
        ...(patch.gainDb === undefined ? {} : { gainDb: patch.gainDb }),
        ...(patch.fadeInSec === undefined ? {} : { fadeInSec: patch.fadeInSec }),
        ...(patch.fadeOutSec === undefined ? {} : { fadeOutSec: patch.fadeOutSec }),
      })
      changed(handle)
      return clip
    },

    adoptClip(clipId) {
      const handle = need()
      const clip = handle.repos.sound.adoptClip(clipId)
      changed(handle)
      return clip
    },

    removeClip(clipId) {
      const handle = need()
      handle.repos.sound.removeClip(clipId)
      changed(handle)
    },

    updateSettings(patch) {
      const handle = need()
      const next = handle.repos.sound.updateSettings(patch)
      changed(handle)
      return next
    },

    soundKey: soundKeyOf,
    mixInto,

    async mix() {
      const handle = need()
      const latest = handle.repos.finalCuts.latest()
      if (!latest) throw invalid('還沒有接好的成品，先把鏡頭接成一支影片。')
      const baseHash = latest.baseAssetHash ?? latest.assetHash
      const meta = handle.assets.getMeta(baseHash)
      if (!meta) throw invalid('找不到接好的影片，請重新接片。')
      const base: AssetRef = {
        hash: meta.hash,
        kind: 'video',
        mime: meta.mime,
        bytes: meta.bytes,
        ...(meta.width ? { width: meta.width } : {}),
        ...(meta.height ? { height: meta.height } : {}),
        ...(meta.durationSec === undefined ? {} : { durationSec: meta.durationSec }),
      }
      const mixed = await mixInto(handle, base, new AbortController().signal)
      const finalHash = mixed?.asset.hash ?? baseHash
      const record = handle.repos.finalCuts.record({
        assetHash: finalHash,
        durationSec: handle.assets.getMeta(finalHash)?.durationSec,
        takeIds: latest.takeIds,
        baseAssetHash: mixed ? baseHash : undefined,
        soundKey: mixed?.soundKey,
      })
      if (!handle.closed) {
        if (deps.shots) broadcast('shots.changed', deps.shots.list())
        changed(handle)
      }
      return { videoHash: finalHash, version: record.version }
    },
  }

  /** 配樂的預設描述：永遠是純音樂；風格取專案的風格，情緒取各鏡頭填的情緒。 */
  function defaultMusicPrompt(handle: ProjectHandle): string {
    const moods = [
      ...new Set(
        handle.repos.shots
          .list()
          .map((s) => s.mood?.trim())
          .filter((m): m is string => m !== undefined && m !== ''),
      ),
    ]
    const style = handle.repos.projects.get().defaultStyleId
    return [
      'Instrumental only, no vocals.',
      'Cinematic score for a short animated film.',
      style ? `Visual style: ${style}.` : '',
      moods.length > 0 ? `Mood: ${moods.join(', ')}.` : '',
    ]
      .filter((part) => part !== '')
      .join(' ')
  }
}
