/* global window, document */
// 錄影腳本共用：啟動 App、在畫面外用一句話生成一支示範影片、注入假游標、用 Xvfb 螢幕錄影。
// 用法見各個 *-record.mjs（xvfb-run -a -s "-screen 0 1440x900x24" node scripts/xxx-record.mjs <輸出資料夾>）；
// 需要先建置過（out/ 存在）。Playwright 錄影不會畫出游標，所以注入一個假游標。
import { _electron as electron } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

export const W = 1440
export const H = 900

/**
 * 啟動 App，準備好一個有場與鏡頭的專案，停在設定頁（錄影從點「畫布」開始）。
 * seed 設成 false 就不先生成內容（錄空畫布開始的流程用）；settings 是啟動前先寫進設定檔的內容。
 */
export async function prepare(outDir, { seed = true, settings } = {}) {
  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'svs-record-'))
  if (settings) {
    mkdirSync(join(tmp, 'ud'), { recursive: true })
    writeFileSync(join(tmp, 'ud', 'settings.json'), JSON.stringify(settings))
  }
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [join(here, '..'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      SVS_PROVIDER_MODE: 'mock',
      SVS_TEST_VAULT: 'memory',
      SVS_USER_DATA: join(tmp, 'ud'),
      SVS_DISABLE_ONBOARDING: '1',
      SVS_PROJECTS_DIR: join(tmp, 'projects'),
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: size.w, height: size.h })
    },
    { w: W, h: H },
  )

  if (seed) {
    // 畫面外準備：在畫布上用一句話生成一支示範短片（一個場、幾個鏡頭與剪輯）
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await page.getByTestId('oneliner-generate').click()
    await page.getByTestId('run-confirm-ok').click()
    await page.waitForSelector('[data-testid="canvas-root"][data-growing="true"]')
    await page.waitForSelector('[data-testid="canvas-root"][data-growing="false"]', {
      timeout: 120_000,
    })
  }
  await page.evaluate(() => {
    const dot = document.createElement('div')
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(255,255,255,.9);border:2px solid #111;z-index:99999;pointer-events:none;' +
      'transition:transform .08s'
    document.body.appendChild(dot)
    // 用 pointer 事件：拖移時 React Flow（d3-drag）會攔下 mousemove，假游標會停在原地
    window.addEventListener('pointermove', (e) => {
      dot.style.left = `${e.clientX}px`
      dot.style.top = `${e.clientY}px`
    })
    window.addEventListener('pointerdown', () => {
      dot.style.transform = 'scale(1.5)'
      dot.style.background = 'rgba(255,200,0,.9)'
    })
    window.addEventListener('pointerup', () => {
      dot.style.transform = 'scale(1)'
      dot.style.background = 'rgba(255,255,255,.9)'
    })
  })
  // 先離開首頁（錄影從點「畫布」開始）
  await page.getByRole('button', { name: '設定', exact: true }).click()

  const pause = (ms) => page.waitForTimeout(ms)
  const centerOf = async (locator) => {
    const b = await locator.boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  /** 游標慢慢移過去再點。 */
  const clickAt = async (locator) => {
    const point = await centerOf(locator)
    await page.mouse.move(point.x, point.y, { steps: 20 })
    await pause(300)
    await page.mouse.click(point.x, point.y)
  }

  /** 開始用 Xvfb 螢幕錄影；回傳結束錄影的函式（會關掉 App）。 */
  const record = async (fileName) => {
    const outFile = join(outDir, fileName)
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'x11grab',
        '-framerate',
        '25',
        '-video_size',
        `${W}x${H}`,
        '-i',
        `${process.env.DISPLAY}.0`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        outFile,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    await pause(1000)
    return async () => {
      await app.close()
      ffmpeg.stdin.write('q')
      await new Promise((resolve) => ffmpeg.on('close', resolve))
      console.log(outFile)
    }
  }

  return { app, page, pause, centerOf, clickAt, record }
}
