import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import { clickEmpty, generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 1×1 的 PNG。 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

const freeOf = async (page: Page, kind: string) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.nodes.filter((n) => n.kind === kind)
}

/** 讓主行程的選檔視窗直接回傳這些檔案（不用真的跳視窗）。 */
async function pickReturns(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  }, paths)
}

test.describe('畫布：放上圖片或影片', () => {
  test('左側面板「圖片或影片」：選好的圖片放成一格，看得到縮圖；Delete 直接刪、可以復原', async ({
    app,
    page,
    projectDir,
  }) => {
    await generateAndOpenCanvas(page)
    await viewportSettled(page)
    const file = join(projectDir, '雨夜的巷子.png')
    writeFileSync(file, Buffer.from(PNG_BASE64, 'base64'))
    await pickReturns(app, [file])

    await page.getByTestId('palette-freeImage').click()
    await expect.poll(async () => (await freeOf(page, 'free_image')).length).toBe(1)
    await expect(
      page.getByTestId('toast').filter({ hasText: '已放上「雨夜的巷子」' }),
    ).toBeVisible()
    const [image] = await freeOf(page, 'free_image')
    if (!image) throw new Error('沒有圖片')
    const card = page.locator(`.react-flow__node[data-id="${image.key}"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('雨夜的巷子')
    // 縮圖是存進專案的那個檔案
    await expect(card.locator('[style*="svs-asset://"]')).toHaveCount(1)

    await card.click({ position: { x: 30, y: 12 } })
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0)
    await expect.poll(async () => (await freeOf(page, 'free_image')).length).toBe(0)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => (await freeOf(page, 'free_image')).length).toBe(1)
  })

  test('從檔案總管拖進畫布：放在放開的地方（被佔住就挪到旁邊，場不會被推開）；不支援的檔案說明原因', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await viewportSettled(page)
    // 長完之後畫面停在卡上的字讀得到的縮放（整串放不進畫面）；這條要在右下角有一塊空地放東西，所以先全部顯示
    await page.getByRole('button', { name: '全部顯示' }).click()
    await viewportSettled(page)
    await clickEmpty(page)
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (!pane) throw new Error('沒有畫布')
    const at = { x: pane.x + pane.width - 260, y: pane.y + pane.height - 200 }
    const drop = (name: string, type: string, base64: string) =>
      page.evaluate(
        ({ name, type, base64, at }) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
          const transfer = new DataTransfer()
          transfer.items.add(new File([bytes], name, { type }))
          const target = document.elementFromPoint(at.x, at.y)
          for (const kind of ['dragenter', 'dragover', 'drop']) {
            target?.dispatchEvent(
              new DragEvent(kind, {
                bubbles: true,
                cancelable: true,
                clientX: at.x,
                clientY: at.y,
                dataTransfer: transfer,
              }),
            )
          }
        },
        { name, type, base64, at },
      )

    await drop('貓.png', 'image/png', PNG_BASE64)
    await expect.poll(async () => (await freeOf(page, 'free_image')).length).toBe(1)
    const [image] = await freeOf(page, 'free_image')
    const box = await page.locator(`.react-flow__node[data-id="${image?.key ?? ''}"]`).boundingBox()
    if (!box) throw new Error('畫面上找不到圖片')
    // 放在放開的地方附近（那裡被佔住就挪到最近的空位，最多一格遠）
    expect(Math.abs(box.x + box.width / 2 - at.x)).toBeLessThan(240)
    expect(Math.abs(box.y + box.height / 2 - at.y)).toBeLessThan(240)

    // 拖到場框上：圖片挪到旁邊的空位，場不會被推開
    const sceneBefore = (await freeOf(page, 'scene'))[0]
    const frame = await page
      .locator(`.react-flow__node[data-id="${sceneBefore?.key ?? ''}"]`)
      .boundingBox()
    if (!sceneBefore || !frame) throw new Error('沒有場框')
    await page.evaluate(
      ({ base64, at }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const transfer = new DataTransfer()
        transfer.items.add(new File([bytes], '狗.png', { type: 'image/png' }))
        const target = document.elementFromPoint(at.x, at.y)
        for (const kind of ['dragenter', 'dragover', 'drop']) {
          target?.dispatchEvent(
            new DragEvent(kind, {
              bubbles: true,
              cancelable: true,
              clientX: at.x,
              clientY: at.y,
              dataTransfer: transfer,
            }),
          )
        }
      },
      { base64: PNG_BASE64, at: { x: frame.x + frame.width / 2, y: frame.y + 60 } },
    )
    await expect.poll(async () => (await freeOf(page, 'free_image')).length).toBe(2)
    const sceneAfter = (await freeOf(page, 'scene'))[0]
    expect({ x: sceneAfter?.x, y: sceneAfter?.y }).toEqual({ x: sceneBefore.x, y: sceneBefore.y })

    await drop('筆記.txt', 'text/plain', btoa('hello'))
    await expect(
      page.getByTestId('toast').filter({ hasText: '「筆記.txt」沒放上去' }),
    ).toBeVisible()
    expect(await freeOf(page, 'free_image')).toHaveLength(2)
  })
})
