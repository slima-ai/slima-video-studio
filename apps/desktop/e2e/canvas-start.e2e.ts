import type { Page } from '@playwright/test'

import { canvasNodes, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

const toast = (page: Page) => page.getByTestId('toast')
const openCanvas = (page: Page) => page.getByRole('button', { name: '畫布', exact: true }).click()

test.describe('畫布：空白時的三個起點，與沒歸場的鏡頭', () => {
  test('空白畫布有三個起點；「自己一步一步來」＝一個鏡頭放進新的場、打開面板，一步復原', async ({
    page,
  }) => {
    await openCanvas(page)
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('empty-manual')).toBeEnabled()
    await expect(page.getByTestId('empty-paste-go')).toBeDisabled()
    await expect(page.getByTestId('empty-add-oneliner')).toBeEnabled()
    // 每一張都說清楚會不會花錢
    await expect(page.getByTestId('canvas-empty')).toContainText('加上去不花錢')
    await expect(page.getByTestId('canvas-empty')).toContainText('不生成圖片和影片')
    await expect(page.getByTestId('canvas-empty')).toContainText('會花錢（圖片和影片）')

    await page.getByTestId('empty-manual').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(1)
    expect(await kindCount(page, 'scene')).toBe(1)
    await expect(page.getByTestId('canvas-empty')).toHaveCount(0)
    await expect(page.getByTestId('shot-panel')).toBeVisible()
    await expect(toast(page)).toContainText('已加上第一個鏡頭')
    // 鏡頭在場裡：沒有「沒歸場」的標記與提醒，也沒有任何圖與影片
    await expect(page.getByTestId('loose-banner')).toHaveCount(0)
    await expect(page.getByTestId('loose-badge')).toHaveCount(0)
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shot?.data.sceneId).toBeDefined()

    // 場和鏡頭是同一步：復原一次就回到空白畫布
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => kindCount(page, 'shot')).toBe(0)
    expect(await kindCount(page, 'scene')).toBe(0)
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
  })

  test('貼一段故事：先看預估、確認後拆成場和鏡頭；不生成圖片和影片', async ({ page }) => {
    await openCanvas(page)
    await page
      .getByTestId('empty-paste-text')
      .fill('一隻貓在下雨的夜晚找到溫暖的家。牠遇到一個老婆婆，婆婆收留了牠。')
    await page.getByTestId('empty-paste-go').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('把故事拆成分鏡')
    await expect(confirm).toContainText('不會生成圖片和影片')
    await expect(confirm).toContainText('預估約')
    // 取消：什麼都沒發生
    await confirm.getByRole('button', { name: '取消' }).click()
    expect(await kindCount(page, 'scene')).toBe(0)

    await page.getByTestId('empty-paste-go').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect.poll(() => kindCount(page, 'shot')).toBeGreaterThan(0)
    await expect(toast(page)).toContainText('已拆成', { timeout: 30_000 })
    await expect(toast(page)).toContainText('圖片和影片還沒生成')
    expect(await kindCount(page, 'scene')).toBeGreaterThan(0)
    // 只有分鏡：每個鏡頭都在場裡，第一張畫面和影片都還沒生成
    const nodes = await canvasNodes(page)
    expect(
      nodes.filter((n) => n.data.kind === 'shot').every((n) => n.data.sceneId !== undefined),
    ).toBe(true)
    const media = nodes.filter((n) => n.data.kind === 'image' || n.data.kind === 'video')
    expect(media.length).toBeGreaterThan(0)
    expect(media.every((n) => n.data.status === 'idle')).toBe(true)
  })

  test('沒歸場的鏡頭：標記、畫布上方的提醒，「歸進場」一鍵歸好、可以復原；新增鏡頭沒指定場時自動有場', async ({
    page,
  }) => {
    await openCanvas(page)
    // 不指定場新增鏡頭（分鏡表、MCP 都走這條）：專案沒有場，先建一個
    const created = await page.evaluate(() => window.svs.invoke('shots.create', {}))
    if (!created.ok) throw new Error(created.error.userMessage)
    expect(created.data.sceneId).toBeDefined()
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
    await expect(page.getByTestId('loose-banner')).toHaveCount(0)

    // 刪掉場：鏡頭留著但不屬於任何場 → 出現提醒與標記
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    await page.evaluate((key) => window.svs.invoke('canvas.remove', { keys: [key] }), scene.id)
    await expect(page.getByTestId('loose-banner')).toContainText('有 1 個鏡頭還沒歸到任何場')
    await expect(page.getByTestId('loose-banner')).toContainText('不會接進成品')
    await expect(page.getByTestId('loose-badge')).toHaveCount(1)
    await expect(page.getByTestId('loose-assign')).toHaveText('歸進一個新的場')
    await page.getByTestId('loose-show').click()

    // 一鍵歸進場（沒有場就先建一個）：提醒與標記都消失，鏡頭有場了
    await page.getByTestId('loose-assign').click()
    await expect(page.getByTestId('loose-banner')).toHaveCount(0)
    await expect(page.getByTestId('loose-badge')).toHaveCount(0)
    await expect(toast(page)).toContainText('已把 1 個鏡頭歸進新的場')
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shot?.data.sceneId).toBeDefined()
    expect(await kindCount(page, 'scene')).toBe(1)

    // 復原：回到沒歸場的樣子
    await page.getByTestId('toast-action').click()
    await expect(page.getByTestId('loose-banner')).toBeVisible()
  })
})
