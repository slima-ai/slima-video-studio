import { isMac } from './history'

/** 「在資料夾裡顯示檔案」的按鈕字：macOS 叫 Finder，其他系統是檔案總管。 */
export const revealLabel = (): string => (isMac() ? '在 Finder 顯示' : '在檔案總管顯示')
