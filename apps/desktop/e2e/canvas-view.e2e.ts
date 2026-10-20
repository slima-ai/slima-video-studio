import type { Page } from '@playwright/test'

import { canvasNodes, kindCount, viewportOf, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 示範模式貼一段故事會拆成 9 場、27 個鏡頭：一個畫面放不下。 */
async function bigProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await page
    .getByTestId('empty-paste-text')
    .fill('一隻貓在下雨的夜晚找到溫暖的家。牠遇到一個老婆婆，婆婆收留了牠。')
  await page.getByTestId('empty-paste-go').click()
  await page.getByTestId('run-confirm-ok').click()
  await expect.poll(() => kindCount(page, 'shot')).toBe(27)
  await expect(page.getByTestId('toast')).toContainText('已拆成', { timeout: 30_000 })
}

const setZoom = (page: Page, zoom: number): Promise<void> =>
  page.evaluate((z) => {
    const rf = (
      window as unknown as {
        __svsCanvas?: { setViewport: (v: object) => Promise<boolean> }
      }
    ).__svsCanvas
    void rf?.setViewport({ x: 100, y: 100, zoom: z })
  }, zoom)

test.describe('畫布：看得清楚的縮放', () => {
  test('「全部顯示」放不下時最多縮到 0.5（卡片按鈕還在），從第一場開始看；縮太小會出現「放大到看得清楚」', async ({
    page,
  }) => {
    await bigProject(page)
    await page.getByTestId('fit-view').click()
    await viewportSettled(page)
    expect((await viewportOf(page)).zoom).toBeGreaterThanOrEqual(0.5)
    await expect(page.getByTestId('zoom-readable')).toHaveCount(0)

    // 自己縮到只剩色塊：右下角給一個回到看得清楚的按鈕
    await setZoom(page, 0.2)
    await expect(page.getByTestId('zoom-readable')).toBeVisible()
    await page.getByTestId('zoom-readable').click()
    await viewportSettled(page)
    expect((await viewportOf(page)).zoom).toBe(0.8)
    await expect(page.getByTestId('zoom-readable')).toHaveCount(0)
  })

  test('開專案：上次停在縮到看不清楚的視角就不照用，定位到第一個入口（第一場）、看得清楚', async ({
    page,
  }) => {
    await bigProject(page)
    await setZoom(page, 0.2)
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
        return result.ok ? result.data.viewport?.zoom : undefined
      })
      .toBe(0.2)
    await page.reload()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect.poll(() => kindCount(page, 'shot')).toBe(27)
    await expect.poll(async () => (await viewportOf(page)).zoom).toBe(0.8)

    // 第一場（最上面最左邊的場）就在畫面上
    const first = (await canvasNodes(page))
      .filter((n) => n.data.kind === 'scene')
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0]
    if (!first) throw new Error('沒有場')
    await expect(page.locator(`.react-flow__node[data-id="${first.id}"]`)).toBeVisible()
    await expect(page.getByTestId('zoom-readable')).toHaveCount(0)
  })
})
