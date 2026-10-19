import type { SoundClip, SoundPlanRequest } from '@svs/schema'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { defineTool, type ToolContext } from './define'
import { reserveSpending } from './spend'

/** 旁白與配樂的價格是照字數／每首固定價算的，預估很準；預留只多留一點點。 */
export const SOUND_RESERVE_FACTOR = 1.25

/** 片段的摘要：給 AI 看的欄位，不含素材雜湊與檔案位置。 */
export function clipView(clip: SoundClip) {
  return {
    id: clip.id,
    kind: clip.kind,
    ...(clip.shotId === undefined ? {} : { shotId: clip.shotId }),
    version: clip.version,
    adopted: clip.adopted,
    ...(clip.durationSec === undefined ? {} : { durationSec: clip.durationSec }),
    offsetSec: clip.offsetSec,
    gainDb: clip.gainDb ?? null,
    fadeInSec: clip.fadeInSec ?? null,
    fadeOutSec: clip.fadeOutSec ?? null,
    text: clip.text,
    ...(clip.voiceId === undefined ? {} : { voiceId: clip.voiceId }),
    model: clip.modelId,
    ...(clip.costUsd === undefined
      ? {}
      : { costUsd: clip.costUsd, costEstimated: clip.costEstimated }),
  }
}

const maxCostInput = z
  .number()
  .positive()
  .optional()
  .describe('Refuse (spend nothing) if the estimate is above this many US dollars')

/** 先問聲音服務自己的預估與檢查，再預留額度；沒有預估或超過 maxCostUsd 就拒絕、不花錢。 */
async function planAndReserve(
  ctx: ToolContext,
  what: string,
  request: SoundPlanRequest,
  pick: (
    items: { kind: string; shotId?: string | undefined; estimatedUsd: number }[],
  ) => number | undefined,
  maxCostUsd: number | undefined,
  scale = 1,
) {
  const plan = await ctx.caller.call('sound.plan', request)
  if (!plan.ok) throw new McpToolError(plan.issue ?? '現在不能生成聲音。', 'cannot_generate')
  const base = pick(plan.items)
  if (base === undefined) {
    throw new McpToolError(
      '預估裡沒有這一項（旁白要先有台詞：用 update_shot 寫好這一鏡的 dialogue，再不帶 text 呼叫）。',
      'no_estimate',
    )
  }
  const estimatedUsd = base * scale
  if (maxCostUsd !== undefined && estimatedUsd > maxCostUsd) {
    throw new McpToolError(
      `「${what}」預估要花 US$${estimatedUsd.toFixed(2)}，超過你給的上限 US$${maxCostUsd.toFixed(2)}，所以沒有做。`,
      'over_max_cost',
    )
  }
  const reserved = reserveSpending(ctx, what, estimatedUsd, SOUND_RESERVE_FACTOR)
  return { estimatedUsd, ...reserved, demoMode: ctx.settings.get().demoMode }
}

/** 聲音：旁白、配樂、混音設定。旁白與配樂花錢（先預估、預留額度）；調整與設定免費。你聽不到聲音，只能看資料。 */
export function registerSoundTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'get_sound',
    title: 'Look at the sound of the film',
    description:
      'The sound of the current project: the settings (native video audio on/off and gain, which shots mute it, narration ducking, music gain), every shot with its start time in the film, length, dialogue (the narration reads the dialogue) and adopted narration, the adopted music, warnings (e.g. narration longer than the shot) and the models in use. You cannot hear it; read these numbers.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const state = await ctx.caller.call('sound.get', {})
      return {
        settings: state.settings,
        totalSec: state.totalSec,
        shots: state.shots.map((s) => ({
          shotId: s.shotId,
          number: s.number,
          startSec: s.startSec,
          durationSec: s.durationSec,
          hasVideo: s.hasVideo,
          dialogue: s.dialogue,
          nativeMuted: s.nativeMuted,
          narration: s.narration ? clipView(s.narration) : null,
        })),
        music: state.music ? clipView(state.music) : null,
        warnings: state.warnings.map((w) => ({
          kind: w.kind,
          ...(w.shotId === undefined ? {} : { shotId: w.shotId }),
          message: w.message,
        })),
        models: {
          narration: state.models.tts ?? null,
          music: state.models.music ?? null,
          voice: state.models.voice ?? null,
        },
      }
    },
  })

  defineTool(ctx, {
    name: 'plan_sound',
    title: 'Estimate the cost of narration and music',
    description:
      'Before generating sound: the estimated cost per item and in total, and whether it can be done now (a model is available, within the limits). Default narration: every shot that has dialogue and no narration yet. Free.',
    input: {
      narrationShotIds: z.array(z.string().min(1)).max(100).optional().describe('Only these shots'),
      narration: z.boolean().default(true).describe('Include narration'),
      music: z.boolean().default(false).describe('Include one music track'),
      musicDurationSec: z.number().positive().optional(),
    },
    hints: { readOnly: true },
    run: async ({ narrationShotIds, narration, music, musicDurationSec }) => {
      const plan = await ctx.caller.call('sound.plan', {
        ...(narration ? { narration: narrationShotIds ? { shotIds: narrationShotIds } : {} } : {}),
        ...(music
          ? { music: musicDurationSec === undefined ? {} : { durationSec: musicDurationSec } }
          : {}),
      })
      const status = ctx.allowance.status()
      return {
        ok: plan.ok,
        ...(plan.issue === undefined ? {} : { problem: plan.issue }),
        items: plan.items.map((i) => ({
          kind: i.kind,
          ...(i.shotId === undefined ? {} : { shotId: i.shotId }),
          model: i.modelId,
          estimatedUsd: i.estimatedUsd,
        })),
        totalUsd: plan.totalUsd,
        demoMode: ctx.settings.get().demoMode,
        allowanceLeftUsd: Math.max(status.allowanceUsd - status.committedUsd, 0),
      }
    },
  })

  defineTool(ctx, {
    name: 'generate_narration',
    title: 'Make the narration of one shot',
    description:
      "Speak one shot's dialogue as narration (write the line first with update_shot dialogue; or pass text to say something else). voiceId must be one of the voices listed by list_models for the narration model (default: the one chosen in Settings). Makes a NEW version each time (older ones are kept; adopt_sound_clip switches). Calls the speech model: counts against the spending allowance (plan_sound first); free in demo mode. Narration longer than the shot shows up as a warning in get_sound.",
    input: {
      shotId: z.string().min(1),
      text: z.string().min(1).max(5000).optional(),
      voiceId: z.string().min(1).optional(),
      maxCostUsd: maxCostInput,
    },
    hints: { readOnly: false },
    run: async ({ shotId, text, voiceId, maxCostUsd }) => {
      const state = await ctx.caller.call('sound.get', {})
      const shot = state.shots.find((s) => s.shotId === shotId)
      if (!shot)
        throw new McpToolError('找不到這個鏡頭。請先用 list_shots 看有哪些鏡頭。', 'shot_not_found')
      // 預估是照台詞算的；給了更長的 text 就照比例放大，寧可多預留
      const scale =
        text === undefined ? 1 : Math.max(1, text.length / Math.max(shot.dialogue.length, 1))
      const spending = await planAndReserve(
        ctx,
        '生成旁白',
        { narration: { shotIds: [shotId] } },
        (items) => items.find((i) => i.kind === 'narration' && i.shotId === shotId)?.estimatedUsd,
        maxCostUsd,
        scale,
      )
      const { clip } = await ctx.caller.call('sound.generateNarration', {
        shotId,
        ...(text === undefined ? {} : { text }),
        ...(voiceId === undefined ? {} : { voiceId }),
      })
      return { clip: clipView(clip), spending }
    },
  })

  defineTool(ctx, {
    name: 'generate_music',
    title: 'Make a music track for the film',
    description:
      'Make one instrumental music track (never vocals). Without a prompt the app writes one from the project style and the mood of the scenes. Makes a NEW version each time; the new one is adopted. Counts against the spending allowance (plan_sound first); free in demo mode. A track shorter than the film shows up as a warning in get_sound.',
    input: {
      prompt: z.string().min(1).max(2000).optional().describe('What the music should feel like'),
      durationSec: z.number().positive().optional(),
      maxCostUsd: maxCostInput,
    },
    hints: { readOnly: false },
    run: async ({ prompt, durationSec, maxCostUsd }) => {
      const spending = await planAndReserve(
        ctx,
        '生成配樂',
        { music: durationSec === undefined ? {} : { durationSec } },
        (items) => items.find((i) => i.kind === 'music')?.estimatedUsd,
        maxCostUsd,
      )
      const { clip } = await ctx.caller.call('sound.generateMusic', {
        ...(prompt === undefined ? {} : { prompt }),
        ...(durationSec === undefined ? {} : { durationSec }),
      })
      return { clip: clipView(clip), spending }
    },
  })

  defineTool(ctx, {
    name: 'adjust_sound_clip',
    title: 'Change the timing or loudness of a clip',
    description:
      'Change one narration or music clip (id from get_sound): offsetSec (start inside the shot; narration defaults to 0.4 s late), gainDb (null = default: narration 0, music −18), fadeInSec, fadeOutSec (null = default). Only the fields you pass change. Free; then mix to hear the result (the user can).',
    input: {
      clipId: z.string().min(1),
      offsetSec: z.number().min(0).optional(),
      gainDb: z.number().min(-60).max(24).nullable().optional(),
      fadeInSec: z.number().min(0).nullable().optional(),
      fadeOutSec: z.number().min(0).nullable().optional(),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ clipId, ...patch }) => {
      const { clip } = await ctx.caller.call('sound.updateClip', {
        clipId,
        patch: {
          ...(patch.offsetSec === undefined ? {} : { offsetSec: patch.offsetSec }),
          ...(patch.gainDb === undefined ? {} : { gainDb: patch.gainDb }),
          ...(patch.fadeInSec === undefined ? {} : { fadeInSec: patch.fadeInSec }),
          ...(patch.fadeOutSec === undefined ? {} : { fadeOutSec: patch.fadeOutSec }),
        },
      })
      return clipView(clip)
    },
  })

  defineTool(ctx, {
    name: 'adopt_sound_clip',
    title: 'Use another version of a narration or music',
    description:
      'Make this version (clip id) the one the film uses; the previously adopted version of the same shot/kind stays as an older version. Free.',
    input: { clipId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ clipId }) =>
      clipView((await ctx.caller.call('sound.adoptClip', { clipId })).clip),
  })

  defineTool(ctx, {
    name: 'remove_sound_clip',
    title: 'Delete a narration or music version',
    description:
      'Delete one narration or music version (clip id). It cannot be brought back (generate again to get a new one). Free.',
    input: { clipId: z.string().min(1) },
    hints: { readOnly: false, destructive: true },
    run: async ({ clipId }) => {
      await ctx.caller.call('sound.removeClip', { clipId })
      return { removed: true }
    },
  })

  defineTool(ctx, {
    name: 'mix_sound',
    title: 'Mix the sound into the film',
    description:
      "Mix the adopted narration, music and (unless muted) the video's own sound into the latest assembled film and save it as a new version of the film. Free (local FFmpeg, a few seconds). assemble_film already mixes the sound that exists at that moment; call this when you changed the sound AFTER assembling (new or adjusted narration/music, settings), then export_film. You need an assembled film first (assemble_film).",
    input: {},
    hints: { readOnly: false },
    run: async () => {
      const { version } = await ctx.caller.call('sound.mix', {})
      return { mixed: true, filmVersion: version }
    },
  })

  defineTool(ctx, {
    name: 'analyze_sound',
    title: 'Measure the sound of the film',
    description:
      "Measure the latest assembled film's sound (you cannot hear it, this is how you check it): overall loudness (target about −16 LUFS), true peak (should stay below −1 dBTP), the average level of every shot (null = silent), quiet stretches, and plain-language warnings (too quiet, clipping, a shot with no sound, quiet where narration should be). Free. Measure after mix_sound / assemble_film; if it says something is wrong, fix with adjust_sound_clip / set_sound_settings, mix_sound and measure again.",
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const a = await ctx.caller.call('sound.analyze', {})
      return {
        filmVersion: a.version,
        durationSec: a.durationSec,
        loudness: {
          integratedLufs: a.loudness.integratedLufs ?? null,
          truePeakDb: a.loudness.truePeakDb ?? null,
          loudnessRange: a.loudness.loudnessRange ?? null,
        },
        shots: a.shots,
        quietStretches: a.silences,
        warnings: a.warnings,
      }
    },
  })

  defineTool(ctx, {
    name: 'set_sound_settings',
    title: 'Change the sound settings',
    description:
      'Sound settings of this project (only the fields you pass change): nativeAudio (ask the video model for its own sound; makes video about 50% more expensive, applies to videos generated AFTER the change), nativeGainDb, muteNativeShotIds (shots whose own video sound is not used; whole list replaced), duck (lower the music/native sound while narration speaks), musicGainDb. Free.',
    input: {
      nativeAudio: z.boolean().optional(),
      nativeGainDb: z.number().min(-60).max(24).optional(),
      muteNativeShotIds: z.array(z.string().min(1)).max(500).optional(),
      duck: z.boolean().optional(),
      musicGainDb: z.number().min(-60).max(24).optional(),
    },
    hints: { readOnly: false, idempotent: true },
    run: async (patch) =>
      ctx.caller.call('sound.updateSettings', {
        ...(patch.nativeAudio === undefined ? {} : { nativeAudio: patch.nativeAudio }),
        ...(patch.nativeGainDb === undefined ? {} : { nativeGainDb: patch.nativeGainDb }),
        ...(patch.muteNativeShotIds === undefined
          ? {}
          : { muteNativeShotIds: patch.muteNativeShotIds }),
        ...(patch.duck === undefined ? {} : { duck: patch.duck }),
        ...(patch.musicGainDb === undefined ? {} : { musicGainDb: patch.musicGainDb }),
      }),
  })
}
