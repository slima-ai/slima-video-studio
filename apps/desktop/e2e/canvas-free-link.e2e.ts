import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import { generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 1×1 的 PNG（最後多一個位元組，讓每張的內容都不一樣）。 */
const png = (n: number): Buffer =>
  Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    ),
    Buffer.from([n]),
  ])

const graphOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}
const nodeOf = async (page: Page, key: string) =>
  (await graphOf(page)).nodes.find((n) => n.key === key)

/** 讓主行程的選檔視窗直接回傳這些檔案（不用真的跳視窗）。 */
async function pickReturns(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  }, paths)
}

async function centerOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`畫面上找不到 ${testId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function dragPort(page: Page, from: string, to: { x: number; y: number }): Promise<void> {
  const start = await centerOf(page, from)
  await page.mouse.move(start.x, start.y, { steps: 5 })
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.up()
}

/** 把第 1 鏡的圖和它右下方的空白處放進畫面（縮到 0.8）。 */
async function focusFirstShot(page: Page, shotKey: string): Promise<void> {
  await page.evaluate((key) => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNode: (id: string) => { position: { x: number; y: number } } | undefined
          setCenter: (x: number, y: number, o: object) => Promise<boolean>
        }
      }
    ).__svsCanvas
    const image = rf?.getNode(`${key}:image`)
    if (!image) return
    return rf?.setCenter(image.position.x + 60, image.position.y + 220, { zoom: 0.8, duration: 0 })
  }, shotKey)
  await viewportSettled(page)
}

/** 把兩個節點的中間放到畫面中間（縮到 0.8），不管視窗多高都兩個一起看得到。 */
async function centerOnBoth(page: Page, keyA: string, keyB: string): Promise<void> {
  await page.evaluate(
    ({ a, b }) => {
      const rf = (
        window as unknown as {
          __svsCanvas?: {
            getNode: (id: string) => { position: { x: number; y: number } } | undefined
            setCenter: (x: number, y: number, o: object) => Promise<boolean>
          }
        }
      ).__svsCanvas
      const first = rf?.getNode(a)
      const second = rf?.getNode(b)
      if (!first || !second) return
      return rf?.setCenter(
        (first.position.x + second.position.x) / 2 + 100,
        (first.position.y + second.position.y) / 2 + 100,
        { zoom: 0.8, duration: 0 },
      )
    },
    { a: keyA, b: keyB },
  )
  await viewportSettled(page)
}

/** 生一支 3 鏡的影片，再從左側面板放一張圖（放在畫面中間）。 */
async function withPicture(app: ElectronApplication, page: Page, projectDir: string) {
  await generateAndOpenCanvas(page)
  await viewportSettled(page)
  const graph = await graphOf(page)
  const shot = graph.nodes.find((n) => n.kind === 'shot')
  if (!shot) throw new Error('沒有鏡頭')
  await focusFirstShot(page, shot.key)
  const file = join(projectDir, '雨夜的巷子.png')
  writeFileSync(file, png(1))
  await pickReturns(app, [file])
  await page.getByTestId('palette-freeImage').click()
  await expect
    .poll(async () => (await graphOf(page)).nodes.filter((n) => n.kind === 'free_image').length)
    .toBe(1)
  const picture = (await graphOf(page)).nodes.find((n) => n.kind === 'free_image')
  if (!picture) throw new Error('沒有圖片')
  await expect(page.getByTestId(`port-${picture.key}-free-img-out`)).toBeVisible()
  // 圖放在離畫面中間最近的空位，矮視窗（13 吋筆電）上可能半截在上方列底下：
  // 把圖和第 1 鏡的圖一起移到畫面中間，兩邊的連接點都點得到
  await centerOnBoth(page, picture.key, `${shot.key}:image`)
  return { shot: shot.key, picture }
}

test.describe('畫布：獨立圖片接出去', () => {
  test('圖片拉到鏡頭的「第一張畫面」：圖換成這張、影片標「需要重跑」；剪線或 Cmd/Ctrl+Z 回到原本的圖', async ({
    app,
    page,
    projectDir,
  }) => {
    const { shot, picture } = await withPicture(app, page, projectDir)
    const before = await nodeOf(page, `${shot}:image`)
    expect(before?.assetHash).toBeDefined()

    await dragPort(
      page,
      `port-${picture.key}-free-img-out`,
      await centerOf(page, `port-${shot}:image-img-first`),
    )
    await expect(page.getByTestId('toast').filter({ hasText: '的第一張畫面' })).toBeVisible()
    await expect
      .poll(async () => (await nodeOf(page, `${shot}:image`))?.assetHash)
      .toBe(picture.assetHash)
    expect((await nodeOf(page, `${shot}:image`))?.modelName).toBe('接上來的圖')
    await expect.poll(async () => (await nodeOf(page, `${shot}:video`))?.status).toBe('stale')
    // 圖格子上看得到這張圖
    await expect(
      page.locator(
        `.react-flow__node[data-id="${shot}:image"] [style*="${picture.assetHash ?? '-'}"]`,
      ),
    ).toHaveCount(1)

    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await nodeOf(page, `${shot}:image`))?.assetHash)
      .toBe(before?.assetHash)
    await expect.poll(async () => (await nodeOf(page, `${shot}:video`))?.status).toBe('done')

    // 重做之後用線中點的「×」剪掉：一樣回到原本的圖
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect
      .poll(async () => (await nodeOf(page, `${shot}:image`))?.assetHash)
      .toBe(picture.assetHash)
    const edgeId = `${picture.key}:free-img-out->${shot}:image:img-first`
    // 重做之後畫布重新讀資料，線晚一點才畫出來：等它出現再量位置
    await expect(
      page.locator(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-interaction`),
    ).toHaveCount(1)
    const mid = await page.evaluate((id) => {
      const path = document.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`,
      )
      if (!path) return undefined
      const point = path.getPointAtLength(path.getTotalLength() / 2)
      const at = point.matrixTransform(path.getScreenCTM() ?? new DOMMatrix())
      return { x: at.x, y: at.y }
    }, edgeId)
    if (!mid) throw new Error('找不到這條線')
    await page.mouse.move(mid.x - 30, mid.y - 30)
    await page.mouse.move(mid.x, mid.y, { steps: 6 })
    await page.getByRole('button', { name: '剪掉這條線' }).click()
    await expect
      .poll(async () => (await nodeOf(page, `${shot}:image`))?.assetHash)
      .toBe(before?.assetHash)
  })

  test('從「第一張畫面」的「＋」選檔：選好的圖放上畫布，也直接接上去', async ({
    app,
    page,
    projectDir,
  }) => {
    await generateAndOpenCanvas(page)
    await viewportSettled(page)
    const shot = (await graphOf(page)).nodes.find((n) => n.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    await focusFirstShot(page, shot.key)
    const file = join(projectDir, '晴天.png')
    writeFileSync(file, png(2))
    await pickReturns(app, [file])

    const port = await centerOf(page, `port-${shot.key}:image-img-first`)
    await dragPort(page, `port-${shot.key}:image-img-first`, { x: port.x - 160, y: port.y + 260 })
    const menu = page.getByTestId('add-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('option', { name: /上傳圖片/ }).click()
    await expect(page.getByTestId('toast').filter({ hasText: '也接上去了' })).toBeVisible()
    const picture = (await graphOf(page)).nodes.find((n) => n.kind === 'free_image')
    expect(picture?.title).toBe('晴天')
    await expect
      .poll(async () => (await nodeOf(page, `${shot.key}:image`))?.assetHash)
      .toBe(picture?.assetHash)
    // 選檔加接線是同一筆：復原一次就都收回
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await graphOf(page)).nodes.filter((n) => n.kind === 'free_image').length)
      .toBe(0)
    expect((await nodeOf(page, `${shot.key}:image`))?.modelName).not.toBe('接上來的圖')
  })

  test('從圖片的「＋」新增角色：這張圖直接接成角色的參考圖；拉到影片上說明可以接到哪裡', async ({
    app,
    page,
    projectDir,
  }) => {
    const { shot, picture } = await withPicture(app, page, projectDir)

    // 拉到影片的輸入點：接不上，游標旁說明
    const out = `port-${picture.key}-free-img-out`
    const start = await centerOf(page, out)
    const target = await centerOf(page, `port-${shot}:video-vid-in`)
    await page.mouse.move(start.x, start.y, { steps: 5 })
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 15 })
    await expect(page.getByTestId(`port-${shot}:video-vid-in`)).toHaveAttribute(
      'data-link',
      'invalid',
    )
    await expect(page.getByTestId(`port-${shot}:image-img-first`)).toHaveAttribute(
      'data-link',
      'valid',
    )
    await page.mouse.up()
    await expect(page.getByText('圖片可以接到鏡頭的「第一張畫面」')).toBeVisible()

    await dragPort(page, out, { x: start.x + 80, y: start.y + 300 })
    const menu = page.getByTestId('add-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('option', { name: /角色/ }).click()
    await expect
      .poll(async () => (await graphOf(page)).nodes.filter((n) => n.kind === 'character').length)
      .toBe(1)
    const graph = await graphOf(page)
    const hero = graph.nodes.find((n) => n.kind === 'character')
    expect(
      graph.edges.some(
        (e) => e.source === picture.key && e.target === hero?.key && e.targetPort === 'char-ref',
      ),
    ).toBe(true)
    const concepts = await page.evaluate(
      (id) => window.svs.invoke('characters.concepts', { characterId: id }),
      hero?.key.replace('character:', '') ?? '',
    )
    if (!concepts.ok) throw new Error(concepts.error.userMessage)
    expect(concepts.data.concepts.map((c) => c.assetHash)).toEqual([picture.assetHash])
  })
})
