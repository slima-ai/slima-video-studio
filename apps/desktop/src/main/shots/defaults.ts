import { messageVariants, t } from '@svs/schema'

/** 新增鏡頭時預設寫的描述（照新增那一刻的介面語言）；還是這句話就表示使用者（或 AI）還沒寫內容，算「空的鏡頭」。 */
export const newShotDescription = (): string => t('shots.newShot')

/** 這句描述是不是預設的（換過介面語言之後新增的、舊的都算）。 */
export const isNewShotDescription = (text: string | undefined): boolean =>
  text !== undefined && messageVariants('shots.newShot').includes(text)
