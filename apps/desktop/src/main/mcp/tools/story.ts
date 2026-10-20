import { OutlineOpSchema } from '@svs/schema'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { defineTool, type ToolContext } from './define'
import { GENERATION_RESERVE_FACTOR, estimateBatch } from './film'
import { TEXT_RESERVE_FACTOR, reserveSpending } from './spend'

const shotView = (s: {
  id: string
  number: number
  sceneId?: string | undefined
  description: string
  size: string
  angle: string
  cameraMove: string | null
  durationSec: number
  characters: string[]
}) => ({
  id: s.id,
  number: s.number,
  sceneId: s.sceneId ?? null,
  description: s.description,
  size: s.size,
  angle: s.angle,
  cameraMove: s.cameraMove,
  durationSec: s.durationSec,
  characters: s.characters,
})

/** `estimate_cost` 收的動作名稱。對話的開場提示（chat/claude-args.ts）也寫了這些名字，有單元測試對著它檢查。 */
export const ESTIMATE_COST_ACTIONS = [
  'split_story_into_scenes',
  'split_scene_into_shots',
  'generate_first_frames',
  'generate_videos',
] as const

/** 故事 → 分場 → 鏡頭。兩個「拆」的步驟會呼叫文字模型，先過額度。 */
export function registerStoryTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'get_outline',
    title: 'Get the story outline',
    description:
      'The outline of the current project: acts → scenes (each with an id you pass to split_scene_into_shots), and the locations. Empty until you call split_story_into_scenes or edit_outline.',
    input: {},
    hints: { readOnly: true },
    run: () => ctx.caller.call('outline.get', {}),
  })

  defineTool(ctx, {
    name: 'split_story_into_scenes',
    title: 'Split a story into scenes',
    description:
      "Paste the story (any length up to 60,000 characters). The app's AI splits it into acts and scenes and extracts characters (as drafts) and locations. REPLACES the current outline. Calls a text model, so it counts against the spending allowance (see estimate_cost first); free in demo mode. Opens a project automatically if none is open.",
    input: { story: z.string().trim().min(1).max(60_000).describe('The story text') },
    hints: { readOnly: false, destructive: true },
    run: async ({ story }) => {
      const check = await ctx.caller.call('outline.splitCheck', { text: story })
      if (!check.ok) {
        throw new McpToolError(check.issue ?? '現在不能把故事拆成分場。', 'cannot_split')
      }
      const reserved = reserveSpending(ctx, '把故事拆成分場', check.estimatedUsd)
      const result = await ctx.caller.call('outline.split', { text: story })
      return {
        replacedExistingOutline: check.replacesExisting,
        outline: result.outline,
        newCharacters: result.newCharacters,
        newLocations: result.newLocations,
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
      }
    },
  })

  defineTool(ctx, {
    name: 'edit_outline',
    title: 'Edit the outline',
    description:
      'Change the outline with one operation (add/update/delete/move an act, a scene or a location). Returns the whole outline after the change. Use ids from get_outline. Undo with the undo tool. Free.',
    input: {
      operation: OutlineOpSchema.describe(
        'One outline operation, e.g. {"op":"updateScene","sceneId":"…","patch":{"summary":"…"}}',
      ),
    },
    hints: { readOnly: false, destructive: true },
    run: ({ operation }) => ctx.caller.call('outline.edit', operation),
  })

  defineTool(ctx, {
    name: 'split_scene_into_shots',
    title: 'Split a scene into shots',
    description:
      'The app\'s AI plans 2–6 shots for one scene (size, angle, camera move, duration, who is in it), following the storyboard guide (see load_guide "storyboard"; also load_guide "cinematography" for when to use each size, angle and camera move). REPLACES the scene\'s current shots; if some already have generated pictures or videos you must pass replaceGenerated=true. Calls a text model, so it counts against the spending allowance; free in demo mode. After it, review with list_shots and fix with update_shot.',
    input: {
      sceneId: z.string().min(1).describe('A scene id from get_outline'),
      replaceGenerated: z
        .boolean()
        .default(false)
        .describe('Set true to replace shots that already have generated pictures or videos'),
    },
    hints: { readOnly: false, destructive: true },
    run: async ({ sceneId, replaceGenerated }) => {
      const check = await ctx.caller.call('storyboard.splitCheck', { sceneId })
      if (!check.ok)
        throw new McpToolError(check.issue ?? '現在不能替這個場拆鏡頭。', 'cannot_split')
      if (check.generatedShots > 0 && !replaceGenerated) {
        throw new McpToolError(
          `這個場已經有 ${String(check.generatedShots)} 個鏡頭生成過畫面或影片，重拆會把它們換掉（花過的錢不會退）。確定要換的話，把 replaceGenerated 設成 true。`,
          'would_replace_generated',
        )
      }
      const reserved = reserveSpending(ctx, '替這個場拆鏡頭', check.estimatedUsd)
      const snapshot = await ctx.caller.call('storyboard.splitScene', { sceneId })
      return {
        shots: snapshot.shots.filter((s) => s.sceneId === sceneId).map(shotView),
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
      }
    },
  })

  defineTool(ctx, {
    name: 'estimate_cost',
    title: 'Estimate the cost of a step',
    description:
      "Ask what a step would cost before doing it. Does not spend or reserve anything. Steps: split_story_into_scenes and split_scene_into_shots (text), generate_first_frames and generate_videos (pictures and videos; the same numbers the app shows in its own 'generate all' confirmation, for the shots you name or every shot in the cut). Returns the app's estimate, how much the allowance would reserve (the estimate × " +
      String(TEXT_RESERVE_FACTOR) +
      ' for text steps, because reasoning models often cost more than estimated; × ' +
      String(GENERATION_RESERVE_FACTOR) +
      ' for pictures and videos), the allowance left, and whether it fits. possible=false (with an issue) means the step cannot start now, for example videos before any first frame exists. For sound use plan_sound.',
    input: {
      action: z.enum(ESTIMATE_COST_ACTIONS).describe('Which step to estimate'),
      story: z
        .string()
        .max(120_000)
        .optional()
        .describe('For split_story_into_scenes: the story text'),
      sceneId: z.string().optional().describe('For split_scene_into_shots: the scene id'),
      shotIds: z
        .array(z.string().min(1))
        .max(100)
        .optional()
        .describe(
          'For generate_first_frames and generate_videos: only these shots (default: all shots in the cut)',
        ),
      redo: z
        .boolean()
        .default(false)
        .describe(
          'For generate_first_frames and generate_videos: price new versions even where one exists',
        ),
      draft: z
        .boolean()
        .default(false)
        .describe('For generate_first_frames and generate_videos: the cheaper "draft" model tier'),
    },
    hints: { readOnly: true },
    run: async ({ action, story, sceneId, shotIds, redo, draft }) => {
      if (action === 'generate_first_frames' || action === 'generate_videos') {
        return estimateBatch(
          ctx,
          action === 'generate_first_frames' ? 'frame' : 'video',
          shotIds,
          redo,
          draft,
        )
      }
      const check =
        action === 'split_story_into_scenes'
          ? await ctx.caller.call('outline.splitCheck', { text: story ?? '' })
          : await ctx.caller.call('storyboard.splitCheck', { sceneId: sceneId ?? '' })
      const allowance = ctx.allowance.status()
      const demo = check.demoMode
      const wouldReserveUsd = demo ? 0 : check.estimatedUsd * TEXT_RESERVE_FACTOR
      return {
        possible: check.ok,
        ...(check.issue === undefined ? {} : { issue: check.issue }),
        demoMode: demo,
        estimatedUsd: check.estimatedUsd,
        wouldReserveUsd,
        allowance,
        fits: demo || wouldReserveUsd <= allowance.remainingUsd,
      }
    },
  })
}
