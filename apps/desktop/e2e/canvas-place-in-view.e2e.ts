import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import { generateAndOpenCanvas, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'

/** 1×1 的 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
)

/** 13 吋筆電的視窗高度（內容區）：新放的東西最容易被上方列蓋住。 */
const LAPTOP = { width: 1440, height: 868 } as const

const keysOf = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const result = await window.svs.invoke('canvas.get', {})
    if (!result.ok) throw new Error(result.error.userMessage)
    return result.data.nodes.map((n) => n.key)
  })

/** 把畫面對到第 1 鏡的圖：畫面中間被場和鏡頭佔滿，新放的東西會被擠到旁邊。 */
async function focusFirstShot(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNodes: () => { id: string; position: { x: number; y: number } }[]
          setCenter: (x: number, y: number, o: object) => Promise<boolean>
        }
      }
    ).__svsCanvas
    const image = rf?.getNodes().find((n) => n.id.endsWith(':image'))
    if (!image) return
    await rf?.setCenter(image.position.x + 60, image.position.y + 220, { zoom: 0.8, duration: 0 })
  })
  await viewportSettled(page)
}

/**
 * 這個節點整個看得到：在視窗裡、沒被上方列等東西蓋住——四個角、中心、每一個連接點，
 * 用 elementFromPoint 量到的都是這個節點自己（被蓋住就會量到上方列或面板）。
 */
async function coverageOf(page: Page, key: string): Promise<string[]> {
  return page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!node) return [`找不到節點 ${id}`]
    const r = node.getBoundingClientRect()
    const problems: string[] = []
    const probe = (name: string, x: number, y: number): void => {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        problems.push(`${name} 在視窗外（${String(Math.round(x))}, ${String(Math.round(y))}）`)
        return
      }
      const hit = document.elementFromPoint(x, y)
      if (!hit || !node.contains(hit)) {
        const what = hit?.getAttribute('data-testid') ?? hit?.tagName ?? 'null'
        problems.push(
          `${name} 被 ${what} 蓋住（${String(Math.round(x))}, ${String(Math.round(y))}）`,
        )
      }
    }
    probe('左上角', r.left + 3, r.top + 3)
    probe('右上角', r.right - 3, r.top + 3)
    probe('左下角', r.left + 3, r.bottom - 3)
    probe('右下角', r.right - 3, r.bottom - 3)
    probe('中心', r.left + r.width / 2, r.top + r.height / 2)
    for (const handle of node.querySelectorAll('.react-flow__handle')) {
      const h = handle.getBoundingClientRect()
      probe(
        `連接點 ${handle.getAttribute('data-handleid') ?? ''}`,
        h.left + h.width / 2,
        h.top + h.height / 2,
      )
    }
    return problems
  }, key)
}

async function pickReturns(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  }, paths)
}

test.describe('畫布：新放的東西整個看得到', () => {
  test('13 吋筆電的高度：圖片、角色、地點、便條、鏡頭新增之後，整個節點和連接點都沒被上方列或面板蓋住', async ({
    app,
    page,
    projectDir,
  }) => {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
    }, LAPTOP)
    await expect
      .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
      .toEqual([LAPTOP.width, LAPTOP.height])
    await generateAndOpenCanvas(page)
    await viewportSettled(page)
    await focusFirstShot(page)

    const file = join(projectDir, '雨夜的巷子.png')
    writeFileSync(file, PNG)
    await pickReturns(app, [file])

    for (const testId of [
      'palette-freeImage',
      'palette-character',
      'palette-location',
      'palette-note',
      'palette-shot',
    ]) {
      const before = new Set(await keysOf(page))
      await page.getByTestId(testId).click()
      // 鏡頭會連它的圖和影片一起出現：量最短的那個鍵（鏡頭本身）
      await expect
        .poll(async () => (await keysOf(page)).filter((k) => !before.has(k)).length)
        .toBeGreaterThan(0)
      const added = (await keysOf(page))
        .filter((k) => !before.has(k))
        .sort((a, b) => a.length - b.length)[0]
      if (!added) throw new Error(`${testId} 沒有新增節點`)
      await viewportSettled(page)
      // 長出來的動畫與平移結束後再量
      await expect(page.locator(`.react-flow__node[data-id="${added}"]`)).toBeVisible()
      await expect.poll(() => coverageOf(page, added), { message: testId }).toEqual([])
    }
  })
})
