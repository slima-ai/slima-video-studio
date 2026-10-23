import { CAMERA_MOVES, ShotEditSchema, type ShotView } from '@svs/schema'
import { z } from 'zod'

import { defineTool, type ToolContext } from './define'

const adoptedVersion = (takes: ShotView['firstFrames']): number | null =>
  takes.find((t) => t.adopted)?.version ?? null

/** 鏡頭的摘要（清單用）：不含 Prompt 全文與素材雜湊，AI 用 id 操作。 */
export function shotSummary(shot: ShotView) {
  return {
    id: shot.id,
    number: shot.number,
    sceneId: shot.sceneId ?? null,
    description: shot.description,
    action: shot.action,
    endDescription: shot.endDescription ?? '',
    size: shot.size,
    angle: shot.angle,
    cameraMove: shot.cameraMove,
    durationSec: shot.durationSec,
    characters: shot.characters,
    dialogue: shot.dialogue,
    lighting: shot.lighting ?? null,
    mood: shot.mood ?? null,
    status: shot.status,
    inCut: shot.inCut ?? true,
    firstFrame: {
      versions: shot.firstFrames.length,
      adoptedVersion: adoptedVersion(shot.firstFrames),
    },
    video: {
      versions: shot.videos.length,
      adoptedVersion: adoptedVersion(shot.videos),
      // 成品只用這支影片的哪一段（trim_shot 設的）；沒裁就是 null
      trim: shot.videos.find((t) => t.adopted)?.trim ?? null,
    },
    // 這一鏡在成品裡實際佔幾秒（照裁切算；durationSec 是送給影片模型的生成秒數，不是成品長度）
    filmSeconds: shot.filmSeconds ?? null,
    hasEndFrame: shot.endFrame !== undefined,
    ...(shot.error === undefined ? {} : { error: shot.error }),
  }
}

const takeView = (t: ShotView['firstFrames'][number]) => ({
  id: t.id,
  kind: t.kind,
  version: t.version,
  adopted: t.adopted,
  ...(t.trim === undefined ? {} : { trim: t.trim }),
  model: t.modelId,
  createdAt: t.createdAt,
  ...(t.costUsd === undefined
    ? {}
    : { costUsd: t.costUsd, costEstimated: t.costEstimated ?? false }),
})

export function shotDetail(shot: ShotView) {
  return {
    ...shotSummary(shot),
    timeOfDay: shot.timeOfDay ?? null,
    locationId: shot.locationId ?? null,
    prompt: shot.prompt ?? null,
    autoPrompt: shot.autoPrompt,
    lockedCharacters: shot.lockedCharacters ?? [],
    takes: {
      firstFrames: shot.firstFrames.map(takeView),
      videos: shot.videos.map(takeView),
      // 生成過不只一版尾幀時才列（用 adopt_version 換回舊的）
      endFrames: (shot.endFrames ?? []).map(takeView),
    },
    endFrame:
      shot.endFrame === undefined
        ? null
        : {
            assetHash: shot.endFrame.assetHash,
            /** false = the current video model does not take an end frame, so it is NOT sent. */
            usedByCurrentVideoModel: shot.endFrameSupported === true,
          },
  }
}

/** 分鏡表：看、改、新增、刪除、排序。都不花錢（不會呼叫任何模型）。 */
export function registerShotTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_shots',
    title: 'List shots',
    description:
      'The shot list of the current project in order, optionally only one scene. Each shot has an id, number, description (the still picture), action (what happens during the seconds; empty = none), size, angle, camera move, duration, characters, status and how many first-frame/video versions exist (and which is adopted).',
    input: { sceneId: z.string().optional().describe('Only the shots of this scene') },
    hints: { readOnly: true },
    run: async ({ sceneId }) => {
      const snapshot = await ctx.caller.call('shots.list', {})
      const shots = snapshot.shots.filter((s) => sceneId === undefined || s.sceneId === sceneId)
      return {
        count: shots.length,
        shots: shots.map(shotSummary),
        hasFinalCut: snapshot.finalVideoHash !== undefined,
      }
    },
  })

  defineTool(ctx, {
    name: 'get_shot',
    title: 'Get one shot in full',
    description:
      'Everything about one shot: the fields of list_shots plus the prompt that will be sent to the image/video model (autoPrompt, and prompt if the user edited it), lighting, location, and every generated version with its model and cost.',
    input: { shotId: z.string().min(1).describe('A shot id from list_shots') },
    hints: { readOnly: true },
    run: async ({ shotId }) => {
      const snapshot = await ctx.caller.call('shots.list', {})
      const shot = snapshot.shots.find((s) => s.id === shotId)
      if (!shot) {
        return {
          error: `The shot “${shotId}” was not found. Call list_shots to see which shots exist.`,
        }
      }
      return shotDetail(shot)
    },
  })

  defineTool(ctx, {
    name: 'get_shot_references',
    title: 'See which reference pictures a shot uses',
    description:
      "Which reference pictures go into this shot's first-frame picture, and which ones you could choose instead. `picked` is exactly what will be sent (the same list the app shows on the canvas), in order; `mode` is \"auto\" (the app picks by the shot's size and angle from the LOCKED characters' and places' pictures) or \"pinned\" (someone chose them by hand, so ONLY those are sent). `candidates` are the pictures you may pin: the pictures of the characters in the shot (main picture, three views, added references such as face or body) and of the shot's place (main view, angles, added references such as top_down or depth), each with whose it is and what it shows. `limit` is how many the current image model takes (0 = this shot sends none, see `reason`). Free; changes nothing.",
    input: { shotId: z.string().min(1).describe('A shot id from list_shots') },
    hints: { readOnly: true },
    run: async ({ shotId }) => {
      const state = await ctx.caller.call('shots.references', { shotId })
      return {
        mode: state.auto ? 'auto' : 'pinned',
        limit: state.limit,
        ...(state.reason === undefined ? {} : { reason: state.reason }),
        picked: state.picked,
        candidates: state.candidates,
      }
    },
  })

  defineTool(ctx, {
    name: 'set_shot_references',
    title: 'Choose the reference pictures of a shot',
    description:
      "Choose by hand which reference pictures this shot's first-frame picture is drawn from (assetHashes from get_shot_references `candidates`, in order, at most `limit`). Only the pictures you list are sent, so use it when the automatic choice shows the wrong face, outfit or place — e.g. a close-up that needs the face picture, or an overhead shot that needs the place's top-down view. Pass an empty list to go back to the automatic choice. Free, but the shot's first-frame picture then needs regenerating (regenerate_shot what=\"first_frame\"), which costs money: tell the user the price first (estimate_cost). Undo works like the app's own.",
    input: {
      shotId: z.string().min(1),
      assetHashes: z
        .array(z.string().min(1))
        .max(12)
        .describe('Ordered assetHashes from get_shot_references candidates; [] = automatic'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId, assetHashes }) => {
      const state = await ctx.caller.call('shots.setReferences', { shotId, assetHashes })
      return {
        mode: state.auto ? 'auto' : 'pinned',
        limit: state.limit,
        picked: state.picked,
        note: state.auto
          ? 'Back to the automatic choice.'
          : 'Pinned. The first-frame picture is now out of date: regenerate it to use these pictures.',
      }
    },
  })

  defineTool(ctx, {
    name: 'set_shot_end_frame',
    title: 'Set the end frame of a shot',
    description:
      "Tell the video model what the LAST frame of this shot's video should look like: pass the assetHash of a picture already in the project (list_project_images). The video is then drawn from the first frame towards that picture — use it when the shot ends on something specific, e.g. the character landing on the far side with its face intact. It is only sent when the current video model accepts an end frame (get_shot: endFrame.usedByCurrentVideoModel; Kling 3.0 Standard does). Free, but the shot's video then needs regenerating (regenerate_shot what=\"video\"), which costs money: tell the user the price first (estimate_cost). Undo works like the app's own. Older end frames are never deleted: setting another one (or clearing) only changes which one is in use, and get_shot takes.endFrames lists them all (adopt_version with a takeId goes back, also to one that cost money to generate). clear_shot_end_frame removes it from use.",
    input: {
      shotId: z.string().min(1),
      assetHash: z.string().min(1).describe('An image assetHash from list_project_images'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId, assetHash }) =>
      shotSummary(await ctx.caller.call('shots.setEndFrame', { shotId, assetHash })),
  })

  defineTool(ctx, {
    name: 'clear_shot_end_frame',
    title: 'Remove the end frame of a shot',
    description:
      "Stop using the end frame set with set_shot_end_frame or generate_end_frame (the pictures are kept: get_shot takes.endFrames, adopt_version to use one again); the video goes back to being drawn from the first frame alone. Free, but the shot's video then needs regenerating (costs money, see estimate_cost). Undo works like the app's own.",
    input: { shotId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId }) =>
      shotSummary(await ctx.caller.call('shots.setEndFrame', { shotId, assetHash: null })),
  })

  defineTool(ctx, {
    name: 'update_shot',
    title: 'Edit a shot',
    description:
      'Change fields of one shot (only the fields you pass). Does NOT generate anything and costs nothing; regenerating pictures/videos is a separate step. Fields: description (ONLY the still picture the first frame should show: who is where, pose, expression, setting — no movement and no camera move), action (what happens during the seconds of the shot, e.g. "the small yellow dome hops once to the left and lands; the vines behind it sway" — describe motion only, name each subject the way it looks in the picture (for example "the small yellow dome") and say what it does; do not re-describe how things look. When action is set, the video model gets the action first, then the "NO mouth / NO arms"-type limits of the locked characters, then the art style; the first-frame picture still comes from description alone. Leave it empty and the video prompt is the picture description as before; send "" to clear), endDescription (what the END frame should look like: the SAME picture a few seconds later, used by generate_end_frame. Write only what changes: where each character is now, its pose, what is lit up. The camera position, scene and style are kept from the first frame, so do not describe them. Name each character the way it looks in the picture. Do NOT write percentages or pixel sizes: give sizes relative to something else in the picture, e.g. "about one third of the height of the orc, both eyes visible". A character that moved appears once, in its new place; the old place is left empty), size (extreme_wide|wide|full|medium|close_up|extreme_close_up), angle, cameraMove (null, or a preset id: ' +
      CAMERA_MOVES.map((c) => c.id).join(', ') +
      '; or your own short description such as "slow push in" — a text that is not a preset id is added to the video prompt exactly as written), durationSec (1–15), dialogue, characters (names), lighting, mood, timeOfDay, prompt (null = back to the automatic prompt), inCut. See load_guide("cinematography") for when to use each size, angle and camera move.',
    input: { shotId: z.string().min(1), ...ShotEditSchema.shape },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId, ...patch }) => {
      const shot = await ctx.caller.call('shots.update', { shotId, patch })
      return shotSummary(shot)
    },
  })

  defineTool(ctx, {
    name: 'create_shot',
    title: 'Add an empty shot',
    description:
      'Add a new empty shot (to a scene and/or right after another shot). Fill it in with update_shot. See load_guide("cinematography") for when to use each size, angle and camera move.',
    input: {
      sceneId: z.string().optional().describe('Put it in this scene'),
      afterShotId: z.string().optional().describe('Put it right after this shot'),
    },
    hints: { readOnly: false },
    run: async (args) => {
      const shot = await ctx.caller.call('shots.create', {
        ...(args.sceneId === undefined ? {} : { sceneId: args.sceneId }),
        ...(args.afterShotId === undefined ? {} : { afterShotId: args.afterShotId }),
      })
      return shotSummary(shot)
    },
  })

  defineTool(ctx, {
    name: 'delete_shots',
    title: 'Delete shots',
    description:
      'Delete shots and every picture/video generated for them, then renumber the rest. Deleting can be undone: the undo tool (or the user pressing undo) brings the shots back together with their pictures, video versions and sound, so there is no need to treat a delete as irreversible. Money already spent is not refunded, and regenerating media after a delete would cost again.',
    input: { shotIds: z.array(z.string().min(1)).min(1).max(100) },
    hints: { readOnly: false, destructive: true },
    run: async ({ shotIds }) => {
      const snapshot = await ctx.caller.call('shots.delete', { shotIds })
      return { remaining: snapshot.shots.length, shots: snapshot.shots.map(shotSummary) }
    },
  })

  defineTool(ctx, {
    name: 'reorder_shots',
    title: 'Reorder shots',
    description:
      'Put all shots in a new order: pass EVERY shot id exactly once, in the order you want.',
    input: { orderedIds: z.array(z.string().min(1)).min(1).max(500) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ orderedIds }) => {
      const snapshot = await ctx.caller.call('shots.reorder', { orderedIds })
      return { shots: snapshot.shots.map(shotSummary) }
    },
  })
}
