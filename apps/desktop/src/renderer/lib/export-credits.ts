const KEY = 'svs.export.credits'

/** 匯出時要不要在片尾加「用了哪些 AI 服務」的字卡：預設要（建議），使用者取消後記住。 */
export function creditsPreferred(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setCreditsPreferred(value: boolean): void {
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    // 瀏覽器儲存空間不能用時（隱私模式等）只是不記住，不影響匯出
  }
}
