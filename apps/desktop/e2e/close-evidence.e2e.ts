/* eslint-disable no-empty-pattern -- Playwright 規定測試的第一個參數要用解構 */
// 關 App 逾時時，closeApp 要先把證據存成檔再強制結束（不開 Electron，用假的 app 和一個真的子行程）。
import type { ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeApp } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('關 App 逾時：先存證據再結束', () => {
  test('main.log、行程樹（含子行程）、lsof 都存成檔，行程之後被結束', async ({}, testInfo) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'svs-e2e-close-evidence-'))
    mkdirSync(join(userDataDir, 'logs'), { recursive: true })
    writeFileSync(
      join(userDataDir, 'logs', 'main.log'),
      'LINE-ONE\nQuitting: all windows are closed\n',
    )
    // 假的「主行程」：一個 shell，底下有個子行程
    const main = spawn('/bin/sh', ['-c', 'sleep 300 & wait'], { stdio: 'ignore' })
    const evidenceDir = join(userDataDir, 'evidence')
    const fakeApp = {
      close: () => new Promise<void>(() => undefined),
      process: () => main,
    } as unknown as ElectronApplication
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await expect(
        closeApp(fakeApp, userDataDir, testInfo, { timeoutMs: 300, evidenceDir }),
      ).rejects.toThrow('關不掉')

      expect(readFileSync(join(evidenceDir, 'timeout', 'main.log'), 'utf8')).toContain('LINE-ONE')
      const processes = readFileSync(join(evidenceDir, 'timeout', 'processes.txt'), 'utf8')
      expect(processes).toContain(String(main.pid))
      expect(processes).toContain('sleep 300')
      expect(readFileSync(join(evidenceDir, 'timeout', 'lsof.txt'), 'utf8').length).toBeGreaterThan(
        0,
      )
      expect(readFileSync(join(evidenceDir, 'timeout', 'summary.txt'), 'utf8')).toContain(
        `pid: ${String(main.pid)}`,
      )
      await expect.poll(() => main.exitCode !== null || main.signalCode !== null).toBe(true)
    } finally {
      main.kill('SIGKILL')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('偏慢（超過門檻）但有退出：存證據、不丟錯、不強制結束', async ({}, testInfo) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'svs-e2e-close-slow-'))
    mkdirSync(join(userDataDir, 'logs'), { recursive: true })
    writeFileSync(join(userDataDir, 'logs', 'main.log'), 'SLOW-LINE\n')
    const main = spawn('/bin/sh', ['-c', 'sleep 300 & wait'], { stdio: 'ignore' })
    const evidenceDir = join(userDataDir, 'evidence')
    const fakeApp = {
      // 700 毫秒後才「退出」：門檻 200 毫秒、逾時 5 秒
      close: () => new Promise<void>((resolve) => setTimeout(resolve, 700)),
      process: () => main,
    } as unknown as ElectronApplication
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await closeApp(fakeApp, userDataDir, testInfo, { slowMs: 200, timeoutMs: 5_000, evidenceDir })

      const slowDir = join(evidenceDir, 'slow')
      expect(readFileSync(join(slowDir, 'main.log'), 'utf8')).toContain('SLOW-LINE')
      expect(readFileSync(join(slowDir, 'processes.txt'), 'utf8')).toContain('sleep 300')
      expect(readFileSync(join(slowDir, 'lsof.txt'), 'utf8').length).toBeGreaterThan(0)
      // 偏慢時不取 sample（會干擾還在退出的行程）
      expect(existsSync(join(slowDir, 'sample-main.txt'))).toBe(false)
      expect(main.exitCode === null && main.signalCode === null).toBe(true)
    } finally {
      main.kill('SIGKILL')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('很快退出：不存任何證據', async ({}, testInfo) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'svs-e2e-close-fast-'))
    const evidenceDir = join(userDataDir, 'evidence')
    const fakeApp = {
      close: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
      process: () => ({ pid: undefined }),
    } as unknown as ElectronApplication
    try {
      await closeApp(fakeApp, userDataDir, testInfo, { slowMs: 500, timeoutMs: 5_000, evidenceDir })
      expect(existsSync(evidenceDir)).toBe(false)
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('偏慢之後又逾時：兩份證據放不同資料夾，呼叫堆疊只在逾時那次取', async ({}, testInfo) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'svs-e2e-close-both-'))
    const main = spawn('/bin/sh', ['-c', 'sleep 300 & wait'], { stdio: 'ignore' })
    const evidenceDir = join(userDataDir, 'evidence')
    const fakeApp = {
      close: () => new Promise<void>(() => undefined),
      process: () => main,
    } as unknown as ElectronApplication
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await expect(
        closeApp(fakeApp, userDataDir, testInfo, { slowMs: 200, timeoutMs: 3_000, evidenceDir }),
      ).rejects.toThrow('關不掉')

      expect(existsSync(join(evidenceDir, 'slow', 'lsof.txt'))).toBe(true)
      expect(existsSync(join(evidenceDir, 'timeout', 'lsof.txt'))).toBe(true)
      expect(existsSync(join(evidenceDir, 'slow', 'sample-main.txt'))).toBe(false)
      if (process.platform === 'darwin') {
        expect(existsSync(join(evidenceDir, 'timeout', 'sample-main.txt'))).toBe(true)
      }
      // 行程表要有 nice 值（這次要查的就是測試行程是不是被降了優先權）
      expect(readFileSync(join(evidenceDir, 'timeout', 'processes.txt'), 'utf8')).toContain(' ni ')
    } finally {
      main.kill('SIGKILL')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
