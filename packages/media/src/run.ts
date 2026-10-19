import { AppError } from '@svs/schema'
import { spawn } from 'node:child_process'

export interface MediaTools {
  /** ffmpeg 執行檔路徑。 */
  ffmpegPath: string
  /** ffprobe 執行檔路徑；null 代表沒有 ffprobe（打包版只內建 ffmpeg），改由 ffmpeg 讀影片資訊。 */
  ffprobePath: string | null
}

/**
 * 找 FFmpeg：環境變數 SVS_FFMPEG / SVS_FFPROBE 優先（SVS_FFPROBE=none 表示沒有 ffprobe，跟打包版一樣由 ffmpeg 讀影片資訊），其次是呼叫端給的路徑
 * （打包版由主行程傳入 ffmpeg-static 解出來的路徑），最後用系統 PATH 上的 ffmpeg / ffprobe。
 */
export function resolveTools(
  overrides: Partial<MediaTools> = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): MediaTools {
  return {
    ffmpegPath: env.SVS_FFMPEG ?? overrides.ffmpegPath ?? 'ffmpeg',
    // null 是有意義的值（明確表示沒有 ffprobe），所以不能用 ?? 蓋掉
    ffprobePath:
      env.SVS_FFPROBE === 'none'
        ? null
        : (env.SVS_FFPROBE ??
          (overrides.ffprobePath === undefined ? 'ffprobe' : overrides.ffprobePath)),
  }
}

export interface RunOptions {
  signal?: AbortSignal
}

const MAX_STDERR = 8000

export interface ToolResult {
  /** 結束碼（被訊號中止時是 null）。 */
  code: number | null
  stdout: string
  /** 只保留最後一段（避免輸出過長）。 */
  stderr: string
}

/** 執行指令（不經過 shell，參數是陣列），不論結束碼都回傳輸出。只有無法啟動或被取消才會失敗。 */
export function runToolRaw(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AppError({ code: 'cancelled', userMessage: '已取消。' }))
      return
    }
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') {
        reject(new AppError({ code: 'cancelled', userMessage: '已取消。' }))
      } else if (error.code === 'ENOENT') {
        reject(
          new AppError({
            code: 'internal_error',
            userMessage: '找不到影片處理工具（FFmpeg），請重新安裝 App。',
            cause: error,
          }),
        )
      } else {
        reject(
          new AppError({
            code: 'internal_error',
            userMessage: '影片處理工具無法啟動。',
            cause: error,
          }),
        )
      }
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

/** 執行指令（不經過 shell，參數是陣列），成功回傳 stdout。失敗丟 AppError，原始訊息只放在 cause。 */
export async function runTool(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  const { code, stdout, stderr } = await runToolRaw(command, args, options)
  if (code === 0) return stdout
  throw new AppError({
    code: 'internal_error',
    userMessage: '影片處理失敗，檔案可能損毀或格式不支援。',
    cause: new Error(`${command} 結束碼 ${String(code)}：${stderr}`),
  })
}
