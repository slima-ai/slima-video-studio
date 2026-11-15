import { LOCATION_ANCHOR_MAX, LocationGenerateKindSchema, type LocationCardView } from '@svs/schema'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { IMAGE_RESERVE_FACTOR } from './characters'
import { WithImages, defineTool, type ToolContext } from './define'
import { reserveSpending } from './spend'

const locationView = (card: LocationCardView) => ({
  id: card.id,
  name: card.name,
  description: card.description,
  anchor: {
    status: card.status === 'locked' ? 'locked' : card.anchorText.trim() === '' ? 'none' : 'draft',
    text: card.anchorText,
  },
  hasMainPicture: card.mainAssetHash !== undefined,
  otherAngles: {
    reverse: card.angles.reverse !== undefined,
    wide: card.angles.wide !== undefined,
  },
})

/** 場景卡（地點的視覺設定）：建立、寫固定描述、生成概念圖、挑主場景圖、鎖定。看圖（view_location_images）也在這裡。 */
export function registerLocationTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_locations',
    title: 'List location cards',
    description:
      'The location (place) cards of the current project (split_story_into_scenes and plan_trailer create draft locations for you; create_location adds one). Each has an id, the story description, the fixed place text ("anchor": none/draft/locked — a LOCKED anchor is sent unchanged, with the main picture as reference, with every shot of a scene set at this location), whether it has a main picture, and which other angles (reverse, wide) exist.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const { locations } = await ctx.caller.call('locations.list', {})
      return { locations: locations.map(locationView) }
    },
  })

  defineTool(ctx, {
    name: 'create_location',
    title: 'Create a location card',
    description:
      'Add a location (place) card. Name is required. description is what the story says about the place; anchor is the fixed place text (' +
      String(LOCATION_ANCHOR_MAX) +
      ' characters at most): describe the EMPTY setting only, no people, and keep the words identical for every shot (it is sent unchanged once the card is locked). Both are optional here; fill them later with update_location. Next: generate_location_images, view_location_images, pick_location_image, lock_location. One undo step. Free.',
    input: {
      name: z.string().trim().min(1).max(100),
      description: z.string().max(4000).default('').describe('What the story says about the place'),
      anchor: z.string().max(LOCATION_ANCHOR_MAX).optional().describe('The fixed place text'),
    },
    hints: { readOnly: false },
    run: async ({ name, description, anchor }) =>
      locationView(
        await ctx.caller.call('locations.create', {
          name,
          description,
          ...(anchor === undefined ? {} : { anchorText: anchor }),
        }),
      ),
  })

  defineTool(ctx, {
    name: 'update_location',
    title: 'Edit a location card',
    description:
      'Change a location card (only the fields you pass): name, description (the story text), anchor (the fixed place text; "" clears it). A LOCKED card cannot be changed: it must be unlocked in the app first. Free. One undo step for name and description.',
    input: {
      locationId: z.string().min(1),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(4000).optional(),
      anchor: z.string().max(LOCATION_ANCHOR_MAX).optional(),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ locationId, name, description, anchor }) => {
      if (name === undefined && description === undefined && anchor === undefined) {
        throw new McpToolError(
          'Pass at least one of name, description or anchor.',
          'nothing_to_change',
        )
      }
      let card: LocationCardView | undefined
      if (name !== undefined || description !== undefined) {
        card = await ctx.caller.call('locations.update', {
          locationId,
          patch: {
            ...(name === undefined ? {} : { name }),
            ...(description === undefined ? {} : { description }),
          },
        })
      }
      if (anchor !== undefined) {
        card = await ctx.caller.call('locations.setAnchor', { locationId, text: anchor })
      }
      if (card === undefined) throw new McpToolError('Nothing was changed.', 'nothing_to_change')
      return locationView(card)
    },
  })

  defineTool(ctx, {
    name: 'generate_location_images',
    title: 'Generate location pictures',
    description:
      'Start one round of pictures for a location card, drawn from its fixed place text and description and the project\'s art style. kind="concepts" (default): 4 candidate pictures of the empty setting; pick one with pick_location_image. kind="angles": after a main picture is picked, two more views of the same place (reverse, wide), drawn from the main picture. Runs in the background: this returns at once; then call wait_for_generation and view_location_images. Calls the image model, so it counts against the spending allowance (see the numbers in the reply); free in demo mode. A locked card must be unlocked first.',
    input: {
      locationId: z.string().min(1),
      kind: LocationGenerateKindSchema.default('concepts'),
    },
    hints: { readOnly: false },
    run: async ({ locationId, kind }) => {
      const check = await ctx.caller.call('locations.check', { locationId, kind })
      if (!check.ok) {
        throw new McpToolError(
          check.issue ?? 'Location pictures cannot be generated right now.',
          'cannot_generate',
        )
      }
      const reserved = reserveSpending(
        ctx,
        `Generate ${String(check.count)} location picture(s)`,
        check.estimatedUsd,
        IMAGE_RESERVE_FACTOR,
      )
      await ctx.caller.call('locations.generate', { locationId, kind })
      return {
        started: true,
        kind,
        images: check.count,
        model: check.modelName ?? null,
        demoMode: check.demoMode,
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
        next: 'Call wait_for_generation, then view_location_images to look at them.',
      }
    },
  })

  defineTool(ctx, {
    name: 'view_location_images',
    title: "Look at a location's pictures",
    description:
      'Returns the concept pictures of a location card as images you can look at (downsized), newest round first, plus the main picture and the other angles if there are any. The reply text lists, in the same order, which conceptId each concept picture is: pass the one you like to pick_location_image. Also reports whether a round is still generating.',
    input: {
      locationId: z.string().min(1),
      maxImages: z
        .number()
        .int()
        .min(1)
        .max(8)
        .default(4)
        .describe('How many concept pictures to return'),
      includeMain: z
        .boolean()
        .default(true)
        .describe('Also return the picked main picture and the other angles'),
    },
    hints: { readOnly: true },
    run: async ({ locationId, maxImages, includeMain }) => {
      const state = await ctx.caller.call('locations.images', { locationId })
      const { locations } = await ctx.caller.call('locations.list', {})
      const card = locations.find((l) => l.id === locationId)
      if (card === undefined) {
        throw new McpToolError('No location card has that id.', 'no_such_location')
      }
      const images = []
      const order: (
        { conceptId: string; round: number } | { main: true } | { angle: 'reverse' | 'wide' }
      )[] = []
      if (includeMain) {
        if (card.mainAssetHash) {
          images.push(await ctx.viewer.image(card.mainAssetHash))
          order.push({ main: true })
        }
        for (const angle of ['reverse', 'wide'] as const) {
          const hash = card.angles[angle]
          if (hash) {
            images.push(await ctx.viewer.image(hash))
            order.push({ angle })
          }
        }
      }
      for (const concept of state.concepts.slice(0, maxImages)) {
        images.push(await ctx.viewer.image(concept.assetHash))
        order.push({ conceptId: concept.id, round: concept.round })
      }
      return new WithImages(
        {
          generating: state.generating ?? null,
          ...(state.error === undefined ? {} : { lastError: state.error }),
          imagesInOrder: order,
        },
        images,
      )
    },
  })

  defineTool(ctx, {
    name: 'pick_location_image',
    title: 'Pick the main location picture',
    description:
      "Make one concept picture the location's main picture (conceptId from view_location_images). Any other angles made from an earlier main picture are cleared. Free.",
    input: { locationId: z.string().min(1), conceptId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ locationId, conceptId }) =>
      locationView(await ctx.caller.call('locations.pickMain', { locationId, conceptId })),
  })

  defineTool(ctx, {
    name: 'lock_location',
    title: 'Lock the location card',
    description:
      'Lock the location card: the fixed place text (must not be empty) is then used for every shot of a scene set at this location, together with the main picture if one is picked (a picture is not required). Lock after both are final. To change a locked card it must be unlocked in the app. Free.',
    input: { locationId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ locationId }) =>
      locationView(await ctx.caller.call('locations.lock', { locationId })),
  })
}
