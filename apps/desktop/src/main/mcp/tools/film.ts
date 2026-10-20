import type { ShotBatchStageSchema, ShotView } from '@svs/schema'
import { basename } from 'node:path'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { WithImages, defineTool, type ToolContext } from './define'
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
        ? '專案裡還沒有鏡頭。請先拆分鏡（split_scene_into_shots）。'
        : '找不到這些鏡頭。請先用 list_shots 看有哪些鏡頭。',
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
  const hint = check.skippedGenerated > 0 ? '（要再做一個新版本：redo 設成 true，舊版會保留）' : ''
  return `${check.issue ?? '現在不能開始生成。'}${hint}`
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
        '生成首幀圖',
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
      'Generate the video of each shot from its ADOPTED first-frame picture (shots without a first frame are skipped; make them with generate_first_frames first). Default: every shot in the cut that has no video yet; redo=true makes a NEW video version for shots that already have one. Runs in the background: call wait_for_generation (it can take minutes). Calls the video model, the expensive step: it counts against the spending allowance: the app checks the estimate itself and refuses, saying the estimate, if the allowance is too small (estimate_cost action generate_videos tells you the price first; see load_guide("spending")); free in demo mode.',
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
        '生成影片',
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
      'Make a NEW version of one shot after you changed it or did not like the result (older versions are kept): what="first_frame" (new picture, video untouched), "video" (new video from the current first frame) or "both" (new picture AND new video). Counts against the spending allowance; free in demo mode. Then wait_for_generation.',
    input: {
      shotId: z.string().min(1),
      what: z.enum(['first_frame', 'video', 'both']),
    },
    hints: { readOnly: false },
    run: ({ shotId, what }) =>
      startBatch(
        ctx,
        what === 'first_frame' ? '重做首幀圖' : what === 'video' ? '重做影片' : '重做首幀圖與影片',
        what === 'first_frame' ? 'frame' : what === 'video' ? 'video' : 'full',
        [shotId],
        true,
        false,
      ),
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
      "Returns the adopted first-frame picture of several shots as images you can look at (downsized), in shot order, with a text list saying which shot each image is. Use it to check composition, the character's look, and anything that should not be there. Pass version to look at an older/newer version of ONE shot.",
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
    },
    hints: { readOnly: true },
    run: async ({ shotIds, version }) => {
      const { shots } = await ctx.caller.call('shots.list', {})
      const chosen = (shotIds === undefined ? shots : shots.filter((s) => shotIds.includes(s.id)))
        .filter((s) => takeOf(s.firstFrames, shotIds?.length === 1 ? version : undefined))
        .slice(0, 8)
      const images = []
      const order = []
      for (const shot of chosen) {
        const take = takeOf(shot.firstFrames, shotIds?.length === 1 ? version : undefined)
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
              ? 'No first-frame pictures yet: use generate_first_frames.'
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
      "Pull evenly spaced still frames out of one shot's adopted video (or of the assembled final film with finalCut=true) as images you can look at. Use it to check a generated video for mistakes (extra mouths, arms or legs, a changed character, flicker) before you accept it; if it is wrong use regenerate_shot. 1–6 frames.",
    input: {
      shotId: z.string().min(1).optional().describe('Which shot (omit when finalCut=true)'),
      finalCut: z
        .boolean()
        .default(false)
        .describe('Use the assembled final film instead of a shot'),
      count: z.number().int().min(1).max(6).default(4),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('A specific video version of the shot'),
    },
    hints: { readOnly: true },
    run: async ({ shotId, finalCut, count, version }) => {
      const snapshot = await ctx.caller.call('shots.list', {})
      let hash: string | undefined
      let label: string
      if (finalCut) {
        hash = snapshot.finalVideoHash
        label = 'final film'
        if (!hash)
          throw new McpToolError('還沒有接好的成品影片：請先用 assemble_film。', 'no_final_cut')
      } else {
        const shot = snapshot.shots.find((s) => s.id === shotId)
        if (!shot)
          throw new McpToolError(
            '找不到這個鏡頭。請先用 list_shots 看有哪些鏡頭。',
            'shot_not_found',
          )
        const take = takeOf(shot.videos, version)
        if (!take)
          throw new McpToolError('這個鏡頭還沒有影片：請先用 generate_videos。', 'no_video')
        hash = take.assetHash
        label = `shot ${String(shot.number)} (video version ${String(take.version)})`
      }
      const stills = await ctx.viewer.videoStills(hash, count)
      return new WithImages(
        { source: label, framesAtSeconds: stills.map((s) => s.atSec) },
        stills.map((s) => s.image),
      )
    },
  })

  defineTool(ctx, {
    name: 'assemble_film',
    title: 'Join the shots into one film',
    description:
      'Join the adopted video of every shot that is in the cut into one film, in shot order (local FFmpeg, costs nothing). Do this after the videos are final, then look at it with view_video_stills(finalCut=true) and save it with export_film.',
    input: {},
    hints: { readOnly: false, idempotent: true },
    run: async () => {
      const { shots } = await ctx.caller.call('shots.list', {})
      const ready = shots.filter((s) => s.inCut !== false && takeOf(s.videos))
      const missing = shots
        .filter((s) => s.inCut !== false && !takeOf(s.videos))
        .map((s) => s.number)
      if (ready.length === 0)
        throw new McpToolError('還沒有任何鏡頭有影片：請先用 generate_videos。', 'no_videos')
      await ctx.caller.call('shots.rejoin', {})
      return {
        assembled: true,
        shotsInFilm: ready.map((s) => s.number),
        ...(missing.length > 0 ? { shotsLeftOutBecauseNoVideo: missing } : {}),
        totalSeconds: ready.reduce((sum, s) => sum + s.durationSec, 0),
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
