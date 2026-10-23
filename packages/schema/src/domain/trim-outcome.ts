import { z } from 'zod'

import { ShotViewSchema } from './shots'
import { TrimSchema } from './trim'

export const TrimAdjustmentSchema = z.discriminatedUnion('reason', [
  z.object({
    reason: z.literal('snapped'),
    field: z.enum(['inSec', 'outSec']),
    from: z.number(),
    to: z.number(),
  }),
  z.object({
    reason: z.literal('clamped'),
    field: z.literal('outSec'),
    from: z.number(),
    to: z.number(),
  }),
])

/** 設完裁切之後的結果：這一鏡現在在成品裡用哪一段、佔幾秒，以及哪些數字被改了。 */
export const TrimOutcomeSchema = z.object({
  shot: ShotViewSchema,
  /** 留下的裁切；整支（沒有裁）就沒有這個欄位。 */
  trim: TrimSchema.optional(),
  /** 在成品裡用到影片的哪一段（秒）。 */
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  /** 剪完在成品裡佔幾秒、幾格。 */
  lengthSec: z.number().positive(),
  frames: z.number().int().positive(),
  /** 影片實際長度（秒）與對齊用的幀率。 */
  videoSec: z.number().positive(),
  fps: z.number().positive(),
  adjustments: z.array(TrimAdjustmentSchema),
})
export type TrimOutcomeView = z.infer<typeof TrimOutcomeSchema>
