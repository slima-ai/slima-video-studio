import type { Page } from '@playwright/test'

import {
  canvasNodes,
  generateAndOpenCanvas,
  kindCount,
  viewportSettled,
  type FlowNode,
} from './canvas-helpers'
import { expect, test } from './fixtures'

/** 這個節點在畫面上的標題列位置（拖它的地方）。 */
async function titlePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`rf__node-${id}`).boundingBox()
  if (!box) throw new Error(`畫面上找不到節點 ${id}`)
  return { x: box.x + 60, y: box.y + 16 }
}

async function dragBy(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  options: { release?: boolean; alt?: boolean } = {},
): Promise<void> {
  if (options.alt) await page.keyboard.down('Alt')
  await page.mouse.move(from.x, from.y, { steps: 5 })
  await page.mouse.down()
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 12 })
  if (options.release !== false) {
    await page.mouse.up()
    if (options.alt) await page.keyboard.up('Alt')
  }
}

const shotsOf = async (page: Page): Promise<FlowNode[]> =>
  (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
const nodeById = async (page: Page, id: string): Promise<FlowNode> => {
  const found = (await canvasNodes(page)).find((n) => n.id === id)
  if (!found) throw new Error(`沒有節點 ${id}`)
  return found
}
/** 放大到看得清楚，再把全部放進畫面。 */
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

test.describe('畫布：拖移存位置', () => {
  test('拖鏡頭：圖與影片整串跟著動，重新載入後位置還在，Cmd/Ctrl+Z 回到原位', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    const [first] = await shotsOf(page)
    if (!first) throw new Error('沒有鏡頭')
    const image = await nodeById(page, `${first.id}:image`)
    const video = await nodeById(page, `${first.id}:video`)

    await dragBy(page, await titlePoint(page, first.id), { x: 80, y: 60 })
    await expect
      .poll(async () => (await nodeById(page, first.id)).position.x)
      .toBeGreaterThan(first.position.x + 40)
    const moved = await nodeById(page, first.id)
    const movedImage = await nodeById(page, image.id)
    const movedVideo = await nodeById(page, video.id)
    // 整串保持彼此的相對位置
    expect(movedImage.position.x - moved.position.x).toBeCloseTo(
      image.position.x - first.position.x,
      5,
    )
    expect(movedVideo.position.y - moved.position.y).toBeCloseTo(
      video.position.y - first.position.y,
      5,
    )

    // 存在資料庫：重新載入還在
    await page.reload()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect.poll(async () => (await nodeById(page, first.id)).position).toEqual(moved.position)
    await expect
      .poll(async () => (await nodeById(page, video.id)).position)
      .toEqual(movedVideo.position)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await nodeById(page, first.id)).position).toEqual(first.position)
    await expect.poll(async () => (await nodeById(page, video.id)).position).toEqual(video.position)
  })

  test('按著 Alt 拖：只動這一個節點，圖與影片留在原地', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    const [first] = await shotsOf(page)
    if (!first) throw new Error('沒有鏡頭')
    const image = await nodeById(page, `${first.id}:image`)
    await dragBy(page, await titlePoint(page, first.id), { x: 0, y: 150 }, { alt: true })
    await expect
      .poll(async () => (await nodeById(page, first.id)).position.y)
      .toBeGreaterThan(first.position.y + 100)
    // 存好重新載入之後也一樣：沒動的圖留在原地，不會跟著鏡頭跑
    await page.reload()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect
      .poll(async () => (await nodeById(page, first.id)).position.y)
      .toBeGreaterThan(first.position.y + 100)
    expect((await nodeById(page, image.id)).position).toEqual(image.position)
  })

  test('跟手：按下去的那一點一直在游標下，不會落後一段（拖動門檻那幾 px 也算進去）', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    await viewportSettled(page)
    const [first] = await shotsOf(page)
    if (!first) throw new Error('沒有鏡頭')
    const card = page.getByTestId(`node-${first.id}`)
    const before = await card.boundingBox()
    if (!before) throw new Error('畫面上找不到鏡頭')
    const from = await titlePoint(page, first.id)
    // Alt：不吸附格線，才能逐 px 比
    await page.keyboard.down('Alt')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // 第一下就移 12px（超過門檻才開始拖），之後再慢慢移
    await page.mouse.move(from.x + 12, from.y + 9)
    await page.mouse.move(from.x + 140, from.y + 90, { steps: 10 })
    await expect
      .poll(async () => {
        const now = await card.boundingBox()
        return now ? Math.round(Math.hypot(now.x - before.x - 140, now.y - before.y - 90)) : -1
      })
      .toBeLessThanOrEqual(1)
    await page.mouse.up()
    await page.keyboard.up('Alt')
  })

  test('拖動中靠近別的節點的邊緣會出現對齊線並吸附，放開就消失', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    const [first, second] = await shotsOf(page)
    if (!first || !second) throw new Error('鏡頭不夠')
    // 往右偏幾 px：左緣離第一個鏡頭的左緣很近，會吸附成同一條線
    await dragBy(page, await titlePoint(page, second.id), { x: 3, y: 40 }, { release: false })
    await expect(page.getByTestId('guide').first()).toBeAttached()
    await page.mouse.up()
    await expect(page.getByTestId('guide')).toHaveCount(0)
    await expect
      .poll(async () => (await nodeById(page, second.id)).position.x)
      .toBe(first.position.x)
  })

  test('縮小時也一樣吸附對齊：對齊別的格子優先，不會先被格線推到對齊範圍外', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    // 縮到 0.3：一格格線（16）在畫面上很寬，移 3px 就可能被推到下一格
    await page.evaluate(() => {
      const rf = (
        window as unknown as {
          __svsCanvas?: {
            getViewport: () => { x: number; y: number; zoom: number }
            setViewport: (v: object) => unknown
          }
        }
      ).__svsCanvas
      const v = rf?.getViewport()
      if (v) void rf?.setViewport({ ...v, zoom: 0.3 })
    })
    await viewportSettled(page)
    const [first, second] = await shotsOf(page)
    if (!first || !second) throw new Error('鏡頭不夠')
    // 縮小時格子只有 69px 寬：抓內文的地方（標題列右邊是按鈕，按住按鈕不會拖動）
    const box = await page.getByTestId(`rf__node-${second.id}`).boundingBox()
    if (!box) throw new Error('畫面上找不到鏡頭')
    await dragBy(page, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.6 }, { x: 3, y: 40 })
    // 真的拖動了（往下），左緣仍對齊上一鏡
    await expect
      .poll(async () => (await nodeById(page, second.id)).position.y)
      .toBeGreaterThan(second.position.y + 60)
    expect((await nodeById(page, second.id)).position.x).toBe(first.position.x)
  })

  test('拖場框的標題列：整個場的鏡頭一起動；原本的位置存下來', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    const before = await shotsOf(page)
    const frame = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!frame) throw new Error('沒有場框')
    const grip = await page
      .getByTestId(`rf__node-${frame.id}`)
      .locator('.svs-frame-title')
      .boundingBox()
    if (!grip) throw new Error('找不到場框的標題列')
    await dragBy(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: 0, y: 90 })
    await expect
      .poll(async () => (await shotsOf(page))[0]?.position.y ?? 0)
      .toBeGreaterThan((before[0]?.position.y ?? 0) + 40)
    const after = await shotsOf(page)
    const dy = (after[0]?.position.y ?? 0) - (before[0]?.position.y ?? 0)
    for (const [index, shot] of after.entries()) {
      expect(shot.position.y - (before[index]?.position.y ?? 0)).toBeCloseTo(dy, 5)
    }
  })

  test('把鏡頭拖進另一個場：目標框亮起並提示，放開後改場、鏡號重排、toast 可以復原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await page.getByTestId('palette-scene').click()
    await expect.poll(() => kindCount(page, 'scene')).toBe(2)
    // 新增的場會把畫面平移過去（動畫）；等它停了再全部顯示、再量位置，不然量到的是動畫中的位置
    await viewportSettled(page)
    await fitAll(page)
    await viewportSettled(page)
    const scenes = (await canvasNodes(page)).filter((n) => n.data.kind === 'scene')
    const [firstScene, secondScene] = scenes
    if (!firstScene || !secondScene) throw new Error('場不夠')
    const [shot] = await shotsOf(page)
    if (!shot) throw new Error('沒有鏡頭')
    expect(shot.data.sceneId).toBe(firstScene.id)

    const target = await page.getByTestId(`rf__node-${secondScene.id}`).boundingBox()
    if (!target) throw new Error('找不到第二個場框')
    const from = await titlePoint(page, shot.id)
    await dragBy(
      page,
      from,
      { x: target.x + target.width / 2 - from.x, y: target.y + target.height / 2 - from.y },
      { release: false },
    )
    await expect(page.getByTestId('drop-hint')).toContainText('放開後移到第 2 場')
    await page.mouse.up()
    const moved = page.getByTestId('toast').filter({ hasText: '已移到第 2 場' })
    await expect(moved).toBeVisible()
    await expect.poll(async () => (await nodeById(page, shot.id)).data.sceneId).toBe(secondScene.id)
    // 鏡號依場的順序重排：被移走的第 1 鏡現在是第 3 鏡
    await expect.poll(async () => (await nodeById(page, shot.id)).data.title).toBe('第 3 鏡')
    await expect(page.getByTestId('drop-hint')).toHaveCount(0)

    await moved.getByTestId('toast-action').click()
    await expect.poll(async () => (await nodeById(page, shot.id)).data.sceneId).toBe(firstScene.id)
    await expect.poll(async () => (await nodeById(page, shot.id)).data.title).toBe('第 1 鏡')
  })

  test('只是點一下節點不算移動：不留下復原紀錄', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(async () => (await shotsOf(page)).length).toBe(3)
    await fitAll(page)
    // 生成本身是一筆可以復原的動作；點一下之後，最近一筆還是它、步數不變
    const undo = page.getByTestId('undo')
    await expect(undo).toHaveAttribute('aria-label', '復原：一句話生成')
    const steps = await page.getByTestId('undo-count').textContent()
    const [first] = await shotsOf(page)
    if (!first) throw new Error('沒有鏡頭')
    const point = await titlePoint(page, first.id)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator(`.react-flow__node[data-id="${first.id}"]`)).toHaveClass(/selected/)
    await expect(undo).toHaveAttribute('aria-label', '復原：一句話生成')
    await expect(page.getByTestId('undo-count')).toHaveText(steps ?? '')
  })
})
