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
})
