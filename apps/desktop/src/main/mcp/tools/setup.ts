import {
  AspectRatioSchema,
  QUICK_STYLE_IDS,
  QUICK_STYLE_LABELS,
  QuickStyleIdSchema,
} from '@svs/schema'
import { z } from 'zod'

import { defineTool, type ToolContext } from './define'

/** 模型、畫風與比例、復原。都不花錢。 */
export function registerSetupTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_models',
    title: 'List the models you can use',
    description:
      'The text, image and video models available right now (only those whose service the user has a key for; in demo mode the demo models), with their price, plus which one is selected for each use and which are locked because a key is missing (the user adds keys under 設定 → 服務金鑰). Pass the ids to set_models. You never see or need API keys.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const { models, selected, locked, project } = await ctx.caller.call('models.list', {})
      const view = (m: (typeof models)[number]) => ({
        id: m.id,
        name: m.displayName,
        service: m.providerName,
        capabilities: m.capabilities,
        tier: m.tier,
        recommended: m.recommended,
        price: m.priceShort,
        priceVerified: m.priceVerified,
        badges: m.badges,
        ...(m.notes === undefined ? {} : { notes: m.notes }),
        ...(m.voices.length === 0
          ? {}
          : { voices: m.voices.map((v) => ({ id: v.id, label: v.label, language: v.language })) }),
      })
      return {
        available: models.map(view),
        selected: {
          text: selected.llm ?? null,
          image: selected.t2i ?? null,
          video: selected.i2v ?? null,
        },
        thisProject: project
          ? {
              text: project.models.llm ?? null,
              image: project.models.t2i ?? null,
              video: project.models.i2v ?? null,
            }
          : null,
        lockedNeedingAKey: locked.map((m) => ({
          id: m.id,
          name: m.displayName,
          needs: m.needsKey ?? null,
        })),
      }
    },
  })

  defineTool(ctx, {
    name: 'set_models',
    title: 'Choose the models for this project',
    description:
      "Pick which text, image and video model THIS project uses (ids from list_models). Pass null to go back to the app's default for that use. Only the fields you pass change. Costs nothing, but it changes what later steps cost.",
    input: {
      text: z.string().min(1).nullable().optional().describe('Text model id (storyboard, prompts)'),
      image: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe('Image model id (character pictures, first frames)'),
      video: z.string().min(1).nullable().optional().describe('Video model id'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ text, image, video }) => {
      await ctx.caller.call('models.setProject', {
        models: {
          ...(text === undefined ? {} : { llm: text }),
          ...(image === undefined ? {} : { t2i: image }),
          ...(video === undefined ? {} : { i2v: video }),
        },
      })
      const { project } = await ctx.caller.call('models.list', {})
      return {
        thisProject: project
          ? {
              text: project.models.llm ?? null,
              image: project.models.t2i ?? null,
              video: project.models.i2v ?? null,
            }
          : null,
      }
    },
  })

  defineTool(ctx, {
    name: 'configure_project',
    title: 'Set the look and the frame size',
    description:
      "Set the project's art style and/or aspect ratio (only what you pass changes; pass nothing to read the current values). Styles: " +
      QUICK_STYLE_IDS.map((id) => `${id} (${QUICK_STYLE_LABELS[id]})`).join(', ') +
      '. Aspect ratios: 16:9, 9:16, 1:1, 4:3, 21:9. Later pictures use the new setting; existing ones are not redone. Free.',
    input: {
      style: QuickStyleIdSchema.optional().describe('Art style id'),
      aspectRatio: AspectRatioSchema.optional().describe('Frame shape'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ style, aspectRatio }) => {
      const result = await ctx.caller.call('project.configure', {
        ...(style === undefined ? {} : { styleId: style }),
        ...(aspectRatio === undefined ? {} : { aspectRatio }),
      })
      return {
        style: result.styleId,
        styleName: QUICK_STYLE_LABELS[result.styleId],
        aspectRatio: result.aspectRatio,
      }
    },
  })

  defineTool(ctx, {
    name: 'undo',
    title: 'Undo the last outline/shot-list change',
    description:
      'Undo the last change to the outline or shot list (the same Undo the app has). Returns whether something was undone and whether more undo/redo is available. Generated pictures and videos are not part of undo.',
    input: {},
    hints: { readOnly: false },
    run: () => ctx.caller.call('history.undo', {}),
  })

  defineTool(ctx, {
    name: 'redo',
    title: 'Redo',
    description: 'Redo what undo undid.',
    input: {},
    hints: { readOnly: false },
    run: () => ctx.caller.call('history.redo', {}),
  })
}
