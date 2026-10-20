import type { Page } from '@playwright/test'

import {
  canvasEdges,
  canvasNodes,
  centerOn,
  generateAndOpenCanvas,
  kindCount,
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
const centerOf = async (page: Page, testId: string): Promise<{ x: number; y: number }> => {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`畫面上找不到 ${testId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const add = async (page: Page, body: Record<string, unknown>): Promise<string> => {
  const result = await page.evaluate((b) => window.svs.invoke('canvas.add', b as never), body)
  if (!result.ok) throw new Error(result.error.userMessage)
  return (result.data as { key: string }).key
}
const link = async (page: Page, source: [string, string], target: [string, string]) => {
  const result = await page.evaluate(
    ([s, t]) =>
      window.svs.invoke('canvas.link', {
        source: { key: s[0], port: s[1] },
        target: { key: t[0], port: t[1] },
      }),
    [source, target] as const,
  )
  if (!result.ok) throw new Error(result.error.userMessage)
}
const shotsOf = async (page: Page) => {
  const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!listed.ok) throw new Error(listed.error.userMessage)
  return listed.data.shots
}
const dragTo = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> => {
  await page.mouse.move(from.x, from.y, { steps: 5 })
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.up()
}
/** 這條線兩端的「改接」圓圈（藏在線的端點外側，平常透明）。 */
const updaterOf = async (page: Page, edgeId: string, end: 'source' | 'target') => {
  const box = await page
    .locator(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-${end}`)
    .boundingBox()
  if (!box) throw new Error('找不到改接的圓圈')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('畫布：拖線的一端改接、新線取代舊線', () => {
  test('拖角色線的一端到另一個鏡頭：舊線拿掉、新線接上，同一步復原；固定的線（鏡頭→圖）沒有改接圓圈', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const hero = await add(page, { kind: 'character', x: 40, y: 700 })
    const [first, second] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first || !second) throw new Error('鏡頭不夠')
    await link(page, [hero, 'char-out'], [first.id, 'shot-ref-char'])
    await fitAll(page)
    const edgeId = `${hero}:char-out->${first.id}:shot-ref-char`
    await expect(page.locator(`.react-flow__edge[data-id="${edgeId}"]`)).toHaveCount(1)

    // 固定的線沒有改接的圓圈；能改接的有
    expect(await page.locator('.react-flow__edgeupdater').count()).toBe(2)

    const from = await updaterOf(page, edgeId, 'target')
    await dragTo(page, from, await centerOf(page, `port-${second.id}-shot-ref-char`))
    await expect(page.getByTestId('toast').filter({ hasText: '已改接' })).toBeVisible()
    await expect
      .poll(async () => (await shotsOf(page)).map((s) => s.characters))
      .toEqual([[], ['新角色'], []])
    await expect
      .poll(async () => (await canvasEdges(page)).map((e) => e.id))
      .toContain(`${hero}:char-out->${second.id}:shot-ref-char`)
    expect((await canvasEdges(page)).map((e) => e.id)).not.toContain(edgeId)

    // 一步復原：回到接在第一鏡
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await shotsOf(page)).map((s) => s.characters))
      .toEqual([['新角色'], [], []])
  })

  test('拖到接不上的地方：線留在原處、說一聲；放在空白處不會開新增選單', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const hero = await add(page, { kind: 'character', x: 40, y: 700 })
    const first = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
    if (!first) throw new Error('沒有鏡頭')
    await link(page, [hero, 'char-out'], [first.id, 'shot-ref-char'])
    await fitAll(page)
    const edgeId = `${hero}:char-out->${first.id}:shot-ref-char`
    const from = await updaterOf(page, edgeId, 'target')
    // 放在畫面上的一塊空白（左下角）
    await dragTo(page, from, { x: 300, y: 820 })
    await expect(page.getByTestId('add-menu')).toHaveCount(0)
    expect((await shotsOf(page)).some((s) => s.characters.length > 0)).toBe(true)
    expect((await canvasEdges(page)).map((e) => e.id)).toContain(edgeId)
    await expect(page.getByTestId('connect-hint')).toContainText('線留在原處')
  })

  test('新拉一條地點線到已經有地點的場：取代原本那條（不用先剪線），提示說原本的拿掉了，一步復原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const home = await add(page, { kind: 'location', x: 40, y: 700 })
    const street = await add(page, { kind: 'location', x: 320, y: 700 })
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    if (!scene) throw new Error('沒有場')
    await link(page, [home, 'loc-out'], [scene.id, 'scene-loc'])
    await fitAll(page)
    await centerOn(page, scene.id)
    await fitAll(page)
    expect((await canvasEdges(page)).map((e) => e.id)).toContain(
      `${home}:loc-out->${scene.id}:scene-loc`,
    )

    await dragTo(
      page,
      await centerOf(page, `port-${street}-loc-out`),
      await centerOf(page, `port-${scene.id}-scene-loc`),
    )
    await expect(page.getByTestId('toast').filter({ hasText: '拿掉了' })).toBeVisible()
    await expect
      .poll(async () => (await canvasEdges(page)).map((e) => e.id))
      .toEqual(expect.arrayContaining([`${street}:loc-out->${scene.id}:scene-loc`]))
    expect((await canvasEdges(page)).map((e) => e.id)).not.toContain(
      `${home}:loc-out->${scene.id}:scene-loc`,
    )

    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await canvasEdges(page)).map((e) => e.id))
      .toContain(`${home}:loc-out->${scene.id}:scene-loc`)
    expect((await canvasEdges(page)).map((e) => e.id)).not.toContain(
      `${street}:loc-out->${scene.id}:scene-loc`,
    )
    expect(await kindCount(page, 'location')).toBe(2)
  })
})
