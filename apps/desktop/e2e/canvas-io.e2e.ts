import type { Page } from '@playwright/test'

import { canvasNodes, centerOn, generateAndOpenCanvas, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

const firstOf = async (page: Page, kind: string): Promise<string> => {
  const node = (await canvasNodes(page)).find((n) => n.data.kind === kind)
  if (!node) throw new Error(`沒有 ${kind}`)
  return node.id
}
const bg = (page: Page, testId: string): Promise<string> =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor)

test.describe('畫布節點上的「吃／出」', () => {
  test('鏡頭、第一張畫面、影片的卡片上有一行「吃：…　出：…」，名字跟連接點一致；接上的亮、沒接的淡；圓點依傳的東西上色', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const shot = await firstOf(page, 'shot')
    const image = await firstOf(page, 'image')
    const video = await firstOf(page, 'video')

    await centerOn(page, shot)
    const shotIo = page.getByTestId(`node-${shot}`).getByTestId('node-io')
    await expect(shotIo).toContainText('吃：')
    await expect(shotIo).toContainText('角色')
    await expect(shotIo).toContainText('地點')
    await expect(shotIo).toContainText('出：')
    await expect(shotIo).toContainText('畫面描述')
    // 還沒接角色、地點：淡淡的
    await expect(shotIo.getByTestId('io-shot-ref-char')).toHaveAttribute('data-linked', 'false')

    await centerOn(page, image)
    const imageIo = page.getByTestId(`node-${image}`).getByTestId('node-io')
    await expect(imageIo).toContainText('吃：鏡頭')
    await expect(imageIo).toContainText('出：')
    // 鏡頭的描述已經接進來了
    await expect(imageIo.getByTestId('io-img-in')).toHaveAttribute('data-linked', 'true')
    await expect(imageIo.getByTestId('io-img-ref')).toHaveAttribute('data-linked', 'false')
    // 連接點的顏色：鏡頭的描述（綠）、參考（灰）、第一張畫面（紫）
    expect(await bg(page, `port-${image}-img-in`)).toBe('rgb(16, 185, 129)')
    expect(await bg(page, `port-${image}-img-ref`)).toBe('rgb(156, 163, 175)')
    expect(await bg(page, `port-${image}-img-out`)).toBe('rgb(139, 92, 246)')

    await centerOn(page, video)
    const videoIo = page.getByTestId(`node-${video}`).getByTestId('node-io')
    await expect(videoIo).toContainText('吃：第一張畫面')
    await expect(videoIo).toContainText('出：影片')
    expect(await bg(page, `port-${video}-vid-in`)).toBe('rgb(139, 92, 246)')
  })

  test('「沒歸場」的標記放在鏡頭的說明那一行，不會把標題擠成「第 1…」', async ({ page }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    const created = await page.evaluate(() => window.svs.invoke('shots.create', {}))
    if (!created.ok) throw new Error(created.error.userMessage)
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
    const scene = await firstOf(page, 'scene')
    await page.evaluate((key) => window.svs.invoke('canvas.remove', { keys: [key] }), scene)
    await expect(page.getByTestId('loose-badge')).toHaveCount(1)

    const shot = await firstOf(page, 'shot')
    await centerOn(page, shot)
    const card = page.getByTestId(`node-${shot}`)
    await expect(card.getByTestId('loose-badge')).toBeVisible()
    const title = card.locator('b span.truncate').first()
    await expect(title).toHaveText(/^第 \d+ 鏡$/)
    // 標題一個字都沒被截掉
    const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(clipped).toBe(false)
  })
})

test.describe('節點標題完整、帶鏡頭號', () => {
  test('圖與影片的標題是「第 N 鏡・第一張畫面」「第 N 鏡・影片」；每個鏡頭、圖、影片的標題都沒有被截斷，標記（需要重跑、生成中）也不擠掉標題', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const nodes = await canvasNodes(page)
    const shots = nodes.filter((n) => n.data.kind === 'shot')
    expect(shots.length).toBeGreaterThan(0)
    for (const [index, shot] of shots.entries()) {
      const number = shot.data.title.replace(/\D/g, '')
      expect(nodes.find((n) => n.id === `${shot.id}:image`)?.data.title).toBe(
        `第 ${number} 鏡・第一張畫面`,
      )
      expect(nodes.find((n) => n.id === `${shot.id}:video`)?.data.title).toBe(
        `第 ${number} 鏡・影片`,
      )
      expect(index + 1).toBe(Number(number))
    }

    // 改一鏡的描述：這一鏡的圖和影片標「需要重跑」，標題還是完整的
    const first = shots[0]
    if (!first) throw new Error('沒有鏡頭')
    const edited = await page.evaluate(
      (id) =>
        window.svs.invoke('shots.update', {
          shotId: id.replace(/^shot:/, ''),
          patch: { description: '改過的描述，圖與影片要重跑' },
        }),
      first.id,
    )
    if (!edited.ok) throw new Error(edited.error.userMessage)
    await expect
      .poll(
        async () =>
          (await canvasNodes(page)).find((n) => n.id === `${first.id}:image`)?.data.status,
      )
      .toBe('stale')

    for (const node of (await canvasNodes(page)).filter((n) =>
      ['shot', 'image', 'video'].includes(n.data.kind),
    )) {
      await centerOn(page, node.id)
      const title = page.getByTestId(`node-${node.id}`).locator('b span.truncate').first()
      await expect(title).toHaveText(node.data.title)
      const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(clipped, `${node.data.title} 被截斷`).toBe(false)
    }
    // 「需要重跑」在內文那一行
    const imageCard = page.getByTestId(`node-${first.id}:image`)
    await centerOn(page, `${first.id}:image`)
    await expect(imageCard).toContainText('需要重跑')
  })

  test('兩位數的鏡頭號也放得下：第 12 鏡的圖、影片標題完整', async ({ page }) => {
    await generateAndOpenCanvas(page)
    for (let i = 0; i < 9; i += 1) {
      const made = await page.evaluate(() => window.svs.invoke('shots.create', {}))
      if (!made.ok) throw new Error(made.error.userMessage)
    }
    await expect.poll(() => kindCount(page, 'shot')).toBe(12)
    const last = (await canvasNodes(page)).find((n) => n.data.title === '第 12 鏡')
    if (!last) throw new Error('沒有第 12 鏡')
    for (const id of [last.id, `${last.id}:image`, `${last.id}:video`]) {
      await centerOn(page, id)
      const title = page.getByTestId(`node-${id}`).locator('b span.truncate').first()
      await expect(title).toContainText('第 12 鏡')
      expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
    }
  })
})
