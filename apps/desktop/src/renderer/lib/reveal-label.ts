import { isMac } from './history'
import { t } from '@svs/schema'

/** 「在資料夾裡顯示檔案」的按鈕字：macOS 叫 Finder，其他系統是檔案總管。 */
export const revealLabel = (): string =>
  isMac() ? t('shell.showInFinder') : t('shell.showInFileExplorer')
