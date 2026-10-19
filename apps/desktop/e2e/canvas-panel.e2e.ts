import type { Page } from '@playwright/test'

import {
  canvasNodes,
  centerOn,
  emptyPoint,
  generateAndOpenCanvas,
  viewportSettled,
} from './canvas-helpers'
import { expect, test } from './fixtures'

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
}

/** 浮動面板滑到定位：右緣離畫布右緣 12px。 */
async function panelSettled(page: Page): Promise<void> {
  const panel = page.getByTestId('canvas-panel')
  const root = page.getByTestId('canvas-root')
  await expect
    .poll(async () => {
      const box = await panel.boundingBox()
      const area = await root.boundingBox()
      return box && area ? Math.round(area.x + area.width - (box.x + box.width)) : -1
    })
    .toBe(12)
}

test.describe('畫布上的詳情面板（示範模式）', () => {
  test('鏡頭的 ↗ 開右側浮動面板：蓋在畫布上、不推擠畫布；Esc、× 或點空白處收起', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const panel = page.getByTestId('canvas-panel')
    const root = page.getByTestId('canvas-root')
    const fullWidth = (await root.boundingBox())?.width ?? 0

    await openShot(page, 2)
    await expect(panel).toHaveAttribute('data-open', 'true')
    await expect(page.getByTestId('canvas-panel-title')).toHaveText('第 2 鏡')
    // 浮動：畫布寬度不變；面板 384px，離畫布右緣 12px
    expect((await root.boundingBox())?.width).toBe(fullWidth)
    await panelSettled(page)
    expect((await panel.boundingBox())?.width).toBe(384)
    // 舊的推擠式面板沒有打開
    await expect(page.getByTestId('layout-panel')).toHaveAttribute('data-open', 'false')

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    await openShot(page, 1)
    await page.getByTestId('canvas-panel-close').click()
    await expect(panel).toHaveCount(0)

    await openShot(page, 1)
    // 點畫布的空白處（面板蓋住的地方不算；等面板滑到定位再找，不然會找到它滑過去的地方）
    await panelSettled(page)
    const at = await emptyPoint(page)
    await page.mouse.click(at.x, at.y)
    await expect(panel).toHaveCount(0)
  })

  test('面板開著時點別的格子：面板跟著換；角色、場也有面板；生成類的格子有「試跑」', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await openShot(page, 1)
    await expect(page.getByTestId('canvas-panel-tab-trial')).toBeVisible()
    // 點第 2 鏡的圖：面板換成那張圖的所有版本
    const second = await shotKey(page, 2)
    await centerOn(page, `${second}:image`)
    await page.getByTestId(`node-${second}:image`).click({ position: { x: 60, y: 14 } })
    await expect(page.getByTestId('canvas-panel-title')).toHaveText('第 2 鏡・第一張畫面')
    await expect(page.getByTestId('takes-panel-image')).toBeVisible()

    // 試跑：列出要做的步驟與花費，按「執行」就重做
    await page.getByTestId('canvas-panel-tab-trial').click()
    await expect(page.getByTestId('trial-steps')).toContainText('第 2 鏡')
    await expect(page.getByTestId('trial-cost')).toContainText('US$')
    await page.getByTestId('trial-run').click()
    const started = page.getByTestId('toast').filter({ hasText: '開始生成' })
    await expect(started).toBeVisible()
    // 提示往左讓開，不蓋住面板
    await expect
      .poll(async () => {
        const toast = await started.boundingBox()
        const box = await page.getByTestId('canvas-panel').boundingBox()
        return toast && box ? toast.x + toast.width <= box.x : false
      })
      .toBe(true)

    // 場：欄位；沒有試跑
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    await page
      .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
      .click({ position: { x: 40, y: 12 } })
    await expect(page.getByTestId('scene-panel')).toBeVisible()
    await expect(page.getByTestId('canvas-panel-tab-trial')).toHaveCount(0)
    await page.getByTestId('scene-panel-mood').fill('安靜')
    await page.getByTestId('scene-panel-mood').blur()
    await expect
      .poll(async () => {
        const outline = await page.evaluate(() => window.svs.invoke('outline.get', {}))
        return outline.ok ? outline.data.acts[0]?.scenes[0]?.mood : undefined
      })
      .toBe('安靜')
  })

  test('面板擋住格子時畫布平移讓位；縮放鈕往左讓開', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const cut = page.getByTestId('node-cut')
    await centerOn(page, 'cut')
    // 把剪輯推到畫面右緣（會被面板擋住的位置）
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
      if (v) void rf?.setViewport({ ...v, x: v.x + 420 })
    })
    await viewportSettled(page)
    await page.getByTestId('open-cut').click()
    const panel = page.getByTestId('canvas-panel')
    await expect(panel).toHaveAttribute('data-open', 'true')
    await expect
      .poll(async () => {
        const a = await cut.boundingBox()
        const b = await panel.boundingBox()
        return a && b ? a.x + a.width <= b.x : false
      })
      .toBe(true)
    // 面板滑進來、縮放鈕往左移都有 300ms 動畫：等面板停好，再等縮放鈕移到面板左邊
    await panelSettled(page)
    const panelBox = await panel.boundingBox()
    await expect
      .poll(async () => {
        const zoomBox = await page.getByTestId('fit-view').boundingBox()
        return (zoomBox?.x ?? 0) + (zoomBox?.width ?? 0)
      })
      .toBeLessThanOrEqual(panelBox?.x ?? 0)
  })

  test('在面板改描述重新生成：只多這一鏡的新版本，畫布上的鏡頭描述跟著更新', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await openShot(page, 3)
    await page.getByTestId('shot-description').fill('貓在屋頂上看著月亮')
    await page.getByTestId('shot-apply').click()
    await expect(page.getByTestId('shot-version-2')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('shot-activity')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByTestId('shot-version-2')).toHaveAttribute('data-adopted', 'true')

    const key = await shotKey(page, 3)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === key)?.data.title)
      .toBe('第 3 鏡')
    await centerOn(page, key)
    await expect(page.getByTestId(`node-${key}`)).toContainText('貓在屋頂上看著月亮')
    // 第 1 鏡沒有被動到
    await page.keyboard.press('Escape')
    await openShot(page, 1)
    await expect(page.getByTestId('shot-version-2')).toHaveCount(0)
  })

  test('剪輯的 ↗ 開成品面板：接片後可以預覽與匯出', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    // 生成完會自動接好成品
    const video = page.getByTestId('final-cut-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(8)

    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toContainText('已匯出到')
    await page.getByTestId('final-cut-rejoin').click()
    await expect(page.getByTestId('final-cut-rejoin')).toHaveText('重新接片', { timeout: 30_000 })
  })
})
