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

const nodeOf = async (page: Page, id: string): Promise<FlowNode | undefined> =>
  (await canvasNodes(page)).find((n) => n.id === id)
const freeOf = async (page: Page, kind: string) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.nodes.filter((n) => n.kind === kind)
}

async function ready(page: Page): Promise<FlowNode[]> {
  await generateAndOpenCanvas(page)
  await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  await fitAll(page)
  await viewportSettled(page)
  return canvasNodes(page)
}

test.describe('畫布：便條與自訂群組', () => {
  test('便條：從左側面板新增，雙擊寫字、點別的地方就存；可以復原；Delete 直接刪、不用確認', async ({
    page,
  }) => {
    await ready(page)
    await page.getByTestId('palette-note').click()
    await expect.poll(async () => (await freeOf(page, 'note')).length).toBe(1)
    const [note] = await freeOf(page, 'note')
    if (!note) throw new Error('沒有便條')
    const card = page.locator(`.react-flow__node[data-id="${note.key}"]`)
    await expect(card).toBeVisible()
    await expect(card.getByTestId('note-view')).toHaveText('雙擊寫字')
    await card.getByTestId('note-view').dblclick()
    const text = card.getByTestId('note-text')
    await expect(text).toBeFocused()
    await text.fill('第 3 鏡要更暗')
    // 點畫布右下角的空白處：輸入框失焦就存
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (!pane) throw new Error('沒有畫布')
    await page.mouse.click(pane.x + pane.width - 60, pane.y + pane.height - 60)
    await expect(card.getByTestId('note-view')).toHaveText('第 3 鏡要更暗')
    expect((await freeOf(page, 'note'))[0]?.summary).toBe('第 3 鏡要更暗')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(card.getByTestId('note-view')).toHaveText('雙擊寫字')

    // 選取後 Delete：直接刪，提示可以復原
    await card.click({ position: { x: 20, y: 10 } })
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
    await expect.poll(async () => (await freeOf(page, 'note')).length).toBe(0)
    await expect(page.getByTestId('toast').filter({ hasText: '已刪除 1 格' })).toBeVisible()
  })

  test('選兩個鏡頭按 Ctrl+G：群組框住它們；拖群組的標題列，裡面的格子一起動；一步復原', async ({
    page,
  }) => {
    const nodes = await ready(page)
    const [first, second, third] = nodes.filter((n) => n.data.kind === 'shot')
    if (!first || !second || !third) throw new Error('鏡頭不夠')
    await page
      .locator(`.react-flow__node[data-id="${first.id}"]`)
      .click({ position: { x: 60, y: 16 } })
    await page
      .locator(`.react-flow__node[data-id="${second.id}"]`)
      .click({ position: { x: 60, y: 16 }, modifiers: ['Shift'] })
    await page.keyboard.press('ControlOrMeta+g')
    await expect.poll(async () => (await freeOf(page, 'group')).length).toBe(1)
    const [group] = await freeOf(page, 'group')
    const height = group?.height
    if (!group || height === undefined) throw new Error('群組沒有大小')
    // 框住第 1、2 鏡（與它們的圖、影片），沒框到第 3 鏡
    const inside = (n: FlowNode): boolean =>
      n.position.x >= group.x && n.position.y >= group.y && n.position.y + 140 <= group.y + height
    expect(inside(first)).toBe(true)
    expect(inside(second)).toBe(true)
    expect(inside(third)).toBe(false)

    const grip = page.locator(`.react-flow__node[data-id="${group.key}"] .svs-group-grip`).first()
    const box = await grip.boundingBox()
    if (!box) throw new Error('畫面上找不到群組')
    await page.mouse.move(box.x + 40, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + 40 + 160, box.y + 12, { steps: 12 })
    await page.mouse.up()
    await expect
      .poll(async () => (await nodeOf(page, first.id))?.position.x)
      .toBeGreaterThan(first.position.x + 100)
    const moved = (await nodeOf(page, first.id))?.position.x ?? 0
    expect((await nodeOf(page, second.id))?.position.x).toBe(moved)
    // 群組外的第 3 鏡不動
    expect((await nodeOf(page, third.id))?.position).toEqual(third.position)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await nodeOf(page, first.id))?.position).toEqual(first.position)
  })

  test('群組：選取時標題列可以換顏色；F2 改名；刪除群組時框裡的格子留著', async ({ page }) => {
    await ready(page)
    await page.getByTestId('palette-group').click()
    await expect.poll(async () => (await freeOf(page, 'group')).length).toBe(1)
    const [group] = await freeOf(page, 'group')
    if (!group) throw new Error('沒有群組')
    const node = page.locator(`.react-flow__node[data-id="${group.key}"]`)
    await expect(node.getByTestId(`node-${group.key}`)).toHaveAttribute('data-color', 'slate')
    await node
      .locator('.svs-group-grip')
      .first()
      .click({ position: { x: 40, y: 12 } })
    await node.getByTestId('group-color-rose').click()
    await expect(node.getByTestId(`node-${group.key}`)).toHaveAttribute('data-color', 'rose')

    await node
      .locator('.svs-group-grip')
      .first()
      .click({ position: { x: 40, y: 12 } })
    await page.keyboard.press('F2')
    await page.getByTestId('rename-box').fill('開場')
    await page.getByTestId('rename-box').press('Enter')
    await expect.poll(async () => (await freeOf(page, 'group'))[0]?.title).toBe('開場')

    const shots = await kindCount(page, 'shot')
    await node
      .locator('.svs-group-grip')
      .first()
      .click({ button: 'right', position: { x: 40, y: 12 } })
    await page
      .getByTestId('context-menu')
      .getByRole('menuitem', { name: /刪除群組/ })
      .click()
    await expect.poll(async () => (await freeOf(page, 'group')).length).toBe(0)
    expect(await kindCount(page, 'shot')).toBe(shots)
  })
})
