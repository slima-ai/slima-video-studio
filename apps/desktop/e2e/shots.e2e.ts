import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

// 逐鏡調整：以前在快速開始頁的鏡頭列表，現在從畫布節點的 ↗ 打開同一個鏡頭面板（M6-8c-3）。
// 面板滑入 / 收起與「改描述只多這一鏡的新版本」在 canvas-panel.e2e.ts。

/** 第 n 個鏡頭（鏡號）的節點鍵。 */
async function shotKey(page: Page, number: number): Promise<string> {
  const nodes = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
  const node = nodes.find((n) => n.data.title === `第 ${String(number)} 鏡`)
  if (!node) throw new Error(`找不到第 ${String(number)} 鏡`)
  return node.id
}

async function openShot(page: Page, number: number): Promise<void> {
  const key = await shotKey(page, number)
  await centerOn(page, key)
  await page.getByTestId(`open-${key}`).click()
  await expect(page.getByTestId('shot-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: `第 ${String(number)} 鏡` })).toBeVisible()
}

/** 打開剪輯的成品面板。 */
async function openCut(page: Page): Promise<void> {
  await centerOn(page, 'cut')
  await page.getByTestId('open-cut').click()
  await expect(page.getByTestId('final-cut-panel')).toBeVisible()
}

const finalSrc = async (page: Page): Promise<string> => {
  const src = await page.getByTestId('final-cut-video').getAttribute('src')
  if (!src) throw new Error('沒有完整影片')
  return src
}

/** 在成品面板按「重新接片」，等它接好。 */
async function rejoin(page: Page): Promise<void> {
  await page.getByTestId('final-cut-rejoin').click()
  await expect(page.getByTestId('final-cut-rejoin')).toHaveText('接成成品', { timeout: 30_000 })
}

const waitIdle = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('shot-activity')).toHaveCount(0, { timeout: 60_000 })
}

test.describe('逐鏡調整（示範模式）', () => {
  test('改第 3 鏡 → 重新生成只多出它的新版本 → 切回舊版本 → 接成成品用舊版本', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await openCut(page)
    const original = await finalSrc(page)

    // 改第 3 鏡的描述與運鏡並套用
    await openShot(page, 3)
    await page.getByTestId('shot-description').fill('貓在屋頂上看著月亮')
    await pick(page, 'shot-camera', 'orbit')
    await expect(page.getByTestId('shot-camera-hint')).toHaveText('鏡頭繞著主體轉。')
    await page.getByTestId('shot-apply').click()
    await expect(page.getByTestId('shot-version-2')).toBeVisible({ timeout: 60_000 })
    await waitIdle(page)
    await expect(page.getByTestId('shot-version-2')).toHaveAttribute('data-adopted', 'true')
    await expect(page.getByTestId('shot-version-1')).toHaveAttribute('data-adopted', 'false')
    await expect(page.getByTestId('shot-camera')).toHaveAttribute('data-value', 'orbit')
    const preview = page.getByTestId('shot-preview')
    await expect
      .poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    // 畫布上的鏡頭描述也更新了
    const third = await shotKey(page, 3)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === third)?.data)
      .toMatchObject({ summary: '貓在屋頂上看著月亮' })

    // 第 1 鏡沒有被動到
    await openShot(page, 1)
    await expect(page.getByTestId('shot-version-1')).toHaveAttribute('data-adopted', 'true')
    await expect(page.getByTestId('shot-version-2')).toHaveCount(0)

    // 重新接片 → 完整影片換成包含新版本的那一支
    await openCut(page)
    await rejoin(page)
    await expect.poll(() => finalSrc(page)).not.toBe(original)
    const joined = await finalSrc(page)
    const video = page.getByTestId('final-cut-video')
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(8)

    // 切回第 3 鏡的舊版本 → 重新接片 → 回到最初那一支
    await openShot(page, 3)
    await page.getByTestId('shot-adopt-1').click()
    await expect(page.getByTestId('shot-version-1')).toHaveAttribute('data-adopted', 'true')
    await openCut(page)
    await rejoin(page)
    await expect.poll(() => finalSrc(page), { timeout: 30_000 }).not.toBe(joined)
    expect(await finalSrc(page)).toBe(original)
  })

  test('只換一支影片：首幀圖不變；整個重做：首幀圖也多一個版本', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await openShot(page, 2)

    await page.getByTestId('shot-regen-video').click()
    await expect(page.getByTestId('shot-version-2')).toBeVisible({ timeout: 60_000 })
    await waitIdle(page)
    await expect(page.getByTestId('shot-frames')).toHaveCount(0)

    await page.getByTestId('shot-regen-all').click()
    await expect(page.getByTestId('shot-version-3')).toBeVisible({ timeout: 60_000 })
    await waitIdle(page)
    await expect(page.getByTestId('shot-frames').getByRole('img')).toHaveCount(2)
  })
})
