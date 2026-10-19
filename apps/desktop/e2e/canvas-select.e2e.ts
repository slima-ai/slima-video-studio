import type { Page } from '@playwright/test'

import {
  canvasNodes,
  generateAndOpenCanvas,
  kindCount,
  viewportOf,
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

const shotsOf = async (page: Page): Promise<FlowNode[]> =>
  (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
const positionOf = async (page: Page, id: string): Promise<{ x: number; y: number }> => {
  const node = (await canvasNodes(page)).find((n) => n.id === id)
  if (!node) throw new Error(`沒有節點 ${id}`)
  return node.position
}
const selectedIds = (page: Page): Promise<string[]> =>
  page
    .locator('.react-flow__node.selected')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''))
const historyState = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.svs.invoke('history.state', {})
    return result.ok ? result.data : undefined
  })
async function boxOf(page: Page, id: string) {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
  if (!box) throw new Error(`畫面上找不到 ${id}`)
  return box
}

/** 一句話長出 3 鏡、整個放進畫面。 */
async function ready(page: Page): Promise<FlowNode[]> {
  await generateAndOpenCanvas(page)
  await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  await fitAll(page)
  await viewportSettled(page)
  return shotsOf(page)
}

test.describe('畫布：選取與鍵盤', () => {
  test('空白處拖曳是框選：從場框裡面開始拖也可以，碰到的格子都選起來', async ({ page }) => {
    const [first, second] = await ready(page)
    if (!first || !second) throw new Error('鏡頭不夠')
    const a = await boxOf(page, first.id)
    const b = await boxOf(page, second.id)
    // 從第 2 鏡左下方（場框裡面的空白處）往上拖到第 1 鏡的中間
    await page.mouse.move(b.x - 10, b.y + b.height + 12)
    await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 12 })
    await expect(page.locator('.react-flow__selection')).toBeVisible()
    await page.mouse.up()
    await expect
      .poll(() => selectedIds(page))
      .toEqual(expect.arrayContaining([first.id, second.id]))
    // 框選不會拖動場框
    expect(await positionOf(page, first.id)).toEqual(first.position)
  })

  test('平移：中鍵拖曳或按住空白鍵拖曳（拖空白處不再平移）', async ({ page }) => {
    await ready(page)
    const before = await viewportOf(page)
    const pane = page.locator('.react-flow__pane')
    const box = await pane.boundingBox()
    if (!box) throw new Error('沒有畫布')
    const at = { x: box.x + box.width - 80, y: box.y + box.height - 120 }
    await page.mouse.move(at.x, at.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(at.x - 150, at.y - 60, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await expect.poll(async () => (await viewportOf(page)).x).toBeCloseTo(before.x - 150, 0)
    const mid = await viewportOf(page)
    await page.keyboard.down('Space')
    // 按住空白鍵後畫布要重畫一次才開放左鍵平移；等它真的進入平移狀態再拖（人手本來就會先按住再拖）
    await expect(pane).toHaveClass(/\bdraggable\b/)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 100, at.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect.poll(async () => (await viewportOf(page)).x).toBeCloseTo(mid.x + 100, 0)
  })

  test('方向鍵微調選取的鏡頭：整串一起動，Shift 一次 64px；連按只算一步復原', async ({ page }) => {
    const [first] = await ready(page)
    if (!first) throw new Error('沒有鏡頭')
    const image = `${first.id}:image`
    const imageAt = await positionOf(page, image)
    const before = await historyState(page)
    await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({
      position: { x: 60, y: 16 },
    })
    await expect.poll(() => selectedIds(page)).toEqual([first.id])
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    const want = { x: first.position.x + 48, y: first.position.y + 64 }
    await expect.poll(() => positionOf(page, first.id)).toEqual(want)
    // 存好之後（停下來一下才存）重新讀資料也一樣，圖跟著動
    await expect
      .poll(async () => (await historyState(page))?.undoCount)
      .toBe((before?.undoCount ?? 0) + 1)
    expect((await historyState(page))?.undoLabel).toBe('移動位置')
    expect(await positionOf(page, image)).toEqual({ x: imageAt.x + 48, y: imageAt.y + 64 })
    // 一步復原回到原位
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => positionOf(page, first.id)).toEqual(first.position)
  })

  test('Enter 開選取那一格的面板：鏡頭開鏡頭的，圖開這一鏡的第一張畫面的所有版本', async ({
    page,
  }) => {
    const [first] = await ready(page)
    if (!first) throw new Error('沒有鏡頭')
    await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({
      position: { x: 60, y: 16 },
    })
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('shot-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('canvas-panel')).toHaveCount(0)
    await page.locator(`.react-flow__node[data-id="${first.id}:image"]`).click({
      position: { x: 60, y: 16 },
    })
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('takes-panel-image')).toBeVisible()
    await expect(page.getByTestId('canvas-panel-title')).toHaveText(
      `${first.data.title}・第一張畫面`,
    )
  })

  test('F2 改場的名字：輸入框蓋在標題上，Enter 存好、可以復原；鏡頭不能改名', async ({ page }) => {
    const [first] = await ready(page)
    if (!first) throw new Error('沒有鏡頭')
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    const original = scene.data.title
    await page
      .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
      .click({ position: { x: 40, y: 12 } })
    await expect.poll(() => selectedIds(page)).toEqual([scene.id])
    await page.keyboard.press('F2')
    const box = page.getByTestId('rename-box')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue(original.slice(original.indexOf('・') + 1))
    await box.fill('雨夜的巷子')
    await box.press('Enter')
    await expect(box).toHaveCount(0)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === scene.id)?.data.title)
      .toBe('第 1 場・雨夜的巷子')
    await expect(
      page.getByTestId('toast').filter({ hasText: '已改名為「雨夜的巷子」' }),
    ).toBeVisible()
    expect((await historyState(page))?.undoLabel).toBe('改名')
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === scene.id)?.data.title)
      .toBe(original)

    // 鏡頭不能改名：說明哪些可以
    await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({
      position: { x: 60, y: 16 },
    })
    await page.keyboard.press('F2')
    await expect(page.getByTestId('rename-box')).toHaveCount(0)
    await expect(
      page.getByTestId('toast').filter({ hasText: '場、角色、地點、群組才能改名' }),
    ).toBeVisible()
  })

  test('F2 改名時按 Esc 取消，名字不變、不留下復原紀錄', async ({ page }) => {
    await ready(page)
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    const before = await historyState(page)
    await page
      .locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`)
      .click({ position: { x: 40, y: 12 } })
    await page.keyboard.press('F2')
    await page.getByTestId('rename-box').fill('不要了')
    await page.getByTestId('rename-box').press('Escape')
    await expect(page.getByTestId('rename-box')).toHaveCount(0)
    expect((await canvasNodes(page)).find((n) => n.id === scene.id)?.data.title).toBe(
      scene.data.title,
    )
    expect((await historyState(page))?.undoCount).toBe(before?.undoCount)
  })

  test('雙擊格子的標題：這一格移到畫面中央、縮放回到 100%', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await fitAll(page)
    await viewportSettled(page)
    expect((await viewportOf(page)).zoom).toBeLessThan(1)
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    await page
      .locator(`.react-flow__node[data-id="${shot.id}"]`)
      .getByText(shot.data.title, { exact: true })
      .first()
      .dblclick()
    await expect.poll(async () => (await viewportOf(page)).zoom).toBe(1)
    await viewportSettled(page)
    const box = await page.locator(`.react-flow__node[data-id="${shot.id}"]`).boundingBox()
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (!box || !pane) throw new Error('畫面上找不到')
    expect(Math.abs(box.x + box.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(24)
    expect(Math.abs(box.y + box.height / 2 - (pane.y + pane.height / 2))).toBeLessThan(24)
  })

  test('格子超過 40 個才出現小地圖（左下角），可以拖著看', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    const count = (await canvasNodes(page)).length
    // 用便條補到 41 格以上
    await page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) {
        await window.svs.invoke('canvas.add', { kind: 'note', x: 2000 + (i % 6) * 260, y: i * 40 })
      }
    }, 41 - count)
    await expect.poll(async () => (await canvasNodes(page)).length).toBeGreaterThan(40)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
  })
})
