import {
  TRAILER_TEMPLATES,
  TrailerKindSchema,
  TrailerSettingsPatchSchema,
  type ShotView,
  type TrailerKind,
  type TrailerStatus,
} from '@svs/schema'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { defineTool, type ToolContext } from './define'
import { shotSummary } from './shots'
import { reserveSpending } from './spend'

const fields = TrailerSettingsPatchSchema.shape

/**
 * 每一種預告片類型給 Claude 看的白話說明（寫了才有；新增類型時不寫也行：名字與各段佔比照樣從
 * `TrailerKindSchema`、`TRAILER_TEMPLATES` 取，指南會列出來，只是少一段說明）。
 */
const KIND_NOTES: Partial<Record<TrailerKind, string>> = {
  story:
    'A novel or story. hook: the strongest 1–2 pictures, no card or logo first; world: who and where; turn: the moment it goes wrong ("until…"); escalate: fast cuts of 1.5–2.5 s with little or no narration; suspense: one held picture, a question, a beat of near silence; title: cover, title, where to buy.',
  teaser:
    'A 15–30 s social cut. The strongest picture first (about 2 s), then 3–5 fast picture shots with 2–3 short cards that together read as one question, then the title card. No narration; it must make sense with the sound off.',
}

/** 指南的「Shape of the film」：每一種類型的各段與佔比（從模板資料產生）加上有寫的說明。 */
export const trailerKindShapes = (): string =>
  TrailerKindSchema.options
    .map((kind) => {
      const segments = TRAILER_TEMPLATES[kind].segments
        .map((segment) => {
          const extras = [
            segment.narrationDensity === 'none' ? 'no narration' : '',
            segment.maxCards > 0 ? `up to ${String(segment.maxCards)} text card(s)` : '',
          ].filter((extra) => extra !== '')
          const share = `${String(Math.round(segment.share * 100))}%`
          return `${segment.key} (${[share, ...extras].join(', ')})`
        })
        .join(' → ')
      const note = KIND_NOTES[kind]
      return `- ${kind}: ${segments}.${note === undefined ? '' : ` ${note}`}`
    })
    .join('\n')

/** 預告片設定裡 Claude 可以給的欄位（封面是檔案、配樂說明由 App 自己產生，不開放）。 */
const settingsInput = {
  kind: fields.kind.describe(
    `One of: ${TrailerKindSchema.options.join(', ')}. load_guide("trailer") says what each one is.`,
  ),
  targetSec: fields.targetSec.describe('Length of the film in seconds, 10–120 (default 30)'),
  title: fields.title.describe(
    "The book's title (for plan_trailer: when empty the AI takes it from the text)",
  ),
  author: fields.author.describe("The author's name"),
  tagline: fields.tagline.describe('One tagline line'),
  endLine: fields.endLine.describe('The last line: release date, where to buy'),
  narration: fields.narration.describe('Whether the trailer has narration (default true)'),
  music: fields.music.describe('Whether the trailer has music (default true)'),
  musicMood: fields.musicMood.describe('Mood of the music in a few words, e.g. "tense, heavy"'),
  claims: fields.claims.describe(
    'Blurbs, awards, sales figures or endorsements EXACTLY as the user gave them; the script may quote only these. Never invent any.',
  ),
}

/** 沒給的欄位拿掉（exactOptionalPropertyTypes：不能把 undefined 當成「有給」送出去）。 */
const defined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>

/** 一格的樣子（trailer 場裡的鏡頭）：種類與字卡要看得到，shotSummary 只在不是影片時才帶。 */
const beatView = (shot: ShotView) => ({
  ...shotSummary(shot),
  beatKind: shot.beatKind ?? 'video',
  card: shot.card ?? null,
  // 影片格比影片模型一支影片的上限還長：影片只會有上限那麼長，要縮短格長或用靜態畫面
  ...(shot.lengthOverMax === undefined ? {} : { lengthOverMax: shot.lengthOverMax }),
})

/** 差幾秒：腳本加總減目標，到千分之一秒（浮點數的尾巴不給 Claude 看）。 */
const secDiff = (status: TrailerStatus): number =>
  Math.round((status.scriptSec - status.targetSec) * 1000) / 1000

async function describeTrailer(ctx: ToolContext) {
  const status = await ctx.caller.call('trailer.status', {})
  const sceneId = status.settings.sceneId
  const { shots } = sceneId === undefined ? { shots: [] } : await ctx.caller.call('shots.list', {})
  const beats = shots.filter((s) => s.sceneId === sceneId).map(beatView)
  const differenceSec = secDiff(status)
  return {
    exists: status.exists,
    kind: status.settings.kind,
    targetSec: status.targetSec,
    scriptSec: status.scriptSec,
    // 正：比目標長；負：比目標短
    differenceSec,
    matches: status.matches,
    ...(status.filmSec === undefined ? {} : { filmSec: status.filmSec }),
    beatCount: status.beatCount,
    settings: {
      title: status.settings.title,
      author: status.settings.author,
      tagline: status.settings.tagline,
      endLine: status.settings.endLine,
      narration: status.settings.narration,
      music: status.settings.music,
      musicMood: status.settings.musicMood,
      claims: status.settings.claims,
    },
    beats,
    errors: status.errors,
    warnings: status.warnings,
    ...(status.exists && !status.matches && status.beatCount > 0
      ? {
          next: `The shots add up to ${String(status.scriptSec)} s but the target is ${String(status.targetSec)} s (${differenceSec > 0 ? 'too long' : 'too short'} by ${String(Math.abs(differenceSec))} s). Change a shot's durationSec with update_shot, or call update_trailer with refit=true to spread the time again.`,
        }
      : {}),
  }
}

const requireTrailer = async (ctx: ToolContext): Promise<void> => {
  const status = await ctx.caller.call('trailer.status', {})
  if (!status.exists || status.beatCount === 0) {
    throw new McpToolError(
      'This project has no trailer script yet. Call plan_trailer with the text first.',
      'no_trailer',
    )
  }
}

/** 預告片：寫腳本、看、改設定、加字卡、換靜態。其餘（角色、生成、剪裁、聲音、接片、匯出）沿用影片工具。 */
export function registerTrailerTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'plan_trailer',
    title: 'Write a trailer script',
    description:
      'Read a book text or story (up to 60,000 characters) and write a trailer script: a trailer scene with one shot per beat (moving picture, still picture, text card or title card), each with seconds, picture, narration; the shots add up to targetSec. Draft characters and place notes are created too. Read load_guide("trailer") first. Calls a text model, so it counts against the spending allowance (estimate_cost action plan_trailer first); free in demo mode. REPLACES the trailer script that is already in the project (other shots stay); if some of its shots already have pictures or videos you must pass replaceGenerated=true. If no project is open, it creates one named after the title and that project is then the one the user sees: say so first. The whole step can be undone with undo. Returns the same view as get_trailer, plus the cost and whether the script was written again or fixed by the app.',
    input: {
      text: z.string().trim().min(1).max(60_000).describe('The book text or story'),
      ...settingsInput,
      replaceGenerated: z
        .boolean()
        .default(false)
        .describe(
          'Set true to replace shots of the existing trailer script that already have generated pictures or videos',
        ),
    },
    hints: { readOnly: false, destructive: true },
    run: async ({ text, replaceGenerated, ...settings }) => {
      const check = await ctx.caller.call('trailer.check', { text })
      if (!check.ok) {
        throw new McpToolError(
          check.issue ?? 'A trailer script cannot be written right now.',
          'cannot_plan',
        )
      }
      if (check.generatedBeats > 0 && !replaceGenerated) {
        throw new McpToolError(
          `The existing trailer script has ${String(check.generatedBeats)} shot(s) with generated pictures or videos; writing it again replaces them (money already spent is not refunded). If that is what the user wants, set replaceGenerated to true.`,
          'would_replace_generated',
        )
      }
      const reserved = reserveSpending(ctx, 'Write the trailer script', check.estimatedUsd)
      const result = await ctx.caller.call('trailer.plan', { text, ...defined(settings) })
      return {
        ...(await describeTrailer(ctx)),
        wroteAgain: result.retried,
        fixedByTheApp: result.fixes,
        spending: { estimatedUsd: check.estimatedUsd, ...reserved },
      }
    },
  })

  defineTool(ctx, {
    name: 'get_trailer',
    title: 'Look at the trailer',
    description:
      "The trailer of the current project: its settings, every shot in order (beatKind video|still|card|title, durationSec, picture description, narration, card text, filmSeconds), the script total against the target (differenceSec: positive = too long, negative = too short), the length of the assembled film if there is one, and the checker's errors and warnings in plain words. exists=false means this is an ordinary project: call plan_trailer. For the length of the mixed sound use get_sound (totalSec).",
    input: {},
    hints: { readOnly: true },
    run: () => describeTrailer(ctx),
  })

  defineTool(ctx, {
    name: 'update_trailer',
    title: 'Change the trailer settings',
    description:
      "Change the trailer's settings (only the fields you pass): kind, targetSec, title, author, tagline, endLine, narration, music, musicMood, claims. Does NOT rewrite the script and costs nothing. With refit=true, when you changed targetSec the seconds of all shots are spread again to the new length (cards never go below their shortest hold time); without it the shots keep their seconds and get_trailer tells you how far off the total is. Changing the title or the end line changes what the title card shows. Undo with the undo tool.",
    input: {
      ...settingsInput,
      refit: z
        .boolean()
        .default(false)
        .describe('With a new targetSec: spread the seconds of the shots again to fit it'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ refit, ...patch }) => {
      await requireTrailer(ctx)
      await ctx.caller.call('trailer.update', { patch: defined(patch), refit })
      return describeTrailer(ctx)
    },
  })

  defineTool(ctx, {
    name: 'add_card',
    title: 'Add a text card',
    description:
      "Add a text card (a shot with only words on it; no picture is generated) right after a shot of the trailer. Keep the text short: at most 12 Chinese characters or 6 English words, the card stays on screen at least 0.8 s + 0.2 s per character unless you pass durationSec. Adding a card makes the film longer, so look at differenceSec in the result and shorten another shot (update_shot durationSec) or call update_trailer with refit=true. Words from blurbs, awards or sales figures must be the user's own (settings.claims). The title card is made by plan_trailer and is not added here. One undo step.",
    input: {
      afterShotId: z
        .string()
        .min(1)
        .describe('A shot id from get_trailer: the card goes right after it'),
      text: z.string().trim().min(1).max(100).describe('The words on the card'),
      subtext: z.string().trim().max(100).default('').describe('A smaller second line (optional)'),
      durationSec: z
        .number()
        .min(0.25)
        .max(15)
        .optional()
        .describe('Seconds on screen (default: the shortest hold time for this text)'),
    },
    hints: { readOnly: false },
    run: async ({ afterShotId, text, subtext, durationSec }) => {
      await requireTrailer(ctx)
      await ctx.caller.call('trailer.addCard', {
        afterShotId,
        text,
        subtext,
        ...(durationSec === undefined ? {} : { durationSec }),
      })
      return describeTrailer(ctx)
    },
  })

  defineTool(ctx, {
    name: 'set_shot_motion',
    title: 'Make a shot move or stand still',
    description:
      'Switch one picture shot of the trailer between a moving video (motion="moving": a video model makes it, costs more) and a still picture with a slow camera move made inside the app (motion="still": only the first-frame picture is generated, no video model; set the camera move with update_shot cameraMove). Text cards and the title card have no motion. Costs nothing by itself; generating is a separate step. Undo with the undo tool.',
    input: {
      shotId: z.string().min(1).describe('A shot id from get_trailer'),
      motion: z.enum(['moving', 'still']).describe('moving = video model; still = a still picture'),
    },
    hints: { readOnly: false, idempotent: true },
    run: async ({ shotId, motion }) => {
      const { shots } = await ctx.caller.call('shots.list', {})
      const shot = shots.find((s) => s.id === shotId)
      if (shot === undefined) throw new McpToolError('No shot has that id.', 'no_such_shot')
      const kind = shot.beatKind ?? 'video'
      if (kind === 'card' || kind === 'title') {
        throw new McpToolError(
          'A text card or the title card has no motion: it is made by the app and stays as it is.',
          'not_a_picture_shot',
        )
      }
      const updated = await ctx.caller.call('shots.update', {
        shotId,
        patch: { beatKind: motion === 'moving' ? 'video' : 'still' },
      })
      return beatView(updated)
    },
  })
}
