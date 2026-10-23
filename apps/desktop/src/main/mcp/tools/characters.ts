import {
  CHARACTER_REFERENCE_LABEL_MAX,
  CHARACTER_REFERENCE_PURPOSES,
  CHARACTER_REFERENCE_PURPOSE_LABELS,
  CharacterEditSchema,
  type CharacterView,
  type ReferenceView,
} from '@svs/schema'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { WithImages, defineTool, type ToolContext } from './define'
import { reserveSpending } from './spend'

/** 圖片模型的價格是一張一張算的，預估很準；預留只多留一點點。 */
export const IMAGE_RESERVE_FACTOR = 1.25
/** 「幫我把長相整理成固定外觀描述」是一次文字模型的小呼叫（約幾美分）；沒有預估介面，用固定金額預留。 */
export const SUGGEST_ANCHOR_ESTIMATE_USD = 0.03

const referenceView = (r: ReferenceView) => ({
  referenceId: r.id,
  assetHash: r.assetHash,
  purpose: r.purpose,
  label: r.label,
  /** canvas＝在畫布上接到「參考圖」的圖，只能在畫布上剪線拿掉。 */
  source: r.source,
})

const characterView = (c: CharacterView, references?: ReferenceView[]) => ({
  id: c.id,
  name: c.name,
  age: c.age ?? null,
  appearance: c.appearance,
  outfit: c.outfit,
  personality: c.personality,
  avoid: c.avoid,
  anchor: { status: c.anchorStatus, text: c.anchorText },
  version: c.version,
  hasHeroImage: c.heroAssetHash !== undefined,
  hasTurnaround: c.turnaround !== undefined,
  ...(references === undefined ? {} : { references: references.map(referenceView) }),
})

/** 角色：建立、寫固定外觀、生成概念圖、挑主圖、鎖定。看圖（view_character_images）也在這裡。 */
export function registerCharacterTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_characters',
    title: 'List characters',
    description:
      'The characters of the current project (split_story_into_scenes creates draft characters for you). Each has an id, avoid (features it must NOT get in video; see update_character), the fixed look text ("anchor": none/draft/locked — a LOCKED anchor is sent unchanged with every shot prompt that includes the character), whether it has a hero picture, and references: its reference pictures, each with a purpose (face, body, turnaround, expression, costume, prop, general; see add_character_reference).',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const { characters } = await ctx.caller.call('characters.list', {})
      const views = []
      for (const c of characters) {
        const { references } = await ctx.caller.call('characters.references', { characterId: c.id })
        views.push(characterView(c, references))
      }
      return { characters: views }
    },
  })

  defineTool(ctx, {
    name: 'create_character',
    title: 'Create a character',
    description:
      'Add a character card. Name is required; the other fields describe the look and are optional (you can fill them later with update_character). Besides the look, set avoid (English, comma separated, e.g. "mouth, eyebrows, arms, legs": features this character does NOT have and must never grow in a video, such as a slime with no mouth or limbs; when a shot that includes this character is turned into video the list is appended to the negative prompt of the video model, after the general list; do not list traits that another character in the same shots does have, since the lists of all characters in a shot are combined as written; "" clears it; it does not unlock a locked look). Free.',
    input: {
      name: z.string().trim().min(1).max(40),
      ...CharacterEditSchema.omit({ name: true }).shape,
    },
    hints: { readOnly: false },
    run: async ({ name, ...fields }) => {
      const created = await ctx.caller.call('characters.create', { name })
      const hasFields = Object.values(fields).some((v) => v !== undefined)
      const final = hasFields
        ? await ctx.caller.call('characters.update', { characterId: created.id, patch: fields })
        : created
      return characterView(final)
    },
  })

  defineTool(ctx, {
    name: 'update_character',
    title: 'Edit a character',
    description:
      'Change a character card (only the fields you pass): name, age (null clears), appearance, outfit, personality, avoid (English, comma separated, e.g. "mouth, eyebrows, arms, legs": features this character does NOT have and must never grow in a video, such as a slime with no mouth or limbs; when a shot that includes this character is turned into video the list is appended to the negative prompt of the video model, after the general list; do not list traits that another character in the same shots does have, since the lists of all characters in a shot are combined as written; "" clears it; it does not unlock a locked look). Free. To change the fixed look sent to the image/video models use set_character_anchor.',
    input: { characterId: z.string().min(1), ...CharacterEditSchema.shape },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId, ...patch }) =>
      characterView(await ctx.caller.call('characters.update', { characterId, patch })),
  })

  defineTool(ctx, {
    name: 'suggest_character_anchor',
    title: 'Ask the AI to write the fixed look text',
    description:
      'The app\'s AI condenses the character\'s appearance and outfit into one short, fixed description (the "anchor"). It only RETURNS the suggestion; save it (after editing if you like) with set_character_anchor. One small text-model call: counts a few cents against the spending allowance, free in demo mode.',
    input: { characterId: z.string().min(1) },
    hints: { readOnly: true },
    run: async ({ characterId }) => {
      const reserved = reserveSpending(
        ctx,
        'Condense the fixed appearance description',
        SUGGEST_ANCHOR_ESTIMATE_USD,
        1,
      )
      const { text } = await ctx.caller.call('characters.suggestAnchor', { characterId })
      return { suggestion: text, spending: reserved }
    },
  })

  defineTool(ctx, {
    name: 'set_character_anchor',
    title: 'Set the fixed look text',
    description:
      'Save the fixed look text ("anchor", up to 1000 characters): short, concrete, only what can be SEEN (shape, colours, what the character does NOT have). If the character was locked, this makes a new draft version that must be locked again. Free.',
    input: { characterId: z.string().min(1), text: z.string().max(1000) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId, text }) =>
      characterView(await ctx.caller.call('characters.setAnchor', { characterId, text })),
  })

  defineTool(ctx, {
    name: 'list_project_images',
    title: 'List the pictures in the project',
    description:
      'The pictures already stored in the current project (newest first): assetHash, size, and where each is used ("usedBy"; empty = a picture the user uploaded or dropped on the canvas that nothing uses yet). Use the assetHash with add_character_reference to make one a character reference. Free. This cannot import files from the computer: ask the user to drop the picture onto the canvas first.',
    input: { limit: z.number().int().min(1).max(60).default(20) },
    hints: { readOnly: true },
    run: async ({ limit }) => {
      const { files } = await ctx.caller.call('files.list', { kind: 'image' })
      return {
        images: files.slice(0, limit).map((f) => ({
          assetHash: f.hash,
          width: f.width ?? null,
          height: f.height ?? null,
          usedBy: f.usedBy,
        })),
        total: files.length,
      }
    },
  })

  defineTool(ctx, {
    name: 'add_character_reference',
    title: 'Add a reference picture to a character',
    description: `Make a picture that is ALREADY in the project (assetHash from list_project_images) a reference picture of the character, and say what it shows (purpose: ${CHARACTER_REFERENCE_PURPOSES.join(', ')}). A character can have several references with different purposes (for example a face close-up, a body without the face, a turnaround sheet, an expression sheet, a costume, a prop). From then on generate_character_images draws the concept pictures FROM the references (an image-edit model keeps the face, colours, markings and proportions; only the art style changes), and tells the model what each reference is, instead of working from the text alone. Add the character's original design sheet to keep it identical to the original. The same picture with the same purpose is stored once. Free. Only pictures already in the project can be used.`,
    input: {
      characterId: z.string().min(1),
      assetHash: z.string().min(1).describe('assetHash of a picture in the project'),
      purpose: z
        .enum(CHARACTER_REFERENCE_PURPOSES)
        .default('general')
        .describe('What the picture shows; "general" = a design sheet or anything else'),
      label: z
        .string()
        .max(CHARACTER_REFERENCE_LABEL_MAX)
        .default('')
        .describe('Optional short note, e.g. "original design sheet"'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId, assetHash, purpose, label }) => {
      const state = await ctx.caller.call('characters.addReference', {
        characterId,
        assetHash,
        purpose,
        label,
      })
      return {
        references: state.references.map(referenceView),
        purposes: CHARACTER_REFERENCE_PURPOSE_LABELS,
        next: 'Call generate_character_images: it will draw the next round from the reference picture(s). To look at the references use view_character_images with includeReferences.',
      }
    },
  })

  defineTool(ctx, {
    name: 'remove_character_reference',
    title: "Remove a character's reference picture",
    description:
      'Remove one reference picture added with add_character_reference (referenceId from list_characters). The picture itself stays in the project. References with source "canvas" were connected on the canvas and can only be removed there. Free.',
    input: { characterId: z.string().min(1), referenceId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId, referenceId }) => {
      const state = await ctx.caller.call('characters.removeReference', {
        characterId,
        referenceId,
      })
      return { references: state.references.map(referenceView) }
    },
  })

  defineTool(ctx, {
    name: 'generate_character_images',
    title: 'Generate character pictures',
    description:
      "Start one round of concept pictures (4 candidates) for a character, from its look text and the project's art style — or, if the character has reference pictures (add_character_reference), drawn from those references so the character stays the same as the original. Runs in the background: this returns at once; then call wait_for_generation and view_character_images. Calls the image model, so it counts against the spending allowance (see estimate_cost-style numbers in the reply); free in demo mode.",
    input: { characterId: z.string().min(1) },
    hints: { readOnly: false },
    run: async ({ characterId }) => {
      const check = await ctx.caller.call('characters.conceptCheck', { characterId })
      if (!check.ok)
        throw new McpToolError(
          check.issue ?? 'Character concept pictures cannot be generated right now.',
          'cannot_generate',
        )
      const reserved = reserveSpending(
        ctx,
        `Generate ${String(check.count)} character concept picture(s)`,
        check.estimatedUsd,
        IMAGE_RESERVE_FACTOR,
      )
      await ctx.caller.call('characters.generateConcepts', { characterId })
      return {
        started: true,
        images: check.count,
        model: check.modelName ?? null,
        referencePictures: check.references ?? 0,
        demoMode: check.demoMode,
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
        next: 'Call wait_for_generation, then view_character_images to look at them.',
      }
    },
  })

  defineTool(ctx, {
    name: 'view_character_images',
    title: "Look at a character's pictures",
    description:
      'Returns the concept pictures of a character as images you can look at (downsized), newest round first, plus the hero picture if one is picked. The reply text lists, in the same order, which conceptId each image is: pass the one you like to pick_character_image. Also reports whether a round is still generating.',
    input: {
      characterId: z.string().min(1),
      maxImages: z
        .number()
        .int()
        .min(1)
        .max(8)
        .default(4)
        .describe('How many concept pictures to return'),
      includeHero: z.boolean().default(true).describe('Also return the picked hero picture'),
      includeReferences: z
        .boolean()
        .default(false)
        .describe("Also return the character's reference pictures (first, with their purposes)"),
    },
    hints: { readOnly: true },
    run: async ({ characterId, maxImages, includeHero, includeReferences }) => {
      const state = await ctx.caller.call('characters.concepts', { characterId })
      const list = await ctx.caller.call('characters.list', {})
      const character = list.characters.find((c) => c.id === characterId)
      const concepts = state.concepts.slice(0, maxImages)
      const images = []
      const order: (
        | { conceptId: string; round: number }
        | { hero: true }
        | { referenceId: string; purpose: string }
      )[] = []
      if (includeReferences) {
        const { references } = await ctx.caller.call('characters.references', { characterId })
        for (const reference of references) {
          images.push(await ctx.viewer.image(reference.assetHash))
          order.push({ referenceId: reference.id, purpose: reference.purpose })
        }
      }
      if (includeHero && character?.heroAssetHash) {
        images.push(await ctx.viewer.image(character.heroAssetHash))
        order.push({ hero: true })
      }
      for (const concept of concepts) {
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
    name: 'pick_character_image',
    title: 'Pick the hero picture',
    description:
      "Make one concept picture the character's hero picture (conceptId from view_character_images). The hero picture is what later steps use as the character's reference. Free.",
    input: { characterId: z.string().min(1), conceptId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId, conceptId }) =>
      characterView(await ctx.caller.call('characters.pickHero', { characterId, conceptId })),
  })

  defineTool(ctx, {
    name: 'lock_character',
    title: 'Lock the character',
    description:
      "Lock the character's look: the fixed look text (must not be empty) is then sent unchanged with every shot that includes this character, and the hero picture is used as the reference. Lock after the look text and hero picture are final. Changing the look text later starts a new draft version. Free.",
    input: { characterId: z.string().min(1) },
    hints: { readOnly: false, idempotent: true },
    run: async ({ characterId }) =>
      characterView(await ctx.caller.call('characters.lock', { characterId })),
  })
}
