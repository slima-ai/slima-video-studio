import { z } from 'zod'

import { messageVariants, t } from '../i18n'

/** 大綱與分鏡表的復原／重做狀態。 */
export const HistoryStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  /** 按「復原」會復原的動作，例如「刪除這個場」。 */
  undoLabel: z.string().optional(),
  redoLabel: z.string().optional(),
  /** 還可以復原／重做幾步（上方列的按鈕旁顯示）。 */
  undoCount: z.number().int().nonnegative().optional(),
  redoCount: z.number().int().nonnegative().optional(),
})
export type HistoryState = z.infer<typeof HistoryStateSchema>

/** 復原或重做的結果：有沒有真的做了什麼（沒有可做的就是 false）、做的是哪個動作、之後的狀態。 */
export const HistoryResultSchema = z.object({
  applied: z.boolean(),
  label: z.string().optional(),
  state: HistoryStateSchema,
  /** 沒復原是因為 Claude 正在改、最上面那一步是它這一輪的：等它做完或按停止。 */
  blocked: z.literal('ai_running').optional(),
  /**
   * 這一步裡有些改動因為「後來又被改過」（現在的值已經不是這一步留下的值）或那一列已經不在而沒動：
   * `all`＝整步都沒動（按了看起來沒反應，要說一聲）；`some`＝動了一部分。
   */
  skipped: z.enum(['all', 'some']).optional(),
})
/** Claude 一輪的改動合成一步後，那一步在復原紀錄裡的名字（照開始那一刻的介面語言）。 */
export const aiTurnUndoLabel = (): string => t('history.aiTurn')

/** 這個名字是不是 Claude 那一輪的改動（任何語言都算：畫面用它認得「下一步會退回 Claude 那一輪」）。 */
export const isAiTurnLabel = (label: string | undefined): boolean =>
  label !== undefined && messageVariants('history.aiTurn').includes(label)

export type HistoryResult = z.infer<typeof HistoryResultSchema>

/**
 * 歷史有變動的事件。revision 每復原或重做一次就加一，
 * 畫面看到它變了就知道資料被改過、要重新載入；一般編輯只會更新 canUndo／canRedo。
 */
export const HistoryChangedSchema = HistoryStateSchema.extend({
  revision: z.number().int().nonnegative(),
})
export type HistoryChanged = z.infer<typeof HistoryChangedSchema>
