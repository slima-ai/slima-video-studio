import type { Page } from '@playwright/test'

import {
  canvasNodes,
  generateAndOpenCanvas,
  kindCount,
  viewportSettled,
  type FlowNode,
} from './canvas-helpers'
import { expect, test } from './fixtures'

const fitAll = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const rf = (window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } })
      .__svsCanvas
    await rf?.fitView({
      maxZoom: 1,
      duration: 0,
      padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
    })
  })

async function ready(page: Page): Promise<FlowNode[]> {
  await generateAndOpenCanvas(page)
  await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  await fitAll(page)
  await viewportSettled(page)
  return canvasNodes(page)
}

const menu = (page: Page) => page.getByTestId('context-menu')
const items = (page: Page) =>
  menu(page)
    .getByRole('menuitem')
    .evaluateAll((els) => els.map((el) => el.firstChild?.textContent ?? ''))
const rightClick = (page: Page, id: string, at = { x: 60, y: 16 }) =>
  page.locator(`.react-flow__node[data-id="${id}"]`).click({ button: 'right', position: at })

test.describe('畫布：右鍵選單', () => {
  test('影片上按右鍵：依狀態列出能做的事（含複製、清掉採用中的版本）；「不放進成品」切開關、可以復原；Esc 關掉', async ({
    page,
  }) => {
    const nodes = await ready(page)
    const video = nodes.find((n) => n.data.kind === 'video')
    if (!video) throw new Error('沒有影片')
    await rightClick(page, video.id)
    await expect(menu(page)).toBeVisible()
    expect(await items(page)).toEqual([
      '打開面板',
      '重做（產生新的一版）',
      '不放進成品',
      '置中顯示',
      '複製',
      '複製成獨立的一格',
      '清掉採用中的版本',
    ])
    // 按右鍵的那一格被選起來
    await expect(page.locator(`.react-flow__node[data-id="${video.id}"]`)).toHaveClass(/selected/)
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    await rightClick(page, video.id)
    await menu(page)
      .getByRole('menuitem', { name: /不放進成品/ })
      .click()
    await expect(menu(page)).toHaveCount(0)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === video.id)?.data.inCut)
      .toBe(false)
    await rightClick(page, video.id)
    expect(await items(page)).toContain('放回成品')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === video.id)?.data.inCut)
      .not.toBe(false)
  })

  test('場框標題上按右鍵「改名」：輸入框蓋在標題上', async ({ page }) => {
    const nodes = await ready(page)
    const scene = nodes.find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    await page
      .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
      .click({ button: 'right', position: { x: 40, y: 12 } })
    expect(await items(page)).toEqual([
      '打開面板',
      '生成這一場還缺的',
      '改名',
      '置中顯示',
      '複製',
      '再做一份',
      '刪除',
    ])
    await menu(page).getByRole('menuitem', { name: /改名/ }).click()
    await expect(page.getByTestId('rename-box')).toBeFocused()
  })

  test('空白處按右鍵：新增選單開在按的地方，新的格子放在那裡', async ({ page }) => {
    await ready(page)
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (!pane) throw new Error('沒有畫布')
    const at = { x: pane.x + pane.width - 200, y: pane.y + pane.height - 140 }
    await page.mouse.click(at.x, at.y, { button: 'right' })
    expect(await items(page)).toEqual(['新增…', '整理', '全部顯示'])
    await menu(page).getByRole('menuitem', { name: /新增/ }).click()
    const add = page.getByTestId('add-menu')
    await expect(add).toBeVisible()
    await add.getByRole('option', { name: /角色/ }).click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    // 新的角色放在按右鍵的地方附近（那裡空著）
    const hero = page.locator('.react-flow__node').filter({ hasText: '新角色' }).first()
    const box = await hero.boundingBox()
    if (!box) throw new Error('畫面上找不到新角色')
    expect(Math.abs(box.x - at.x)).toBeLessThan(160)
    expect(Math.abs(box.y - at.y)).toBeLessThan(160)
  })

  test('在選取的兩個鏡頭上按右鍵：刪除選取的 2 格，直接刪、提示寫後果', async ({ page }) => {
    const nodes = await ready(page)
    const [first, second] = nodes.filter((n) => n.data.kind === 'shot')
    if (!first || !second) throw new Error('鏡頭不夠')
    await page
      .locator(`.react-flow__node[data-id="${first.id}"]`)
      .click({ position: { x: 60, y: 16 } })
    await page
      .locator(`.react-flow__node[data-id="${second.id}"]`)
      .click({ position: { x: 60, y: 16 }, modifiers: ['Shift'] })
    await rightClick(page, second.id)
    expect(await items(page)).toEqual(['執行選取的 2 格', '複製', '再做一份', '刪除選取的 2 格'])
    await menu(page)
      .getByRole('menuitem', { name: /刪除選取的 2 格/ })
      .click()
    await expect(page.getByTestId('toast')).toContainText('已刪除 2 個鏡頭')
    await expect.poll(() => kindCount(page, 'shot')).toBe(1)
  })
})
