import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from './fixtures'
import { launchApp } from './launch'

// 開機不閃的守門（#129 修的事）。開機不閃靠的是：視窗等 ready-to-show 才顯示（那時第一個畫面已經畫好），
// 而且那時 <html> 已經套好上次選的外觀（restoreTheme）。以後改了建窗時機（提早顯示）、或拿掉開機先套外觀，這裡就紅。
//
// 做法：用 `--require` 在主行程一開始就裝一支腳本，包住每個視窗的 show／showInactive：
// 「視窗第一次被叫去顯示」的那一刻，問畫面現在的底色（getComputedStyle(body)）與 <html data-theme>。
// 那一刻要同時滿足兩件事：① 不能比 ready-to-show 早；② 畫面的底色就是使用者第一眼看到的：
// - 上次選深色：必須已經是深色底（rgb(11, 11, 15)）；選淺色：必須已經是淺色底（rgb(245, 245, 248)，
//   視窗底色 #0b0b0f 不能露出來）；
// - 提早顯示的話，那時畫面還沒載入（透明底）或還沒套外觀，同樣會紅。
// 為什麼不直接看畫格：試過用 beginFrameSubscription 記每個畫格＋isVisible，但畫格是「送到的那一刻」才打上
// 看不看得到，吃緊時（整套並行）前一刻畫在背景裡的淺色畫格會晚幾百毫秒才送到、被誤算成看得到的，會時紅時綠。
const HOOK = `
const { app } = require('electron')
const shows = []
const pending = []
globalThis.__svsBoot = { shows, pending }
const t0 = Date.now()
app.on('browser-window-created', (_event, win) => {
  let first = true
  let readyToShowAt
  win.once('ready-to-show', () => {
    readyToShowAt = Date.now() - t0
  })
  for (const method of ['show', 'showInactive']) {
    const original = win[method].bind(win)
    win[method] = (...args) => {
      if (first) {
        first = false
        const at = Date.now() - t0
        pending.push(
          win.webContents
            .executeJavaScript(
              "({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, ready: document.readyState })",
            )
            .then((state) => shows.push({ method, at, readyToShowAt, ...state }))
            .catch((error) => shows.push({ method, at, readyToShowAt, error: String(error) })),
        )
      }
      return original(...args)
    }
  }
})
`

interface Shown {
  method: string
  at: number
  readyToShowAt?: number
  theme?: string | null
  bg?: string
  ready?: string
  error?: string
}

const DARK_BG = 'rgb(11, 11, 15)'
const LIGHT_BG = 'rgb(245, 245, 248)'

test.describe('開機時的第一個畫面不閃', () => {
  for (const [pref, expected] of [
    ['dark', DARK_BG],
    ['light', LIGHT_BG],
  ] as const) {
    test(`上次選${pref === 'dark' ? '深色' : '淺色'}：視窗第一次顯示時，畫面已經是${pref === 'dark' ? '深色' : '淺色'}底`, async ({
      userDataDir,
    }, testInfo) => {
      const dir = mkdtempSync(join(tmpdir(), 'svs-boot-hook-'))
      const hook = join(dir, 'hook.cjs')
      writeFileSync(hook, HOOK)
      try {
        // 第一次開：選好外觀（要走畫面：外面用 IPC 改設定，畫面的設定狀態不會跟著變，也就不會記下外觀），
        // 等畫面把它記下來（localStorage）再關
        const first = await launchApp({ userDataDir })
        const page1 = await first.app.firstWindow()
        await page1.waitForLoadState('domcontentloaded')
        await page1.getByRole('button', { name: '設定', exact: true }).click()
        await page1.getByTestId(`theme-${pref}`).locator('xpath=..').click()
        await expect
          .poll(() => page1.evaluate(() => window.localStorage.getItem('svs-theme')))
          .toBe(pref)
        await first.app.close()

        // 第二次開：用 --require 在一開始就裝好
        const second = await launchApp({ userDataDir, electronArgs: ['--require', hook] })
        try {
          const page2 = await second.app.firstWindow()
          await page2.waitForLoadState('domcontentloaded')
          await expect(page2.getByTestId('app-layout')).toBeVisible()
          const shows = await second.app.evaluate(async () => {
            const boot = (
              globalThis as unknown as {
                __svsBoot: { shows: Shown[]; pending: Promise<unknown>[] }
              }
            ).__svsBoot
            await Promise.all(boot.pending)
            return boot.shows
          })
          await testInfo.attach('first-show', {
            body: JSON.stringify(shows),
            contentType: 'application/json',
          })
          // 記錄真的有收到：視窗一定會被叫去顯示一次
          expect(shows, '沒有記到視窗第一次顯示（記錄壞了，不能當作沒閃）').toHaveLength(1)
          const [shown] = shows
          expect(shown?.error).toBeUndefined()
          // 不能比 ready-to-show 早顯示（那時第一個畫面還沒畫好）；executeJavaScript 會等到畫面載入完才執行，
          // 所以光看底色抓不到提早顯示，要比時間
          expect(
            shown?.readyToShowAt,
            `視窗在 ready-to-show 之前就被叫去顯示（${JSON.stringify(shown)}）`,
          ).toBeDefined()
          expect(shown?.at ?? 0).toBeGreaterThanOrEqual(shown?.readyToShowAt ?? Infinity)
          expect(shown?.bg, `視窗第一次顯示時的底色（${JSON.stringify(shown)}）`).toBe(expected)
          expect(shown?.theme).toBe(pref)
        } finally {
          await second.app.close().catch(() => undefined)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
