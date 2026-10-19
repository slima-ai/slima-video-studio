import type { Page } from '@playwright/test'

import { canvasNodes, generateAndOpenCanvas, hoverThenClick, kindCount } from './canvas-helpers'
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

async function centerOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`畫面上找不到 ${testId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function dragPort(
  page: Page,
  from: string,
  to: { x: number; y: number },
  release = true,
): Promise<void> {
  const start = await centerOf(page, from)
  await page.mouse.move(start.x, start.y, { steps: 5 })
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 15 })
  if (release) await page.mouse.up()
}

/** 用一句話生一支影片，再用節點面板加一個角色，整個放進畫面。 */
async function withCharacter(page: Page): Promise<{ hero: string; shot: string; video: string }> {
  await generateAndOpenCanvas(page)
  await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  await page.getByTestId('palette-character').click()
  await expect.poll(() => kindCount(page, 'character')).toBe(1)
  await fitAll(page)
  const nodes = await canvasNodes(page)
  const hero = nodes.find((n) => n.data.kind === 'character')
  const shot = nodes.find((n) => n.data.kind === 'shot')
  const video = nodes.find((n) => n.data.kind === 'video')
  if (!hero || !shot || !video) throw new Error('節點不齊')
  return { hero: hero.id, shot: shot.id, video: video.id }
}

/** 滑到某條線的中點（線有時是水平的、沒有高度，Playwright 的 hover 點不到，所以自己算位置）。 */
async function hoverEdgeMiddle(page: Page, which: 'reference' | 'main'): Promise<void> {
  const point = await page.evaluate((kind) => {
    const selector = kind === 'reference' ? '.svs-edge-ref' : '.svs-edge-flow'
    const hit = document.querySelector(`.react-flow__edge ${selector}`)
    const path = hit?.parentElement?.querySelector<SVGPathElement>('.react-flow__edge-interaction')
    if (!path) return undefined
    const mid = path.getPointAtLength(path.getTotalLength() / 2)
    const screen = mid.matrixTransform(path.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  }, which)
  if (!point) throw new Error('找不到線')
  await page.mouse.move(point.x - 30, point.y - 30)
  await page.mouse.move(point.x, point.y, { steps: 6 })
}

const tagsOf = async (page: Page, id: string): Promise<string[]> =>
  (await canvasNodes(page)).find((n) => n.id === id)?.data.tags ?? []

test.describe('畫布：拉線、剪線與刪除', () => {
  test('角色拉到鏡頭：出場角色多一個；重複拉會提示；Cmd/Ctrl+Z 復原', async ({ page }) => {
    const { hero, shot } = await withCharacter(page)
    await dragPort(
      page,
      `port-${hero}-char-out`,
      await centerOf(page, `port-${shot}-shot-ref-char`),
    )
    await expect.poll(() => tagsOf(page, shot)).toEqual(['新角色'])
    await expect(page.getByTestId('toast').filter({ hasText: '加進' })).toBeVisible()

    // 已經在這一鏡：放開在同一個點，旁邊出一行白話提示
    await dragPort(
      page,
      `port-${hero}-char-out`,
      await centerOf(page, `port-${shot}-shot-ref-char`),
    )
    await expect(page.getByTestId('connect-hint')).toContainText('新角色已經在這一鏡')
    expect(await tagsOf(page, shot)).toEqual(['新角色'])

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => tagsOf(page, shot)).toEqual([])
  })

  test('拉線中：接得上的點亮綠、接不上的淡掉；放在接不上的點旁邊說明原因，什麼都不接', async ({
    page,
  }) => {
    const { hero, shot, video } = await withCharacter(page)
    await dragPort(
      page,
      `port-${hero}-char-out`,
      await centerOf(page, `port-${video}-vid-in`),
      false,
    )
    await expect(page.getByTestId(`port-${shot}-shot-ref-char`)).toHaveAttribute(
      'data-link',
      'valid',
    )
    await expect(page.getByTestId(`port-${video}-vid-in`)).toHaveAttribute('data-link', 'invalid')
    await page.mouse.up()
    await expect(page.getByTestId('connect-hint')).toContainText('角色只能接到鏡頭')
    expect(await tagsOf(page, shot)).toEqual([])
  })

  test('從輸出點拉到空白處放開：選單只列接得上的，選鏡頭就長出已經帶著這個角色的新鏡頭', async ({
    page,
  }) => {
    const { hero } = await withCharacter(page)
    const start = await centerOf(page, `port-${hero}-char-out`)
    await dragPort(page, `port-${hero}-char-out`, { x: start.x + 60, y: start.y + 360 })
    const menu = page.getByTestId('add-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('option', { name: /鏡頭/ }).click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shots.some((n) => n.data.tags?.includes('新角色'))).toBe(true)
  })

  test('線中點的「×」剪掉資料關係：鏡頭少一個出場角色，可以復原', async ({ page }) => {
    const { hero, shot } = await withCharacter(page)
    await dragPort(
      page,
      `port-${hero}-char-out`,
      await centerOf(page, `port-${shot}-shot-ref-char`),
    )
    await expect.poll(() => tagsOf(page, shot)).toEqual(['新角色'])
    await hoverThenClick(
      () => hoverEdgeMiddle(page, 'reference'),
      page.getByRole('button', { name: '剪掉這條線' }),
    )
    await expect.poll(() => tagsOf(page, shot)).toEqual([])
    await page.getByTestId('undo').click()
    await expect.poll(() => tagsOf(page, shot)).toEqual(['新角色'])
  })

  test('固定的線（鏡頭→圖→影片）沒有「×」', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await fitAll(page)
    await hoverEdgeMiddle(page, 'main')
    await expect(page.locator('.svs-edge-flow').first()).toHaveAttribute('data-state', 'hover')
    await expect(page.getByRole('button', { name: '剪掉這條線' })).toHaveCount(0)
  })

  test('刪除鏡頭：先確認，連同圖與影片一起消失、鏡號重排；Cmd/Ctrl+Z 復原', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await fitAll(page)
    const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first) throw new Error('沒有鏡頭')
    await page.getByTestId(`rf__node-${first.id}`).click({ position: { x: 60, y: 16 } })
    await page.keyboard.press('Delete')
    const dialog = page.getByTestId('delete-confirm')
    await expect(dialog).toContainText('連同它們的圖和影片版本')
    // 取消：什麼都沒刪
    await dialog.getByRole('button', { name: '取消' }).click()
    expect(await kindCount(page, 'shot')).toBe(3)

    await page.keyboard.press('Delete')
    await page.getByTestId('delete-confirm-ok').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(2)
    expect(await kindCount(page, 'image')).toBe(2)
    expect(await kindCount(page, 'video')).toBe(2)
    const titles = (await canvasNodes(page))
      .filter((n) => n.data.kind === 'shot')
      .map((n) => n.data.title)
    expect(titles).toEqual(['第 1 鏡', '第 2 鏡'])

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    expect(await kindCount(page, 'video')).toBe(3)
  })

  test('刪除角色：出場的鏡頭一起拿掉它；復原後角色與出場關係都回來', async ({ page }) => {
    const { hero, shot } = await withCharacter(page)
    await dragPort(
      page,
      `port-${hero}-char-out`,
      await centerOf(page, `port-${shot}-shot-ref-char`),
    )
    await expect.poll(() => tagsOf(page, shot)).toEqual(['新角色'])
    await page.getByTestId(`rf__node-${hero}`).click({ position: { x: 60, y: 16 } })
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('delete-confirm')).toContainText('出場的鏡頭會拿掉這個角色')
    await expect(page.getByTestId('delete-confirm')).toContainText('可以按「復原」')
    await page.getByTestId('delete-confirm-ok').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(0)
    await expect.poll(() => tagsOf(page, shot)).toEqual([])
    await page.getByTestId('undo').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    await expect.poll(() => tagsOf(page, shot)).toEqual(['新角色'])
  })

  test('單獨選影片按 Delete：清掉採用中的版本（不用確認），影片格子和鏡頭都留著', async ({
    page,
  }) => {
    const { video } = await withCharacter(page)
    await page.getByTestId(`rf__node-${video}`).click({ position: { x: 60, y: 16 } })
    await page.keyboard.press('Delete')
    await expect(
      page.getByTestId('toast').filter({ hasText: '已清掉採用中的版本（版本還在生成紀錄裡）' }),
    ).toBeVisible()
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
    expect(await kindCount(page, 'video')).toBe(3)
    expect(await kindCount(page, 'shot')).toBe(3)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === video)?.data.status)
      .toBe('idle')
  })
})
