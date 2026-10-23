import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { installCrashGuards, runShutdown } from './crash-guard'

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('installCrashGuards', () => {
  it('沒接住的錯誤與被拒的 Promise 都寫進 log（含堆疊），不往外丟', () => {
    const target = new EventEmitter()
    const log = logger()
    installCrashGuards(target, log)
    target.emit('uncaughtException', new Error('資料庫已經關了'))
    target.emit('unhandledRejection', '逾時')
    expect(log.error).toHaveBeenCalledTimes(2)
    expect(log.error.mock.calls[0]?.[0]).toContain('資料庫已經關了')
    expect(log.error.mock.calls[0]?.[0]).toContain('crash-guard.test.ts')
    expect(log.error.mock.calls[1]?.[0]).toBe(
      'Unhandled promise rejection in the main process: 逾時',
    )
  })
})

describe('runShutdown', () => {
  it('一步同步丟錯：寫 log，後面的步驟照做', () => {
    const log = logger()
    const later = vi.fn()
    runShutdown(
      [
        [
          'stop the job queue',
          () => {
            throw new Error('佇列卡住')
          },
        ],
        ['close the project', later],
      ],
      log,
    )
    expect(later).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to stop the job queue while quitting'),
    )
  })

  it('一步回傳被拒的 Promise：不等它、不往外丟，失敗寫進 log', async () => {
    const log = logger()
    const later = vi.fn()
    runShutdown(
      [
        ['disconnect Slima', () => Promise.reject(new Error('子行程沒回應'))],
        ['close the project', later],
      ],
      log,
    )
    expect(later).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('子行程沒回應'))
    })
  })
})
