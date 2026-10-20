import { spawn as nodeSpawn } from 'node:child_process'

import { createLineParser, signalsOf, type StreamSignal } from './stream-events'

/** 我們用得到的 child process 部分（測試用假的取代）。 */
export interface ChildLike {
  stdin: { write: (data: string) => unknown; end: () => unknown }
  stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown }
  stderr: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown }
  on: {
    (event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
    (event: 'error', listener: (error: Error) => void): unknown
  }
  kill: (signal?: NodeJS.Signals) => boolean
}

export type SpawnClaude = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
) => ChildLike

export const spawnClaudeDirect: SpawnClaude = (file, args, options) =>
  nodeSpawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

export interface ClaudeProcess {
  /** 送一則使用者訊息（stream-json 一行）。 */
  send: (text: string) => void
  /**
   * 中斷這一輪（停止鈕、Esc）：送 stream-json 的 control_request interrupt。
   * 實測：這一輪馬上結束（result 是 aborted_streaming）、行程還活著、下一則照常接著聊；
   * 用 SIGINT 的話行程會跟著退出，所以只當備案（見 `forceInterrupt`）。
   */
  interrupt: () => void
  /** 備案：對方沒回應 interrupt 時用 SIGINT（行程會退出，下一則改用 --resume 開新的）。 */
  forceInterrupt: () => void
  /** 關閉這個行程（SIGTERM）。 */
  close: () => void
  readonly exited: boolean
}

export interface ClaudeProcessOptions {
  spawn: SpawnClaude
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  onSignal: (signal: StreamSignal) => void
  /** 行程結束了（含自己崩潰）；stderr 只有最後一小段，給紀錄用，不顯示給使用者。 */
  onExit: (info: { code: number | null; signal: string | null; stderr: string }) => void
}

const STDERR_KEEP = 2000

export function startClaudeProcess(options: ClaudeProcessOptions): ClaudeProcess {
  let exited = false
  let stderr = ''
  let nextRequest = 1
  const child = options.spawn(options.file, options.args, { cwd: options.cwd, env: options.env })
  const parse = createLineParser((event) => {
    for (const signal of signalsOf(event)) options.onSignal(signal)
  })
  child.stdout.on('data', (chunk) => {
    parse(String(chunk))
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-STDERR_KEEP)
  })
  const finish = (code: number | null, signal: string | null): void => {
    if (exited) return
    exited = true
    options.onExit({ code, signal, stderr })
  }
  child.on('exit', finish)
  child.on('error', (error) => {
    stderr = `${stderr}${error.message}`.slice(-STDERR_KEEP)
    finish(null, null)
  })
  const write = (value: unknown): void => {
    if (exited) return
    child.stdin.write(`${JSON.stringify(value)}\n`)
  }
  return {
    send: (text) => {
      write({ type: 'user', message: { role: 'user', content: text } })
    },
    interrupt: () => {
      write({
        type: 'control_request',
        request_id: `interrupt-${String(nextRequest++)}`,
        request: { subtype: 'interrupt' },
      })
    },
    forceInterrupt: () => {
      if (!exited) child.kill('SIGINT')
    },
    close: () => {
      if (exited) return
      try {
        child.stdin.end()
      } catch {
        // 已經關了
      }
      child.kill('SIGTERM')
    },
    get exited() {
      return exited
    },
  }
}
