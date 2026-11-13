import type { Page, TestInfo } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

/** 一句 54 個字的台詞：示範配音一個字約 0.08 秒，念 4.3 秒，放不進 3 秒的鏡頭。 */
const LONG_LINE =
  '黑藤爬滿了斷橋，她一個人守著最後一盞燈，直到有人敲門，門外的人說他來自河的另一邊，帶著一封沒有人敢拆開的信。'

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

const soundOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

test.describe('聲音跟著格子：旁白貼合、配樂照腳本（示範模式）', () => {
  test.describe.configure({ timeout: 240_000 })

  test('旁白放不進 3 秒的鏡頭：念完自動改短、重念，提示寫「第 1 格旁白已改短」，台詞跟著換，時間軸上不超出格子', async ({
    page,
  }, testInfo) => {
    await generateAndOpenCanvas(page)
    const shots = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!shots.ok) throw new Error(shots.error.userMessage)
    const first = shots.data.shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const written = await page.evaluate(
      ({ shotId, line }) =>
        window.svs.invoke('shots.update', { shotId, patch: { dialogue: line } }),
      { shotId: first.id, line: LONG_LINE },
    )
    if (!written.ok) throw new Error(written.error.userMessage)

    await page.getByTestId('palette-close').click()
    await centerOn(page, `shot:${first.id}`)
    await page.getByTestId(`open-shot:${first.id}`).click()
    await expect(page.getByTestId('shot-panel')).toBeVisible()
    await page.getByTestId('shot-sound').scrollIntoViewIfNeeded()
    await page.getByTestId('shot-sound-narrate').click()
    await expect(page.getByTestId('shot-sound-confirm')).toBeVisible()
    // 預估寫成範圍「約 US$a～b」（旁白可能改短重念），沒有括號說明
    await expect(page.getByTestId('shot-sound-confirm')).toContainText(/約 US\$[\d.]+～[\d.]+/)
    await expect(page.getByTestId('shot-sound-confirm')).not.toContainText('改短')
    await shoot(page, testInfo, 'fit-01-confirm-range.png')
    await page.getByTestId('shot-sound-go').click()

    // 提示：第幾格、改成哪一句
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('第 1 格旁白已改短')
    await shoot(page, testInfo, 'fit-02-shortened-toast.png')

    // 台詞換成改短的那句（比原句短、是原句的開頭），旁白念的就是它；新版本是第 2 版
    const state = await soundOf(page)
    const view = state.shots[0]
    expect(view?.dialogue.length).toBeLessThan(LONG_LINE.length)
    expect(LONG_LINE.startsWith((view?.dialogue ?? '').replace(/。$/, ''))).toBe(true)
    expect(view?.narration).toMatchObject({ version: 2, text: view?.dialogue })
    // 放得進格子：旁白結束時間沒超出這一格太多，也沒有「旁白太長」的警告
    expect(state.warnings.map((w) => w.kind)).not.toContain('narration_too_long')
    expect(state.warnings.map((w) => w.kind)).not.toContain('narration_text_changed')
    await expect(page.getByTestId('shot-sound-dialogue')).toHaveValue(view?.dialogue ?? '')

    // 復原：台詞回到原句、旁白回到「還沒有旁白」；重做又回到改短的
    await toast.getByTestId('toast-action').click()
    await expect(page.getByTestId('shot-sound-dialogue')).toHaveValue(LONG_LINE)
    await expect.poll(async () => (await soundOf(page)).shots[0]?.narration).toBeUndefined()
    await shoot(page, testInfo, 'fit-04-undone-original-line.png')
    const redone = await page.evaluate(() => window.svs.invoke('history.redo', {}))
    expect(redone.ok && redone.data.applied).toBe(true)
    await expect(page.getByTestId('shot-sound-dialogue')).toHaveValue(view?.dialogue ?? '')
    await expect.poll(async () => (await soundOf(page)).shots[0]?.narration?.version).toBe(2)

    // 時間軸（成品面板）上旁白不超出這一格
    await page.keyboard.press('Escape')
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('timeline-narration-1')).toHaveAttribute('data-overflow', 'false')
    await shoot(page, testInfo, 'fit-03-timeline-within-shot.png')
  })

  test('做預告片：配樂描述跟著腳本（每一段的起訖秒數、片名前靜音、結尾重音、不要人聲），長度＝成品＋3 秒、最後淡出 1.5 秒', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('trailer-start')).toBeVisible()
    await page.getByTestId('trailer-text').fill(STORY)
    await page.getByTestId('trailer-title').fill('斷橋')
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 30／30 秒', {
      timeout: 30_000,
    })
    await page.getByTestId('run-all').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 120_000 })
    // 預告片的聲音在影片生成好之後自動加：等配樂出現
    await expect
      .poll(async () => (await soundOf(page)).music?.text ?? '', { timeout: 60_000 })
      .toContain('Timeline: 0.0')
    const state = await soundOf(page)
    const music = state.music
    expect(music?.text).toContain('Instrumental only, no vocals')
    expect(music?.text).toMatch(/title: /)
    expect(music?.text).toMatch(/short silence at \d+\.\d–\d+\.\d s, right before the title card/)
    expect(music?.text).toMatch(/final accent at \d+\.\d s/)
    // 成品 30 秒：要的長度 33 秒、最後淡出 1.5 秒；混音後成品仍是 30 秒（多的 3 秒切掉）
    expect(music?.text).toContain('33 s long')
    expect(music?.fadeOutSec).toBe(1.5)
    expect(music?.durationSec).toBeCloseTo(33, 0)
    expect(state.totalSec).toBeCloseTo(30, 1)
    // 給交件看的：配樂描述原文
    const dir = process.env.SVS_SCREENSHOT_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'music-prompt.txt'), `${music?.text ?? ''}\n`)
    }
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-length')).toHaveText('成品 30 秒', {
      timeout: 30_000,
    })
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, 'brief-01-trailer-sound-panel.png')
  })
})
