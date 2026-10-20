import type { Page } from '@playwright/test'

import { canvasNodes } from './canvas-helpers'
import { expect, test } from './fixtures'

const viewportOf = (page: Page) =>
  page.evaluate(() => {
    const rf = (
      window as unknown as {
        __svsCanvas?: { getViewport: () => { x: number; y: number; zoom: number } }
      }
    ).__svsCanvas
    return rf?.getViewport()
  })

test.describe('畫布：很多場的大專案', () => {
  test('「全部顯示」裝不下時從第一場開始看；縮到最小時「第 N 場」蓋在場框中間、不壓到別場', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    // 120 鏡＝12 場，一欄 10 場，縮到看得清楚的程度（0.5）也裝不下
    const seeded = await page.evaluate(() => window.svs.invoke('dev.seedDemo', { shots: 120 }))
    expect(seeded.ok).toBe(true)
    await expect
      .poll(async () => (await canvasNodes(page)).filter((n) => n.data.kind === 'scene').length)
      .toBe(12)

    // 「全部顯示」最多縮到 0.5（卡片的字和按鈕還在），裝不下就從第一場開始看
    await page.getByTestId('fit-view').click()
    await expect.poll(async () => (await viewportOf(page))?.zoom).toBe(0.5)
    const root = page.getByTestId('canvas-root')
    await expect(root).toHaveAttribute('data-lod', 'full')
    const scenes = (await canvasNodes(page)).filter((n) => n.data.kind === 'scene')
    const first = scenes.reduce((a, b) => (b.position.y < a.position.y ? b : a))

    // 自己縮到最小（0.1，只畫色塊），第一場仍在左上：場名的測試從這裡開始
    await page.evaluate(({ x, y }) => {
      const rf = (
        window as unknown as {
          __svsCanvas?: { setViewport: (v: object) => Promise<boolean> }
        }
      ).__svsCanvas
      // 跟「全部顯示」一樣：第一場的左上角放在上方列與左側面板的右下
      void rf?.setViewport({ x: 270 - x * 0.1, y: 80 - y * 0.1, zoom: 0.1 })
    }, first.position)
    await expect.poll(async () => (await viewportOf(page))?.zoom).toBe(0.1)
    await expect(root).toHaveAttribute('data-lod', 'low')

    // 從第一場開始看：第 1 場在畫面左上（上方列與左側面板的右下）
    const firstBox = await page.locator(`.react-flow__node[data-id="${first.id}"]`).boundingBox()
    expect(firstBox?.y ?? 0).toBeGreaterThan(56)
    expect(firstBox?.y ?? 0).toBeLessThan(200)

    // 場名蓋在場框正中間，整塊都在自己的場框裡（以前在場框上方，會壓到上一場的鏡頭）
    const label = page.getByTestId(`scene-label-${first.id}`)
    await expect(label).toHaveText('第 1 場')
    // 第一欄最上面兩場（畫面外的場框不會畫出來）
    const column = scenes
      .filter((n) => n.position.x === first.position.x)
      .sort((a, b) => a.position.y - b.position.y)
    for (const scene of column.slice(0, 2)) {
      const frame = await page.locator(`.react-flow__node[data-id="${scene.id}"]`).boundingBox()
      const box = await page.getByTestId(`scene-label-${scene.id}`).boundingBox()
      if (!frame || !box) throw new Error('場框或場名沒畫出來')
      expect(box.y).toBeGreaterThanOrEqual(frame.y)
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height)
    }
    // 場框上方原本的大字在這個縮放不畫
    await expect(root.locator('.svs-frame-big').first()).toBeHidden()

    // 放大到 0.3（只留標題）：場名回到場框上方，字縮小到塞得進場與場之間的空隙
    await page.evaluate(() => {
      const rf = (
        window as unknown as {
          __svsCanvas?: {
            getViewport: () => { x: number; y: number; zoom: number }
            setViewport: (v: object) => Promise<boolean>
          }
        }
      ).__svsCanvas
      const v = rf?.getViewport()
      if (v) void rf?.setViewport({ ...v, zoom: 0.3 })
    })
    await expect(root).toHaveAttribute('data-lod', 'mid')
    await expect(page.getByTestId(`scene-label-${first.id}`)).toHaveCount(0)
    const big = page.locator(`.react-flow__node[data-id="${first.id}"] .svs-frame-big`)
    await expect(big).toBeVisible()
    // 場與場之間 60 單位，縮到 0.3 是 18px：字和下面的空隙要塞得進去
    const bigBox = await big.boundingBox()
    expect(bigBox?.height ?? 99).toBeLessThanOrEqual(16)
  })
})
