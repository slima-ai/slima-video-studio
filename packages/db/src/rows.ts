/**
 * SQLite 的 NULL 讀出來是 null，但領域 schema 的選填欄位用 undefined 表示「沒有」，
 * 所以交給 Zod 驗證之前先把 null 欄位拿掉。
 */
export function dropNulls<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as T
}
