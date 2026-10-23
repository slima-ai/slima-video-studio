import { z } from 'zod'

/** 一支影片版本在成品裡只用哪一段（秒）。沒有的那端就是「頭」或「尾」。 */
export const TrimSchema = z.object({
  inSec: z.number().nonnegative().optional(),
  outSec: z.number().positive().optional(),
})
export type Trim = z.infer<typeof TrimSchema>

/** 使用者／AI 要改的裁切：沒給的那端不動，clear 回整支。 */
export const TrimEditSchema = z.object({
  inSec: z.number().nonnegative().optional(),
  outSec: z.number().positive().optional(),
  clear: z.boolean().optional(),
})
export type TrimEdit = z.infer<typeof TrimEditSchema>

/** 算裁切時「改了使用者打的數字」的原因，畫面與 MCP 都要寫出來，不能悄悄改。 */
export type TrimAdjustment =
  | { field: 'inSec' | 'outSec'; reason: 'snapped'; from: number; to: number }
  | { field: 'outSec'; reason: 'clamped'; from: number; to: number }

export type TrimResult =
  | {
      ok: true
      /** 要存的裁切；整支（兩端都沒裁）就是 undefined。 */
      trim: Trim | undefined
      /** 在成品裡用到影片的哪一段。 */
      startSec: number
      endSec: number
      /** 剪完在成品裡佔幾秒。 */
      lengthSec: number
      /** 剪完是幾格（輸出幀率）。 */
      frames: number
      adjustments: TrimAdjustment[]
    }
  | { ok: false; reason: 'empty' | 'inverted'; startSec: number; endSec: number }

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** 對齊到輸出幀率的格線（每段長度因此是整數格，接起來不累積誤差）。 */
export const snapToFrame = (sec: number, fps: number): number => round6(Math.round(sec * fps) / fps)

/** 一段裁切在成品裡的長度（秒）；沒裁就是整支。 */
export const trimmedLengthSec = (trim: Trim | undefined, fullSec: number): number =>
  Math.max(0, (trim?.outSec ?? fullSec) - (trim?.inSec ?? 0))

/**
 * 把使用者要的入點／出點整理成能存的裁切：
 * 沒給的那端沿用目前的；出點超過影片長度就夾到影片長度；兩端都對齊到格線；
 * 剛好在頭（0）或尾（影片長度）的那端不存；兩端都不存就是整支。
 * 入點要小於出點，剪完至少一格，否則回 ok:false（不存）。
 */
export function resolveTrim(input: {
  current: Trim | undefined
  edit: TrimEdit
  /** 影片實際長度（秒）。 */
  durationSec: number
  /** 輸出幀率（格／秒）。 */
  fps: number
}): TrimResult {
  const { current, edit, durationSec, fps } = input
  const adjustments: TrimAdjustment[] = []
  const fullEnd = snapToFrame(durationSec, fps)

  const wantIn = edit.clear === true ? 0 : (edit.inSec ?? current?.inSec ?? 0)
  let wantOut = edit.clear === true ? durationSec : (edit.outSec ?? current?.outSec ?? durationSec)
  if (wantOut > durationSec) {
    adjustments.push({
      field: 'outSec',
      reason: 'clamped',
      from: round6(wantOut),
      to: round6(durationSec),
    })
    wantOut = durationSec
  }
  const inSec = snapToFrame(wantIn, fps)
  const outSec = Math.min(snapToFrame(wantOut, fps), fullEnd)
  // 使用者打的數字被格線改掉了（夾到影片長度的另外記，不重複寫）
  if (Math.abs(inSec - wantIn) > 1e-6) {
    adjustments.push({ field: 'inSec', reason: 'snapped', from: round6(wantIn), to: inSec })
  }
  const clamped = adjustments.some((a) => a.field === 'outSec' && a.reason === 'clamped')
  if (!clamped && Math.abs(outSec - wantOut) > 1e-6) {
    adjustments.push({ field: 'outSec', reason: 'snapped', from: round6(wantOut), to: outSec })
  }
  if (outSec <= inSec) return { ok: false, reason: 'inverted', startSec: inSec, endSec: outSec }
  const frames = Math.round((outSec - inSec) * fps)
  if (frames < 1) return { ok: false, reason: 'empty', startSec: inSec, endSec: outSec }
  const keepIn = inSec > 1e-6
  const keepOut = outSec < fullEnd - 1e-6
  const trim: Trim | undefined =
    keepIn || keepOut ? { ...(keepIn ? { inSec } : {}), ...(keepOut ? { outSec } : {}) } : undefined
  return {
    ok: true,
    trim,
    startSec: inSec,
    endSec: outSec,
    lengthSec: round6(outSec - inSec),
    frames,
    adjustments,
  }
}

/** 各鏡裁切的指紋（接片當下記著，之後裁切變了就知道成品過期）；一鏡都沒裁就是 undefined。 */
export function trimKeyOf(
  takes: readonly { id: string; trim: Trim | undefined }[],
): string | undefined {
  const parts = takes.flatMap(({ id, trim }) =>
    id !== '' && trim !== undefined ? [[id, trim.inSec ?? 0, trim.outSec ?? null]] : [],
  )
  return parts.length === 0 ? undefined : JSON.stringify(parts)
}
