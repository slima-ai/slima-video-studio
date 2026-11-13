import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import ffmpegPath from 'ffmpeg-static'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 截圖：存到測試自己的路徑；有 SVS_SCREENSHOT_DIR 時用指定的名字多存一份。 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, name))
  }
}

/** 讓主行程的選檔視窗直接回傳這些檔案（不用真的跳視窗）；空陣列＝使用者取消。 */
async function pickReturns(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: files.length === 0, filePaths: files })
  }, paths)
}

/** 用 ffmpeg 做一首 N 秒的測試音樂（正弦波 mp3）。 */
function makeMusic(file: string, seconds: number): void {
  const result = spawnSync(
    ffmpegPath ?? 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=330:duration=${String(seconds)}`,
      file,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(`做不出測試音樂：${result.stderr}`)
}

/** ffmpeg 印出來的資訊：長度（秒）與有沒有音訊（打包版沒有 ffprobe）。 */
function infoOf(file: string): { durationSec: number; hasAudio: boolean } {
  const result = spawnSync(ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  })
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(result.stderr)
  if (!match) throw new Error(`讀不到長度：${result.stderr.slice(-200)}`)
  return {
    durationSec: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]),
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(result.stderr),
  }
}

const soundOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

const openCutPanel = async (page: Page): Promise<void> => {
  await centerOn(page, 'cut')
  await page.getByTestId('open-cut').click()
  await expect(page.getByTestId('final-cut-panel')).toBeVisible()
  await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
}

const HAN_OR_FULLWIDTH = /[㐀-鿿，。：；（）、！？「」・]/u

test.describe('成品的聲音：用我自己的音樂（示範模式）', () => {
  test.describe.configure({ timeout: 180_000 })

  test('選一首比片子長的 mp3：直接當配樂（花費 0、標自己的檔案）、時間軸有檔名、自動重混、匯出長度不變且有聲音；復原就拿掉', async ({
    app,
    page,
    projectDir,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    await openCutPanel(page)
    const before = await soundOf(page)
    expect(before.music).toBeUndefined()
    const film = before.totalSec

    const file = join(projectDir, '我的歌.mp3')
    makeMusic(file, 60)
    await pickReturns(app, [file])
    await expect(page.getByTestId('sound-import-music')).toBeVisible()
    await shoot(page, testInfo, 'sound-import-01-before.png')
    await page.getByTestId('sound-import-music').click()

    await expect(page.getByTestId('sound-music-own')).toHaveText('我的歌.mp3')
    await expect(page.getByTestId('timeline-music-name')).toHaveText('我的歌.mp3')
    const after = await soundOf(page)
    expect(after.music?.source).toBe('imported')
    expect(after.music?.modelId).toBe('user-file')
    expect(after.music?.costUsd).toBe(0)
    expect(after.music?.text).toBe('我的歌.mp3')
    // 配樂條畫到片尾為止，不會超出時間軸
    const lane = await page.getByTestId('timeline-music').boundingBox()
    const bar = await page.getByTestId('timeline-music').evaluate((el) => {
      const parent = el.parentElement?.getBoundingClientRect()
      const own = el.getBoundingClientRect()
      return { right: own.right, parentRight: parent?.right ?? 0 }
    })
    expect(lane).not.toBeNull()
    expect(bar.right).toBeLessThanOrEqual(bar.parentRight + 1)
    await page.getByTestId('timeline-music').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, 'sound-import-02-imported.png')

    // 自動重混：成品變成有聲音、不是過期
    await expect
      .poll(async () => (await soundOf(page)).final?.soundStale, { timeout: 60_000 })
      .toBe(false)
    expect((await soundOf(page)).final?.hasSound).toBe(true)

    // 匯出（不加片尾字卡）：長度跟片子一樣（60 秒的音樂被切在片尾），而且有音訊
    await page.getByTestId('final-cut-credits').uncheck()
    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toContainText('已匯出到')
    const exported = (await page.getByTestId('final-cut-exported').innerText())
      .replace(/^已匯出到\s*/, '')
      .trim()
    expect(existsSync(exported)).toBe(true)
    const info = infoOf(exported)
    expect(info.hasAudio).toBe(true)
    expect(Math.abs(info.durationSec - film)).toBeLessThan(0.5)

    // 復原：配樂拿掉，成品重混回沒有聲音
    const undone = await page.evaluate(() => window.svs.invoke('history.undo', {}))
    expect(undone.ok && undone.data.applied).toBe(true)
    await expect.poll(async () => (await soundOf(page)).music, { timeout: 30_000 }).toBeUndefined()
    await expect(page.getByTestId('sound-music-own')).toHaveCount(0)
    await shoot(page, testInfo, 'sound-import-03-undone.png')
  })

  test('取消選檔什麼都不發生；選了不能用的檔案顯示白話錯誤，專案沒有被改', async ({
    app,
    page,
    projectDir,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    await openCutPanel(page)

    await pickReturns(app, [])
    await page.getByTestId('sound-import-music').click()
    await expect(page.getByTestId('sound-import-music')).toBeEnabled()
    await expect(page.getByTestId('toast')).toHaveCount(0)
    await expect(page.getByTestId('sound-error')).toHaveCount(0)
    expect((await soundOf(page)).music).toBeUndefined()

    const txt = join(projectDir, '歌詞.txt')
    writeFileSync(txt, '不是音樂')
    await pickReturns(app, [txt])
    await page.getByTestId('sound-import-music').click()
    await expect(page.getByTestId('sound-error')).toContainText('請選 mp3、wav 或 m4a')
    await page.getByTestId('sound-error').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, 'sound-import-04-unsupported.png')

    const fake = join(projectDir, '壞掉的歌.mp3')
    writeFileSync(fake, '這不是真的 mp3')
    await pickReturns(app, [fake])
    await page.getByTestId('sound-import-music').click()
    await expect(page.getByTestId('sound-error')).toContainText('不是音訊')
    expect((await soundOf(page)).music).toBeUndefined()
  })

  test.describe('英文介面', () => {
    test.use({ appEnv: { SVS_LOCALE: 'en' } })

    test('按鈕、檔案標示、提示都是英文；390 寬按鈕也完整露出', async ({
      app,
      page,
      projectDir,
    }, testInfo) => {
      await page.getByRole('button', { name: 'Canvas', exact: true }).click()
      await expect(page.getByTestId('canvas-root')).toBeVisible()
      await generateAndOpenCanvasEn(page)
      await openCutPanel(page)
      const file = join(projectDir, 'my-song.mp3')
      makeMusic(file, 20)
      await pickReturns(app, [file])
      await expect(page.getByTestId('sound-import-music')).toContainText('Use my own music')
      await page.getByTestId('sound-import-music').click()
      await expect(page.getByTestId('sound-music-own')).toHaveText('my-song.mp3')
      const text = await page.getByTestId('sound-panel').innerText()
      expect(HAN_OR_FULLWIDTH.test(text)).toBe(false)
      await shoot(page, testInfo, 'sound-import-05-english.png')

      await page.setViewportSize({ width: 390, height: 844 })
      const button = page.getByTestId('sound-import-music')
      await button.scrollIntoViewIfNeeded()
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(390)
      await shoot(page, testInfo, 'sound-import-06-narrow-390.png')
    })
  })
})

/** 英文介面的生成：沿用中文版 helper 的流程，但按鈕名稱是英文，所以直接用 testId。 */
async function generateAndOpenCanvasEn(page: Page): Promise<void> {
  const empty = page.getByTestId('empty-add-oneliner')
  if (await empty.isVisible()) await empty.click()
  else await page.getByTestId('palette-oneliner').click()
  await page.getByTestId('oneliner-story').fill('A cat finds a warm home on a rainy night')
  await page.getByTestId('oneliner-story').blur()
  for (const key of ['native', 'narration', 'music']) {
    await page.getByTestId(`oneliner-sound-${key}`).uncheck()
  }
  await page.getByTestId('oneliner-generate').click()
  await page.getByTestId('run-confirm-ok').click()
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
    timeout: 60_000,
  })
}
