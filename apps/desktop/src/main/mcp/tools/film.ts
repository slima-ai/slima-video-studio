import type { ShotBatchStageSchema, ShotView } from '@svs/schema'
import { basename } from 'node:path'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { WithImages, defineTool, type ToolContext } from './define'
import { cutCard, filmName, joinIntoFilmButton } from '../ui-labels'
import { shotSummary } from './shots'
import { reserveSpending } from './spend'

/** 圖片、影片的價格是照張數／秒數算的，預估很準；預留只多留一點點（重試、單價調整）。 */
export const GENERATION_RESERVE_FACTOR = 1.25

type Take = ShotView['firstFrames'][number]

/** 某個鏡頭「採用中」的首幀圖或影片（或指定版本）。 */
const takeOf = (takes: readonly Take[], version?: number): Take | undefined =>
  version === undefined ? takes.find((t) => t.adopted) : takes.find((t) => t.version === version)

/** 預設選哪些鏡頭：有給就用給的；沒給就是全部放進成品的鏡頭。 */
async function pickShots(ctx: ToolContext, shotIds?: readonly string[]) {
  const { shots } = await ctx.caller.call('shots.list', {})
  const chosen =
    shotIds === undefined
      ? shots.filter((s) => s.inCut !== false)
      : shots.filter((s) => shotIds.includes(s.id))
  if (chosen.length === 0) {
    throw new McpToolError(
      shotIds === undefined
        ? 'The project has no shots yet. Split a scene into shots first (split_scene_into_shots).'
        : 'Those shots were not found. Call list_shots to see which shots exist.',
      'no_shots',
    )
  }
  return chosen
}

/** 這一批要送給 App 自己的檢查（預估、花費上限、哪些鏡頭會被略過）的請求；開始生成與預估價錢用同一份。 */
function batchRequest(
  stage: z.infer<typeof ShotBatchStageSchema>,
  shotIds: readonly string[],
  redo: boolean,
  draft: boolean,
) {
  return {
    shotIds: [...shotIds],
    skipGenerated: !redo,
    stage,
    ...(draft ? { draft: true } : {}),
  }
}

/** 白話說明為什麼現在不能開始這一批。 */
const cannotStart = (check: { issue?: string | undefined; skippedGenerated: number }): string => {
  const hint =
    check.skippedGenerated > 0
      ? ' (To make a new version anyway, set redo to true; the old version is kept.)'
      : ''
  return `${check.issue ?? 'Generation cannot start right now.'}${hint}`
}

/**
 * 只問「首幀圖或影片這一批要多少錢」，什麼都不開始、不預留（estimate_cost 用）。
 * 數字就是 App 自己「全部生成」確認視窗用的那一份（shots.batchCheck），所以 AI 說的價錢跟畫面上的一致。
 */
export async function estimateBatch(
  ctx: ToolContext,
  stage: z.infer<typeof ShotBatchStageSchema>,
  shotIds: readonly string[] | undefined,
  redo: boolean,
  draft: boolean,
) {
  const shots = await pickShots(ctx, shotIds)
  const check = await ctx.caller.call(
    'shots.batchCheck',
    batchRequest(
      stage,
      shots.map((s) => s.id),
      redo,
      draft,
    ),
  )
  const allowance = ctx.allowance.status()
  const wouldReserveUsd = check.demoMode ? 0 : check.estimatedUsd * GENERATION_RESERVE_FACTOR
  return {
    possible: check.ok,
    ...(check.ok ? {} : { issue: cannotStart(check) }),
    demoMode: check.demoMode,
    estimatedUsd: check.estimatedUsd,
    wouldReserveUsd,
    allowance,
    fits: check.demoMode || wouldReserveUsd <= allowance.remainingUsd,
    shotCount: check.ok ? shots.length - check.skippedGenerated - check.skippedNoFrame : 0,
    skippedAlreadyDone: check.skippedGenerated,
    skippedNoFirstFrame: check.skippedNoFrame,
    model: stage === 'frame' ? (check.models.image ?? null) : (check.models.video ?? null),
  }
}

/** 先過 App 自己的檢查與預估、再預留額度、最後才真的開始生成。 */
async function startBatch(
  ctx: ToolContext,
  what: string,
  stage: z.infer<typeof ShotBatchStageSchema>,
  shotIds: readonly string[],
  redo: boolean,
  draft: boolean,
) {
  const request = batchRequest(stage, shotIds, redo, draft)
  const check = await ctx.caller.call('shots.batchCheck', request)
  if (!check.ok) throw new McpToolError(cannotStart(check), 'cannot_generate')
  const reserved = reserveSpending(ctx, what, check.estimatedUsd, GENERATION_RESERVE_FACTOR)
  const result = await ctx.caller.call('shots.generateBatch', request)
  return {
    started: result.started,
    skippedAlreadyDone: result.skippedGenerated,
    skippedNoFirstFrame: check.skippedNoFrame,
    skippedBusy: result.skippedBusy,
    ...(result.staleFrameShots === undefined
      ? {}
      : {
          staleFirstFrames: {
            shots: result.staleFrameShots,
            note: 'These videos were drawn from the adopted first frame as it is (no picture was generated or paid for), but that first frame was drawn from an OLDER description of the shot. If the picture should follow the new description, regenerate the first frame (generate_first_frames redo=true), look at it, then redo the video.',
          },
        }),
    failedToStart: result.failed.map((f) => ({ shot: f.number, problem: f.error })),
    model: stage === 'frame' ? (check.models.image ?? null) : (check.models.video ?? null),
    demoMode: check.demoMode,
    spending: { estimatedUsd: check.estimatedUsd, ...reserved },
    next: 'Call wait_for_generation until finished, then look at the result.',
  }
}

/** 生成、看結果、換版本、接片與匯出（首幀圖與影片分開做，先看過首幀再花影片的錢）。 */
export function registerFilmTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'generate_first_frames',
    title: 'Generate the first-frame pictures',
    description:
      'Generate the first-frame picture of each shot (the picture the video will start from), WITHOUT making any video yet, so you can look at them (view_first_frames) and fix problems before paying for video. Default: every shot that is in the cut and has no first frame yet; redo=true makes a NEW version for shots that already have one (the old one is kept; use adopt_version to go back). Runs in the background: this returns at once; call wait_for_generation. Calls the image model: counts against the spending allowance: the app checks the estimate itself and refuses, saying the estimate, if the allowance is too small (estimate_cost action generate_first_frames tells you the price first; see load_guide("spending")); free in demo mode.',
    input: {
      shotIds: z
        .array(z.string().min(1))
        .max(100)
        .optional()
        .describe('Only these shots (default: all shots in the cut)'),
      redo: z
        .boolean()
        .default(false)
        .describe('Make new versions even where a first frame exists'),
      draft: z.boolean().default(false).describe('Use the cheaper "draft" model tier'),
    },
    hints: { readOnly: false },
    run: async ({ shotIds, redo, draft }) => {
      const shots = await pickShots(ctx, shotIds)
      return startBatch(
        ctx,
        'Generate first frames',
        'frame',
        shots.map((s) => s.id),
        redo,
        draft,
      )
    },
  })

  defineTool(ctx, {
    name: 'generate_videos',
    title: 'Generate the videos',
    description:
      'Generate the video of each shot from its ADOPTED first-frame picture, exactly as it is: no picture is ever generated or paid for here, even if the description of the shot changed after the picture was drawn (the result lists staleFirstFrames then; the video prompt still uses the current action/description). Shots without a first frame are skipped; make them with generate_first_frames first. Default: every shot in the cut that has no video yet; redo=true makes a NEW video version for shots that already have one. Runs in the background: call wait_for_generation (it can take minutes). Calls the video model, the expensive step: it counts against the spending allowance: the app checks the estimate itself and refuses, saying the estimate, if the allowance is too small (estimate_cost action generate_videos tells you the price first; see load_guide("spending")); free in demo mode.',
    input: {
      shotIds: z
        .array(z.string().min(1))
        .max(100)
        .optional()
        .describe('Only these shots (default: all shots in the cut)'),
      redo: z
        .boolean()
        .default(false)
        .describe('Make new video versions even where a video exists'),
      draft: z.boolean().default(false).describe('Use the cheaper "draft" model tier'),
    },
    hints: { readOnly: false },
    run: async ({ shotIds, redo, draft }) => {
      const shots = await pickShots(ctx, shotIds)
      return startBatch(
        ctx,
        'Generate videos',
        'video',
        shots.map((s) => s.id),
        redo,
        draft,
      )
    },
  })

  defineTool(ctx, {
    name: 'regenerate_shot',
    title: 'Redo one shot',
    description:
      'Make a NEW version of one shot after you changed it or did not like the result (older versions are kept): what="first_frame" (new picture, video untouched), "video" (new video from the current first frame as it is; no picture is generated or paid for, and it needs an adopted first frame) or "both" (new picture AND new video). Counts against the spending allowance; free in demo mode. Then wait_for_generation.',
    input: {
      shotId: z.string().min(1),
      what: z.enum(['first_frame', 'video', 'both']),
    },
    hints: { readOnly: false },
    run: ({ shotId, what }) =>
      startBatch(
        ctx,
        what === 'first_frame'
          ? 'Redo first frames'
          : what === 'video'
            ? 'Redo videos'
            : 'Redo first frames and videos',
        what === 'first_frame' ? 'frame' : what === 'video' ? 'video' : 'full',
        [shotId],
        true,
        false,
      ),
  })

  defineTool(ctx, {
    name: 'generate_end_frame',
    title: 'Generate the end frame of a shot',
    description:
      "Draw the END frame of one shot by EDITING its adopted first-frame picture: the same picture a few seconds later, so the camera position, scene, lighting and style stay identical and only what endDescription says changes (write endDescription first with update_shot, see its description). The picture model gets these reference pictures, in this order: picture 1 = the shot's adopted first frame, then the design picture (hero) of each locked character that appears in the shot (up to the model's limit; estimate_cost action generate_end_frame lists them). The prompt says: same picture, same camera, change only the end description, each character appears exactly once and its old place is left empty. The result is stored as the shot's end frame (it replaces the end frame in use; older versions stay: get_shot takes.endFrames, adopt_version to go back). Look at it with view_first_frames (shows the end frame too) before using it. It is only SENT to the video model if the model accepts an end frame (get_shot endFrame.usedByCurrentVideoModel); the shot's video then needs regenerating (regenerate_shot what=\"video\", costs money: estimate first). Calls the picture model, so it counts against the spending allowance: the app checks the estimate itself and refuses, saying the estimate, if the allowance is too small (estimate_cost action generate_end_frame tells you the price first). Runs in the background: call wait_for_generation. Free in demo mode.",
    input: { shotId: z.string().min(1) },
    hints: { readOnly: false },
    run: async ({ shotId }) => {
      const check = await ctx.caller.call('shots.endFrameCheck', { shotId })
      if (!check.ok) {
        throw new McpToolError(
          check.issue ?? 'The end frame cannot be generated now.',
          'cannot_generate',
        )
      }
      const reserved = reserveSpending(
        ctx,
        'end frame',
        check.estimatedUsd,
        GENERATION_RESERVE_FACTOR,
      )
      await ctx.caller.call('shots.generateEndFrame', { shotId })
      return {
        started: true,
        model: check.model ?? null,
        references: check.references,
        demoMode: check.demoMode,
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
        next: 'Call wait_for_generation until finished, then look at the result.',
      }
    },
  })

  defineTool(ctx, {
    name: 'cancel_generation',
    title: 'Cancel the generation of a shot',
    description:
      'Stop the generation currently running for one shot (money already spent is not refunded).',
    input: { shotId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId }) => {
      await ctx.caller.call('shots.cancel', { shotId })
      return { cancelled: true }
    },
  })

  defineTool(ctx, {
    name: 'adopt_version',
    title: 'Use a different version of a shot',
    description:
      'Switch a shot to another generated version (a first-frame picture or a video) by its takeId from get_shot. The adopted versions are what the final film uses. Free.',
    input: { takeId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ takeId }) => shotSummary(await ctx.caller.call('shots.adopt', { takeId })),
  })

  defineTool(ctx, {
    name: 'view_first_frames',
    title: 'Look at first-frame pictures',
    description:
      'Returns the adopted first-frame picture of several shots as images you can look at (downsized), in shot order, with a text list saying which shot each image is. Use it to check composition, the character\'s look, and anything that should not be there. Pass version to look at an older/newer version of ONE shot. Pass frame="end" to look at the END frame of the shots instead (the one in use: set_shot_end_frame or generate_end_frame).',
    input: {
      shotIds: z
        .array(z.string().min(1))
        .max(8)
        .optional()
        .describe('Up to 8 shots (default: the first 8 with a first frame)'),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('A specific version (only with exactly one shotId)'),
      frame: z
        .enum(['first', 'end'])
        .default('first')
        .describe('Which picture of the shot: the first frame (default) or the end frame'),
    },
    hints: { readOnly: true },
    run: async ({ shotIds, version, frame }) => {
      const { shots } = await ctx.caller.call('shots.list', {})
      // 尾幀：有生成過多版就列全部，否則只有採用中的那一張（上傳或指定的）
      const takesOf = (s: ShotView): readonly Take[] =>
        frame === 'end' ? (s.endFrames ?? (s.endFrame ? [s.endFrame] : [])) : s.firstFrames
      const chosen = (shotIds === undefined ? shots : shots.filter((s) => shotIds.includes(s.id)))
        .filter((s) => takeOf(takesOf(s), shotIds?.length === 1 ? version : undefined))
        .slice(0, 8)
      const images = []
      const order = []
      for (const shot of chosen) {
        const take = takeOf(takesOf(shot), shotIds?.length === 1 ? version : undefined)
        if (!take) continue
        images.push(await ctx.viewer.image(take.assetHash))
        order.push({
          shot: shot.number,
          shotId: shot.id,
          version: take.version,
          adopted: take.adopted,
        })
      }
      return new WithImages(
        {
          imagesInOrder: order,
          note:
            order.length === 0
              ? frame === 'end'
                ? 'No end frames yet: use generate_end_frame or set_shot_end_frame.'
                : 'No first-frame pictures yet: use generate_first_frames.'
              : undefined,
        },
        images,
      )
    },
  })

  defineTool(ctx, {
    name: 'view_video_stills',
    title: 'Look at frames of a video',
    description:
      "Pull still frames out of one shot's adopted video (or of the assembled final film with finalCut=true) as images you can look at. Use it to check a generated video for mistakes (extra mouths, arms or legs, a changed character, flicker) before you accept it; if it is wrong use regenerate_shot. By default 1–6 evenly spaced frames; pass atSeconds (up to 6 times, counted from the start of the ORIGINAL video, or of the final film) to look at exact moments, for example to find where a shot should be cut for trim_shot.",
    input: {
      shotId: z.string().min(1).optional().describe('Which shot (omit when finalCut=true)'),
      finalCut: z
        .boolean()
        .default(false)
        .describe('Use the assembled final film instead of a shot'),
      count: z.number().int().min(1).max(6).default(4),
      atSeconds: z
        .array(z.number().min(0))
        .min(1)
        .max(6)
        .optional()
        .describe('Look at these exact seconds instead of evenly spaced frames (count is ignored)'),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('A specific video version of the shot'),
    },
    hints: { readOnly: true },
    run: async ({ shotId, finalCut, count, atSeconds, version }) => {
      const snapshot = await ctx.caller.call('shots.list', {})
      let hash: string | undefined
      let label: string
      if (finalCut) {
        hash = snapshot.finalVideoHash
        label = 'final film'
        if (!hash)
          throw new McpToolError(
            'There is no assembled film yet: call assemble_film first.',
            'no_final_cut',
          )
      } else {
        const shot = snapshot.shots.find((s) => s.id === shotId)
        if (!shot)
          throw new McpToolError(
            'That shot was not found. Call list_shots to see which shots exist.',
            'shot_not_found',
          )
        const take = takeOf(shot.videos, version)
        if (!take)
          throw new McpToolError(
            'That shot has no video yet: call generate_videos first.',
            'no_video',
          )
        hash = take.assetHash
        label = `shot ${String(shot.number)} (video version ${String(take.version)})`
      }
      const stills = await ctx.viewer.videoStills(hash, count, atSeconds)
      return new WithImages(
        { source: label, framesAtSeconds: stills.map((s) => s.atSec) },
        stills.map((s) => s.image),
      )
    },
  })

  defineTool(ctx, {
    name: 'trim_shot',
    title: 'Cut the start or end off a shot',
    description:
      "Choose which part of a shot's adopted video goes into the film: inSec is where the shot starts in the original video, outSec where it ends (seconds; give one or both, the one you leave out stays as it is). clear=true goes back to the whole video. The trim belongs to that video version (switching to another version with adopt_version uses that version's own trim, the whole video by default). Use view_video_stills with atSeconds to find the moment to cut at. Numbers are snapped to the film's frame grid and an outSec past the end of the video is cut back to the end; the result lists every number that was changed (adjustments), so tell the user the values actually used. The cut is not applied until assemble_film is run again; the sound (narration, music) follows the trimmed length automatically. Free; it does not make any shot 'need regenerating'. Do not use it to shorten what the model generates: that is update_shot durationSec.",
    input: {
      shotId: z.string().min(1).describe('A shot id from list_shots'),
      inSec: z.number().min(0).optional().describe('Start of the part to keep, in seconds'),
      outSec: z.number().positive().optional().describe('End of the part to keep, in seconds'),
      clear: z.boolean().optional().describe('Remove the trim (use the whole video)'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId, inSec, outSec, clear }) => {
      if (clear !== true && inSec === undefined && outSec === undefined) {
        throw new McpToolError(
          'Give inSec and/or outSec, or clear=true to use the whole video.',
          'nothing_to_trim',
        )
      }
      const edit = {
        ...(inSec === undefined ? {} : { inSec }),
        ...(outSec === undefined ? {} : { outSec }),
        ...(clear === true ? { clear: true } : {}),
      }
      const r = await ctx.caller.call('shots.trim', { shotId, edit })
      const cutHead = r.startSec
      const cutTail = Math.max(0, r.videoSec - r.endSec)
      return {
        shot: r.shot.number,
        trimmed: r.trim !== undefined,
        // 成品裡用到原影片的哪一段
        usesFromSec: r.startSec,
        usesToSec: r.endSec,
        secondsInFilm: r.lengthSec,
        framesInFilm: r.frames,
        originalVideoSec: Number(r.videoSec.toFixed(3)),
        cutFromStartSec: Number(cutHead.toFixed(3)),
        cutFromEndSec: Number(cutTail.toFixed(3)),
        frameRate: r.fps,
        // 使用者給的數字被改掉的（對齊格線、出點超過影片長度夾回影片長度）
        adjustments: r.adjustments.map((a) => ({
          field: a.field,
          asked: a.from,
          used: a.to,
          why:
            a.reason === 'clamped'
              ? 'past the end of the video, cut back to the end'
              : 'snapped to the nearest frame',
        })),
        note: 'Run assemble_film again to apply this to the film.',
      }
    },
  })

  defineTool(ctx, {
    name: 'assemble_film',
    title: 'Join the shots into one film',
    description: `Join the adopted video of every shot that is in the cut into one film, in shot order (local FFmpeg, costs nothing). Each shot is joined as trimmed with trim_shot (the whole video if it was not trimmed). The result lists where every shot starts and ends in the film, in seconds, so you can place narration and music. Do this after the videos are final, then look at it with view_video_stills(finalCut=true) and save it with export_film. The app's own words for this: the button is ${joinIntoFilmButton()} (on the ${cutCard()} card and in the ${filmName()} panel) and the result is the ${filmName()}; use those words when you talk to the user.`,
    input: {},
    hints: { readOnly: false, idempotent: true },
    run: async () => {
      const { shots } = await ctx.caller.call('shots.list', {})
      const ready = shots.filter((s) => s.inCut !== false && takeOf(s.videos))
      const missing = shots
        .filter((s) => s.inCut !== false && !takeOf(s.videos))
        .map((s) => s.number)
      if (ready.length === 0)
        throw new McpToolError('No shot has a video yet: call generate_videos first.', 'no_videos')
      await ctx.caller.call('shots.rejoin', {})
      // 每一鏡在成品裡的起訖秒數：和聲音時間軸（旁白、配樂的位置）同一份，照裁切後的長度算
      const { shots: placed } = await ctx.caller.call('sound.get', {})
      const timeline = placed
        .filter((p) => p.hasVideo)
        .map((p) => ({
          shot: p.number,
          startSec: Number(p.startSec.toFixed(3)),
          endSec: Number((p.startSec + p.durationSec).toFixed(3)),
        }))
      const last = timeline.at(-1)
      return {
        assembled: true,
        shotsInFilm: ready.map((s) => s.number),
        ...(missing.length > 0 ? { shotsLeftOutBecauseNoVideo: missing } : {}),
        totalSeconds:
          last?.endSec ?? ready.reduce((sum, s) => sum + (s.filmSeconds ?? s.durationSec), 0),
        timeline,
      }
    },
  })

  defineTool(ctx, {
    name: 'export_film',
    title: 'Save the film as an MP4',
    description:
      "Copy the latest assembled film (with its sound) into the project's \"exports\" folder as an MP4 and return its file name (the user finds it in the app / in that folder; you do not get the folder path). Call assemble_film first (and mix_sound if you changed the sound after assembling). By default a 3-second card is added at the END of the exported file listing the AI services used (credits=true, the app's default; the project's film itself is not changed); pass credits=false for a file without it. If the card cannot be made the file is exported without it and creditsAdded says so. Free.",
    input: {
      credits: z
        .boolean()
        .default(true)
        .describe('Add the closing card that lists the AI services used (default true)'),
    },
    hints: { readOnly: false },
    run: async ({ credits }) => {
      const result = await ctx.caller.call('quickstart.export', { credits })
      return {
        exported: true,
        fileName: basename(result.path),
        creditsAdded: result.credits,
        folder: 'exports (inside the project folder; the app shows it)',
      }
    },
  })
}
