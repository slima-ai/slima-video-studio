// 關 App 逾時時，closeApp 要先把證據存成檔再強制結束（不開 Electron，用假的 app 和一個真的子行程）。
import type { ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeApp } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('關 App 逾時：先存證據再結束', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright 規定第一個參數要用解構
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

      expect(readFileSync(join(evidenceDir, 'main.log'), 'utf8')).toContain('LINE-ONE')
      const processes = readFileSync(join(evidenceDir, 'processes.txt'), 'utf8')
      expect(processes).toContain(String(main.pid))
      expect(processes).toContain('sleep 300')
      expect(readFileSync(join(evidenceDir, 'lsof.txt'), 'utf8').length).toBeGreaterThan(0)
      expect(readFileSync(join(evidenceDir, 'summary.txt'), 'utf8')).toContain(
        `pid: ${String(main.pid)}`,
      )
      await expect.poll(() => main.exitCode !== null || main.signalCode !== null).toBe(true)
    } finally {
      main.kill('SIGKILL')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
