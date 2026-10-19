import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

/** 簡單的檔案 log（<userData>/logs/main.log），同時輸出到 console。 */
export function createLogger(logDir: string): Logger {
  mkdirSync(logDir, { recursive: true })
  const file = join(logDir, 'main.log')
  const write = (level: LogLevel, message: string): void => {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    appendFileSync(file, line)
    console[level === 'info' ? 'log' : level](line.trimEnd())
  }
  return {
    info: (m) => {
      write('info', m)
    },
    warn: (m) => {
      write('warn', m)
    },
    error: (m) => {
      write('error', m)
    },
  }
}
