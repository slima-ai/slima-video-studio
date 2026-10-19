import type { Page } from '@playwright/test'

import { clickEmpty, emptyPoint, generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

const graphOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}
const ofKind = async (page: Page, kind: string) =>
  (await graphOf(page)).nodes.filter((n) => n.kind === kind)

/** 把一格放到畫面中央（縮到 0.8），之後才點得到。 */
async function center(page: Page, key: string): Promise<void> {
  await page.evaluate((id) => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNode: (id: string) => { position: { x: number; y: number } } | undefined
          setCenter: (x: number, y: number, o: object) => Promise<boolean>
        }
      }
    ).__svsCanvas
    const node = rf?.getNode(id)
    if (!node) return
    return rf?.setCenter(node.position.x + 100, node.position.y + 80, { zoom: 0.8, duration: 0 })
  }, key)
  await viewportSettled(page)
}

const card = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`)

test.describe('畫布：複製、貼上、刪除', () => {
  test('鏡頭 Ctrl+C、Ctrl+V：在原鏡頭後面多一鏡，帶描述、不帶圖和影片；Ctrl+Z 收回', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [first] = await ofKind(page, 'shot')
    if (!first) throw new Error('沒有鏡頭')
    await center(page, first.key)
    await card(page, first.key).click({ position: { x: 60, y: 14 } })
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByTestId('toast').filter({ hasText: '已複製 1 格' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+v')
    await expect.poll(async () => (await ofKind(page, 'shot')).length).toBe(4)
    await expect(page.getByTestId('toast').filter({ hasText: '已貼上「第 2 鏡」' })).toBeVisible()

    const shots = await ofKind(page, 'shot')
    const copy = shots.find((s) => s.title === '第 2 鏡')
    expect(copy?.summary).toBe(first.summary)
    const nodes = (await graphOf(page)).nodes
    expect(nodes.find((n) => n.key === `${copy?.key ?? ''}:image`)?.assetHash).toBeUndefined()
    expect(nodes.find((n) => n.key === `${copy?.key ?? ''}:video`)?.assetHash).toBeUndefined()
    // 貼上的那一鏡被選取
    await expect(card(page, copy?.key ?? '')).toHaveClass(/selected/)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await ofKind(page, 'shot')).length).toBe(3)
  })

  test('單獨選圖按 Delete：清掉採用中的版本（不用確認），鏡頭留著；Ctrl+Z 回來', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [first] = await ofKind(page, 'shot')
    if (!first) throw new Error('沒有鏡頭')
    const key = `${first.key}:image`
    await center(page, key)
    const before = (await graphOf(page)).nodes.find((n) => n.key === key)?.assetHash
    expect(before).toBeDefined()
    await card(page, key).click({ position: { x: 60, y: 14 } })
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
    await expect(page.getByTestId('toast').filter({ hasText: '已清掉採用中的版本' })).toBeVisible()
    await expect
      .poll(async () => (await graphOf(page)).nodes.find((n) => n.key === key)?.assetHash)
      .toBeUndefined()
    expect(await ofKind(page, 'shot')).toHaveLength(3)
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await graphOf(page)).nodes.find((n) => n.key === key)?.assetHash)
      .toBe(before)
  })

  test('右鍵：影片「複製成獨立的一格」；角色複製後在空白處右鍵「貼上」，放在那裡、名字加「副本」', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [first] = await ofKind(page, 'shot')
    if (!first) throw new Error('沒有鏡頭')
    const video = `${first.key}:video`
    await center(page, video)
    await card(page, video).click({ button: 'right', position: { x: 60, y: 14 } })
    await page.getByRole('menuitem', { name: /複製成獨立的一格/ }).click()
    await expect.poll(async () => (await ofKind(page, 'free_video')).length).toBe(1)
    const [freeVideo] = await ofKind(page, 'free_video')
    expect(freeVideo?.title).toBe('第 1 鏡的影片')
    // 放在空位，不蓋住原本的影片
    const original = await card(page, video).boundingBox()
    const pasted = await card(page, freeVideo?.key ?? '').boundingBox()
    if (!original || !pasted) throw new Error('畫面上找不到影片')
    const overlaps =
      pasted.x < original.x + original.width &&
      pasted.x + pasted.width > original.x &&
      pasted.y < original.y + original.height &&
      pasted.y + pasted.height > original.y
    expect(overlaps).toBe(false)
    expect(freeVideo?.assetHash).toBe(
      (await graphOf(page)).nodes.find((n) => n.key === video)?.assetHash,
    )

    await page.getByTestId('palette-character').click()
    await expect.poll(async () => (await ofKind(page, 'character')).length).toBe(1)
    const [hero] = await ofKind(page, 'character')
    if (!hero) throw new Error('沒有角色')
    await center(page, hero.key)
    await card(page, hero.key).click({ button: 'right', position: { x: 60, y: 14 } })
    await page.getByRole('menuitem', { name: /^複製/ }).first().click()

    await clickEmpty(page)
    const at = await emptyPoint(page)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await page.getByRole('menuitem', { name: /貼上/ }).click()
    await expect.poll(async () => (await ofKind(page, 'character')).length).toBe(2)
    const copy = (await ofKind(page, 'character')).find((c) => c.title === `${hero.title} 副本`)
    expect(copy).toBeDefined()
    const box = await card(page, copy?.key ?? '').boundingBox()
    if (!box) throw new Error('畫面上找不到副本')
    // 左上角就在按右鍵的地方附近（對齊格線）
    expect(Math.abs(box.x - at.x)).toBeLessThan(40)
    expect(Math.abs(box.y - at.y)).toBeLessThan(40)
  })

  test('便條 Ctrl+D 再做一份：原樣複製、往右下錯開（擠就挪到旁邊的空位）；剪輯不能複製', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-note').click()
    await expect.poll(async () => (await ofKind(page, 'note')).length).toBe(1)
    const [note] = await ofKind(page, 'note')
    if (!note) throw new Error('沒有便條')
    await center(page, note.key)
    await card(page, note.key).click({ position: { x: 30, y: 10 } })
    await page.keyboard.press('ControlOrMeta+d')
    await expect.poll(async () => (await ofKind(page, 'note')).length).toBe(2)
    const copy = (await ofKind(page, 'note')).find((n) => n.key !== note.key)
    // 往右下錯開 40；那裡太擠就挪到最近的空位（不會跑遠）
    expect(copy?.x).not.toBeUndefined()
    expect(Math.abs((copy?.x ?? 0) - (note.x + 40))).toBeLessThanOrEqual(80)
    expect(Math.abs((copy?.y ?? 0) - (note.y + 40))).toBeLessThanOrEqual(80)
    expect({ x: copy?.x, y: copy?.y }).not.toEqual({ x: note.x, y: note.y })

    await center(page, 'cut')
    await card(page, 'cut').click({ position: { x: 60, y: 14 } })
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByTestId('toast').filter({ hasText: '先選取要複製的格子' })).toBeVisible()
  })
})
