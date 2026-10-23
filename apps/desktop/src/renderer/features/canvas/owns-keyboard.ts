/**
 * 焦點在這些東西上時，按鍵是它們自己的：畫布的 Delete／Backspace／方向鍵不處理。
 * 輸入框與選單不用說；按鈕（按過暫停鈕之後按 Delete 不能刪卡）；影片本身（卡片上的影片被點過、
 * 或有控制列時焦點會停在它上面，按 Delete 同樣不能刪卡）。
 */
export function ownsKeyboard(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select, button, video, [role="menuitem"]') ||
      target.isContentEditable)
  )
}
