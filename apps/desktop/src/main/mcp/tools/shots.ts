import { ShotEditSchema, type ShotView } from '@svs/schema'
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
    video: { versions: shot.videos.length, adoptedVersion: adoptedVersion(shot.videos) },
    ...(shot.error === undefined ? {} : { error: shot.error }),
  }
}

const takeView = (t: ShotView['firstFrames'][number]) => ({
  id: t.id,
  kind: t.kind,
  version: t.version,
  adopted: t.adopted,
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
    takes: { firstFrames: shot.firstFrames.map(takeView), videos: shot.videos.map(takeView) },
  }
}

/** 分鏡表：看、改、新增、刪除、排序。都不花錢（不會呼叫任何模型）。 */
export function registerShotTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_shots',
    title: 'List shots',
    description:
      'The shot list of the current project in order, optionally only one scene. Each shot has an id, number, description, size, angle, camera move, duration, characters, status and how many first-frame/video versions exist (and which is adopted).',
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
        return { error: `找不到鏡頭「${shotId}」。請先用 list_shots 看有哪些鏡頭。` }
      }
      return shotDetail(shot)
    },
  })

  defineTool(ctx, {
    name: 'update_shot',
    title: 'Edit a shot',
    description:
      'Change fields of one shot (only the fields you pass). Does NOT generate anything and costs nothing; regenerating pictures/videos is a separate step. Fields: description, size (extreme_wide|wide|full|medium|close_up|extreme_close_up), angle, cameraMove (a preset id or null), durationSec (1–15), dialogue, characters (names), lighting, mood, timeOfDay, prompt (null = back to the automatic prompt), inCut.',
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
      'Add a new empty shot (to a scene and/or right after another shot). Fill it in with update_shot.',
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
      'Delete shots and every picture/video generated for them (money already spent is not refunded), then renumber the rest. Undo is available with the undo tool for the shot list, but generated media may not come back; be careful.',
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
