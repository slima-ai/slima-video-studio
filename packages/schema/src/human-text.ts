const CJK = /[㐀-鿿]/

/**
 * Prompt 裡給人看的那一段：中文描述後面接的是畫風、運鏡的英文關鍵字（給模型看的），
 * 清單上只留第一個句號之前的中文描述，不要中英混雜。整段都是英文（使用者自己寫的）就原樣顯示。
 */
export function humanPart(text: string): string {
  const head = text.split('。')[0] ?? text
  return CJK.test(head) && head.trim() !== '' ? head : text
}
