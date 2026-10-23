import type { UserHistoryOp } from '../history/history-service'

/** 一步的說明：Claude 一輪寫成「<名稱> (<各個編輯>)」，使用者自己的一步就是名稱。 */
function describeStep(op: UserHistoryOp): string {
  return op.details.length === 0 ? op.label : `${op.label} (${op.details.join(', ')})`
}

/**
 * 使用者在兩句話之間按過復原或重做：整理成一段短說明，附在下一句話後面送給 Claude（畫面上不顯示）。
 * 內容來自復原歷史的名稱，不是畫面上的字。沒有按過就回傳 undefined（什麼都不附）。
 * 這段話是寫給 Claude 看的、畫面上不顯示，所以固定用英文（Claude 的系統提示也是英文，它叫 Claude 用使用者的語言回答）。
 * 名稱本身（復原歷史的標籤）目前還是中文，等歷史標籤轉成 t() 之後會跟著介面語言。
 *
 * 要寫清楚的是「最後的狀態」，不是按了幾下：復原後又重做＝最後跟沒按一樣；復原兩步又重做一步＝還有一步是退掉的。
 * 重做永遠是把「最近被復原的那一步」套回來，所以用堆疊算：復原就放進去、重做就拿掉最上面一個
 * （堆疊空了還重做，代表重做的是這段時間之前就被復原的步驟）。
 */
export function describeHistoryNote(ops: readonly UserHistoryOp[]): string | undefined {
  if (ops.length === 0) return undefined
  const undone: string[] = []
  const restored: string[] = []
  for (const op of ops) {
    const step = describeStep(op)
    if (op.direction === 'undo') undone.push(step)
    else if (undone.length > 0) undone.pop()
    else restored.push(step)
  }
  const parts: string[] = []
  if (undone.length > 0) {
    parts.push(
      `Undone: ${undone.join('; ')}. These are gone now — that was the user's decision, so don't put them back; ask first if you're not sure`,
    )
  }
  if (restored.length > 0) {
    parts.push(`Re-applied: ${restored.join('; ')}. These are back now`)
  }
  if (parts.length === 0) {
    return '(App note: since the last message, the user pressed Undo and then Redo in the app. The final state is the same as before — nothing changed.)'
  }
  return `(App note: since the last message, the user pressed Undo/Redo in the app. The final state is — ${parts.join('; also ')}.)`
}
