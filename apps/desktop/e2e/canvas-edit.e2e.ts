import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

const toast = (page: Page) => page.getByTestId('toast')
const nodeByKind = async (page: Page, kind: string) => {
  const node = (await canvasNodes(page)).find((n) => n.data.kind === kind)
  if (!node) throw new Error(`沒有 ${kind}`)
  return node
}
const titleOf = async (page: Page, id: string): Promise<string> =>
  (await canvasNodes(page)).find((n) => n.id === id)?.data.title ?? ''
const add = async (page: Page, body: Record<string, unknown>): Promise<string> => {
  const result = await page.evaluate((b) => window.svs.invoke('canvas.add', b as never), body)
  if (!result.ok) throw new Error(result.error.userMessage)
  return (result.data as { key: string }).key
}

test.describe('畫布：雙擊就地改名、改鏡頭描述', () => {
  test('雙擊場、角色、地點、群組的標題：輸入框蓋在標題上，Enter 存、Esc 放棄；提示附復原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const scene = await nodeByKind(page, 'scene')
    const character = await add(page, { kind: 'character', x: 40, y: 700 })
    const location = await add(page, { kind: 'location', x: 320, y: 700 })
    const group = await add(page, { kind: 'group', x: 40, y: 1000, width: 300, height: 160 })

    // 場：標題是「第 N 場・名字」，輸入框只放名字
    await centerOn(page, scene.id)
    await page.locator(`.react-flow__node[data-id="${scene.id}"] .svs-frame-title`).dblclick()
    const box = page.getByTestId('rename-box')
    await expect(box).toBeVisible()
    await box.fill('雨夜的巷口')
    await box.press('Enter')
    await expect(toast(page)).toContainText('已改名為「雨夜的巷口」')
    await expect.poll(() => titleOf(page, scene.id)).toContain('雨夜的巷口')

    // 復原
    await toast(page).getByRole('button', { name: '復原' }).click()
    await expect.poll(() => titleOf(page, scene.id)).not.toContain('雨夜的巷口')

    // 角色、地點、群組
    for (const [key, name] of [
      [character, '小花'],
      [location, '老車站'],
      [group, '夜景'],
    ] as const) {
      await centerOn(page, key)
      const target = page
        .locator(`.react-flow__node[data-id="${key}"]`)
        .locator('[title="雙擊改名"]')
        .first()
      await target.dblclick()
      await expect(page.getByTestId('rename-box')).toBeVisible()
      await page.getByTestId('rename-box').fill(name)
      await page.getByTestId('rename-box').press('Enter')
      await expect.poll(() => titleOf(page, key)).toBe(name)
    }

    // Esc 放棄：名字不變、沒有輸入框
    await centerOn(page, character)
    await page
      .locator(`.react-flow__node[data-id="${character}"]`)
      .locator('[title="雙擊改名"]')
      .first()
      .dblclick()
    await page.getByTestId('rename-box').fill('不要存')
    await page.getByTestId('rename-box').press('Escape')
    await expect(page.getByTestId('rename-box')).toHaveCount(0)
    expect(await titleOf(page, character)).toBe('小花')
  })

  test('雙擊鏡頭的描述就地改：Enter 存（附復原、說明要重跑）、Esc 放棄、清空不存；雙擊鏡頭標題還是置中', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const shot = await nodeByKind(page, 'shot')
    await centerOn(page, shot.id)
    const card = page.locator(`.react-flow__node[data-id="${shot.id}"]`)
    const before = await card.getByTestId('shot-desc').innerText()

    // Esc 放棄
    await card.getByTestId('shot-desc').dblclick()
    await card.getByTestId('shot-desc-edit').fill('這個不會存')
    await card.getByTestId('shot-desc-edit').press('Escape')
    await expect(card.getByTestId('shot-desc')).toHaveText(before)

    // 清空不存
    await card.getByTestId('shot-desc').dblclick()
    await card.getByTestId('shot-desc-edit').fill('   ')
    await card.getByTestId('shot-desc-edit').press('Enter')
    await expect(card.getByTestId('shot-desc')).toHaveText(before)

    // Enter 存
    await card.getByTestId('shot-desc').dblclick()
    await card.getByTestId('shot-desc-edit').fill('貓縮在紙箱裡，雨打在屋簷上')
    await card.getByTestId('shot-desc-edit').press('Enter')
    await expect(card.getByTestId('shot-desc')).toHaveText('貓縮在紙箱裡，雨打在屋簷上')
    await expect(toast(page)).toContainText('已改鏡頭描述')
    await expect(toast(page)).toContainText('要重跑才會用到')
    // 真的存進資料：鏡頭表也是新的描述
    const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!listed.ok) throw new Error(listed.error.userMessage)
    expect(listed.data.shots.some((s) => s.description === '貓縮在紙箱裡，雨打在屋簷上')).toBe(true)

    // 復原
    await toast(page).getByRole('button', { name: '復原' }).click()
    await expect(card.getByTestId('shot-desc')).toHaveText(before)

    // 雙擊鏡頭標題：照舊置中並縮放到 100%
    await card.getByText(shot.data.title, { exact: true }).first().dblclick()
    await expect(page.getByTestId('rename-box')).toHaveCount(0)
    await expect(card.getByTestId('shot-desc-edit')).toHaveCount(0)
  })

  test('鏡頭有動作才顯示「動作：…」，沒有就不留空位；清掉動作就消失', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const shot = await nodeByKind(page, 'shot')
    await centerOn(page, shot.id)
    const card = page.locator(`.react-flow__node[data-id="${shot.id}"]`)
    // 新做出來的鏡頭沒有動作：卡片上沒有這一行
    await expect(card.getByTestId('shot-desc')).toBeVisible()
    await expect(card.getByTestId('shot-action')).toHaveCount(0)

    const update = async (action: string): Promise<void> => {
      const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
      if (!listed.ok) throw new Error(listed.error.userMessage)
      const first = listed.data.shots[0]
      if (!first) throw new Error('沒有鏡頭')
      const result = await page.evaluate(
        ({ shotId, text }) =>
          window.svs.invoke('shots.update', { shotId, patch: { action: text } }),
        { shotId: first.id, text: action },
      )
      if (!result.ok) throw new Error(result.error.userMessage)
    }

    await update('貓向右跳一步，尾巴輕輕擺動')
    await expect(card.getByTestId('shot-action')).toHaveText('動作：貓向右跳一步，尾巴輕輕擺動')
    // 描述還在：動作是另外一行，不是取代描述
    await expect(card.getByTestId('shot-desc')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('shot-action-card.png') })

    await update('')
    await expect(card.getByTestId('shot-action')).toHaveCount(0)
  })

  test('指定尾幀：圖片格並排「首」「尾」兩張，影片格「吃：」多一個「尾幀」；沒有尾幀就沒有這些', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const image = await nodeByKind(page, 'image')
    const video = await nodeByKind(page, 'video')
    await centerOn(page, image.id)
    const imageCard = page.locator(`.react-flow__node[data-id="${image.id}"]`)
    const videoCard = page.locator(`.react-flow__node[data-id="${video.id}"]`)
    // 沒有尾幀：只有一張圖，「吃：」只有動作（沒寫動作＝不亮），沒有「尾幀」
    await expect(imageCard.getByTestId('frame-pair')).toHaveCount(0)
    await expect(videoCard.getByTestId('io-吃')).toContainText('動作')
    await expect(videoCard.getByTestId('io-吃')).not.toContainText('尾幀')
    await page.screenshot({ path: test.info().outputPath('end-frame-without.png') })

    const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!listed.ok) throw new Error(listed.error.userMessage)
    const first = listed.data.shots[0]
    const hash = first?.firstFrames[0]?.assetHash
    if (!first || !hash) throw new Error('沒有首幀圖')
    const set = await page.evaluate(
      ({ shotId, assetHash }) => window.svs.invoke('shots.setEndFrame', { shotId, assetHash }),
      { shotId: first.id, assetHash: hash },
    )
    if (!set.ok) throw new Error(set.error.userMessage)

    await expect(imageCard.getByTestId('frame-pair')).toBeVisible()
    await expect(imageCard.getByTestId('first-frame-thumb')).toContainText('首')
    await expect(imageCard.getByTestId('end-frame-thumb')).toContainText('尾')
    await expect(videoCard.getByTestId('io-吃')).toContainText('尾幀')
    await page.screenshot({ path: test.info().outputPath('end-frame-with.png') })

    // 拿掉尾幀：回到只有一張圖
    const cleared = await page.evaluate(
      ({ shotId }) => window.svs.invoke('shots.setEndFrame', { shotId, assetHash: null }),
      { shotId: first.id },
    )
    if (!cleared.ok) throw new Error(cleared.error.userMessage)
    await expect(imageCard.getByTestId('frame-pair')).toHaveCount(0)
    await expect(videoCard.getByTestId('io-吃')).not.toContainText('尾幀')
  })
})

/** 這個節點的標題列（拖它的地方）：場框與群組是各自的標題抓手，其他是卡片頂端。 */
async function grabPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const node = page.getByTestId(`rf__node-${id}`)
  const grip = node.locator('.svs-frame-title, .svs-group-grip').first()
  if ((await grip.count()) > 0) {
    // 場框與群組很寬：抓標題列的正中間（左邊可能被別的格子蓋住）
    const box = await grip.boundingBox()
    if (!box) throw new Error(`畫面上找不到節點 ${id}`)
    return { x: box.x + box.width / 2, y: box.y + 16 }
  }
  const box = await node.boundingBox()
  if (!box) throw new Error(`畫面上找不到節點 ${id}`)
  return { x: box.x + 60, y: box.y + 16 }
}

test.describe('畫布：每一種節點都拖得動', () => {
  test('一句話、場、鏡頭、圖、影片、剪輯、角色、地點、圖片、便條、群組：各拖一次，位置真的變了', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await add(page, { kind: 'character', x: 40, y: 760 })
    await add(page, { kind: 'location', x: 320, y: 760 })
    await add(page, { kind: 'note', x: 600, y: 760 })
    await add(page, { kind: 'group', x: 40, y: 1040, width: 300, height: 160 })
    const bytes = Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    const imported = await page.evaluate(
      (b) =>
        window.svs.invoke('canvas.importBytes', {
          name: '雨.png',
          mime: 'image/png',
          bytes: new Uint8Array(b),
          x: 620,
          y: 1040,
        }),
      bytes,
    )
    if (!imported.ok) throw new Error(imported.error.userMessage)

    const kinds = [
      'oneliner',
      'scene',
      'shot',
      'image',
      'video',
      'cut',
      'character',
      'location',
      'freeImage',
      'note',
      'group',
    ]
    for (const kind of kinds) {
      const node = await nodeByKind(page, kind)
      // 場框的位置是跟著裡面的鏡頭算出來的：拖場框，看第一個鏡頭有沒有跟著動
      const probe = kind === 'scene' ? await nodeByKind(page, 'shot') : node
      await centerOn(page, node.id)
      await viewportSettled(page)
      const from = await grabPoint(page, node.id)
      await page.mouse.move(from.x, from.y, { steps: 5 })
      await page.mouse.down()
      await page.mouse.move(from.x + 70, from.y + 50, { steps: 12 })
      await page.mouse.up()
      await expect
        .poll(
          async () => {
            const now = (await canvasNodes(page)).find((n) => n.id === probe.id)
            return now
              ? Math.hypot(now.position.x - probe.position.x, now.position.y - probe.position.y)
              : 0
          },
          { message: `${kind} 拖不動` },
        )
        .toBeGreaterThan(30)
    }
  })
})
