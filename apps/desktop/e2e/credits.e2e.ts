import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

import ffmpegPath from 'ffmpeg-static'

import { creditsHtml } from '../src/main/credits/render-card-electron'
import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 影片長度（秒）：解 ffmpeg 印出來的 Duration（打包版沒有 ffprobe）。 */
function durationOf(file: string): number {
  const result = spawnSync(ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  })
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(result.stderr)
  if (!match) throw new Error(`讀不到長度：${result.stderr.slice(-200)}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

test.describe('匯出的片尾字卡（示範模式、真的 Electron 離屏畫字卡）', () => {
  test('預設勾著標註：匯出的影片多 3 秒的字卡（最後一格是黑底白字、寫著產品）；取消勾選匯出沒有字卡的原版', async ({
    page,
    app,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await expect(page.getByTestId('final-cut-credits')).toBeChecked()

    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toContainText('已匯出到')
    const withCard = (await page.getByTestId('final-cut-exported').innerText())
      .replace(/^已匯出到\s*/, '')
      .trim()
    expect(existsSync(withCard)).toBe(true)
    expect(await page.getByTestId('final-cut-exported').innerText()).not.toContain('沒有加成功')

    // 取消勾選再匯出一次：原版
    await page.getByTestId('final-cut-credits').uncheck()
    await page.getByTestId('final-cut-export').click()
    await expect
      .poll(async () =>
        (await page.getByTestId('final-cut-exported').innerText()).includes(withCard),
      )
      .toBe(false)
    const plain = (await page.getByTestId('final-cut-exported').innerText())
      .replace(/^已匯出到\s*/, '')
      .trim()
    expect(existsSync(plain)).toBe(true)

    // 字卡版比原版長 3 秒
    expect(durationOf(withCard) - durationOf(plain)).toBeGreaterThan(2.5)
    expect(durationOf(withCard) - durationOf(plain)).toBeLessThan(3.6)

    // 抽字卡那幾秒的一格（距離結尾 1 秒）：存成截圖附在報告裡
    const frame = testInfo.outputPath('credits-card-frame.png')
    execFileSync(ffmpegPath ?? 'ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-sseof',
      '-1',
      '-i',
      withCard,
      '-frames:v',
      '1',
      frame,
    ])
    expect(existsSync(frame)).toBe(true)
    await testInfo.attach('credits-card-frame', { path: frame, contentType: 'image/png' })
    // 原版的最後一格不是字卡：兩張圖不一樣
    const plainFrame = testInfo.outputPath('plain-last-frame.png')
    execFileSync(ffmpegPath ?? 'ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-sseof',
      '-0.5',
      '-i',
      plain,
      '-frames:v',
      '1',
      plainFrame,
    ])
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(frame).equals(readFileSync(plainFrame))).toBe(false)

    // 示範模式的模型沒有標註，字卡上只有產品那一行。真實專案多行標註時的樣子：用同一份字卡 HTML、
    // 同樣的 Electron 離屏視窗畫一張（版面預覽，不是匯出檔的抽格）
    const html = creditsHtml(
      [
        'Video generated with Kling AI',
        'Images generated with GPT Image (OpenAI)',
        'Voice by MiniMax',
        'Music generated with Google Lyria',
        'Story and prompts assisted by Claude (Anthropic)',
        'Made with Slima Video Studio',
      ],
      720,
    )
    const base64 = await app.evaluate(async ({ BrowserWindow }, pageHtml) => {
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 720,
        useContentSize: true,
        frame: false,
        webPreferences: { offscreen: true, sandbox: true },
      })
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`)
        await new Promise((resolve) => setTimeout(resolve, 150))
        const image = await win.webContents.capturePage()
        return image.resize({ width: 1280, height: 720 }).toPNG().toString('base64')
      } finally {
        win.destroy()
      }
    }, html)
    writeFileSync(
      testInfo.outputPath('credits-card-layout-preview.png'),
      Buffer.from(base64, 'base64'),
    )
  })

  test('Playwright 驅動、測試行程被同步卡住時（新開的視窗不會載入）：畫字卡等太久就改匯出沒有字卡的版本，匯出不會被無限期卡住', async ({
    page,
  }) => {
    // 重現 10-20 助理驗收的卡住：Playwright 驅動的 App，測試行程同步等一個外部指令（例如 claude -p）時，
    // App 裡新開的視窗一直等不到載入，離屏畫字卡就永遠不會回來（測試行程放開那一刻才繼續）。沒有修正時 export 會一直等。
    test.setTimeout(120_000)
    await generateAndOpenCanvas(page)
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      w.__t0 = Date.now()
      void window.svs.invoke('quickstart.export', {}).then((result) => {
        w.__t1 = Date.now()
        w.__result = result
      })
    })
    // 測試行程同步卡住 30 秒（比字卡上限 20 秒久）
    execFileSync('sleep', ['30'])
    const outcome = await page.evaluate(() => {
      const w = window as unknown as {
        __t0: number
        __t1?: number
        __result?: { ok: boolean; data?: { path: string; credits: boolean } }
      }
      return { took: w.__t1 === undefined ? undefined : w.__t1 - w.__t0, result: w.__result }
    })
    // 卡住的條件沒有出現（這個環境新視窗照常載入）就沒什麼好驗的
    test.skip(outcome.took !== undefined && outcome.took < 10_000, '這個環境沒有卡住，無從驗證逾時')
    // 卡住了：測試行程放開的那一刻，匯出必須已經在上限內結束，改匯出沒有字卡的版本
    expect(outcome.took, '匯出在卡住期間就該照上限結束').toBeDefined()
    expect(outcome.took).toBeLessThan(26_000)
    expect(outcome.result?.ok).toBe(true)
    expect(outcome.result?.data?.credits).toBe(false)
    expect(existsSync(outcome.result?.data?.path ?? '')).toBe(true)
  })
})
