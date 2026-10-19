import type { AppErrorShape, IpcChannel, IpcRequest, IpcResponse } from '@svs/schema'

/** 主行程回報的錯誤（訊息已經整理成給使用者看的白話）。 */
export class IpcCallError extends Error {
  constructor(readonly shape: AppErrorShape) {
    super(shape.userMessage)
    this.name = 'IpcCallError'
  }
}

/** 呼叫主行程；失敗時丟 IpcCallError，成功時直接回傳資料。 */
export async function call<C extends IpcChannel>(
  channel: C,
  payload: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const result = await window.svs.invoke(channel, payload)
  if (!result.ok) throw new IpcCallError(result.error)
  return result.data
}

/** 給畫面顯示的錯誤訊息。 */
export function errorText(error: unknown): string {
  return error instanceof IpcCallError ? error.message : '發生未預期的錯誤，請再試一次。'
}
