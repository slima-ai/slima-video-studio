import { t } from '@svs/schema'

/**
 * MCP 的說明與錯誤裡提到的「設定頁上的名字」：用使用者此刻看到的那一個（繁中或英文）。
 * MCP 伺服器每個 HTTP 請求建一次，所以說明與工具描述每次都用當下的語言；跟著介面語言換。
 */
const quoted = (text: string): string => t('mcp.quoted', { text })

/** 「設定 → 服務金鑰」：貼金鑰的地方。 */
export const settingsApiKeys = (): string => `${t('shell.settings')} → ${t('settings.apiKeys')}`
/** 「設定 → AI 工具連線」：允許 AI 工具連線、AI 工具的總額度在這裡。 */
export const settingsAiTools = (): string => `${t('shell.settings')} → ${t('settings.aiTools')}`
/** 「設定 → 一般」：示範模式的開關在這裡。 */
export const settingsGeneral = (): string => `${t('shell.settings')} → ${t('settings.general')}`
/** 「AI 工具的總額度」那張卡。 */
export const allowanceCard = (): string => quoted(t('mcp.allowanceCard'))
/** 「單次花費上限」那張卡（設定 → 一般）：只管單次生成，跟「AI 工具的總額度」是兩回事。 */
export const perRunLimitCard = (): string => quoted(t('settings.perRunSpendingLimit'))
/** 「已用的歸零」鈕。 */
export const resetUsedButton = (): string => quoted(t('settings.resetUsedAmount'))
/** 「示範模式」開關的名字。 */
export const demoModeName = (): string => t('settings.demoMode')
/** 「儲存」鈕。 */
export const saveButton = (): string => t('settings.save')
/** 「接成成品」鈕（英文介面是 “Join into film”）。 */
export const joinIntoFilmButton = (): string => quoted(t('canvas.joinIntoFilm'))
/** 畫布上的「剪輯」卡。 */
export const cutCard = (): string => quoted(t('canvas.cut'))
/** 「成品」（接好的整支片）。 */
export const filmName = (): string => quoted(t('canvas.film'))
