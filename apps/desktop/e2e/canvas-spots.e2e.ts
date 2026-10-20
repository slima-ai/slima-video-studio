import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import { clickEmpty, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

interface Box {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
}

/** 畫布上每個節點的方框（場框與群組是「框」，裡面放別的格子是本來的樣子，不算）。 */
const boxes = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNodes: () => {
            id: string
            position: { x: number; y: number }
            width?: number
            height?: number
            measured?: { width?: number; height?: number }
            data: { kind: string }
          }[]
        }
      }
    ).__svsCanvas
    return (rf?.getNodes() ?? []).map((n) => ({
      id: n.id,
      kind: n.data.kind,
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? n.measured?.width ?? 0,
      h: n.height ?? n.measured?.height ?? 0,
    }))
  })

const overlapping = (all: readonly Box[]): string[] => {
  const cards = all.filter((b) => b.kind !== 'scene' && b.kind !== 'group' && b.w > 0 && b.h > 0)
  const found: string[] = []
  for (const [i, a] of cards.entries()) {
    for (const b of cards.slice(i + 1)) {
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        found.push(`${a.kind}(${a.id.slice(0, 12)}) × ${b.kind}(${b.id.slice(0, 12)})`)
      }
    }
  }
  return found
}

test.describe('畫布：新增的節點放在空位，不疊在一起', () => {
  test('從左邊的面板連按：角色、地點、便條、一句話、場、鏡頭各加幾個，沒有任何兩格疊在一起', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    for (const kind of [
      'character',
      'character',
      'location',
      'location',
      'note',
      'note',
      'oneliner',
    ]) {
      await page.getByTestId(`palette-${kind}`).click()
    }
    await page.getByTestId('palette-scene').click()
    await page.getByTestId('palette-shot').click()
    await page.getByTestId('palette-shot').click()
    await page.waitForTimeout(800)
    expect(overlapping(await boxes(page))).toEqual([])
  })

  test('沒有選取時新增群組：放在空位，不框住不相干的格子；連按兩次也不疊', async ({ page }) => {
    await generateAndOpenCanvas(page)
    // 先點空白處取消選取（有選取的格子時，群組是框住它們）
    await clickEmpty(page)
    await page.getByTestId('palette-group').click()
    // 剛放下的群組被選到了：再取消一次，第二個才是「沒有選取」的空群組
    await clickEmpty(page)
    await page.getByTestId('palette-group').click()
    await page.waitForTimeout(800)
    const all = await boxes(page)
    const groups = all.filter((b) => b.kind === 'group')
    expect(groups).toHaveLength(2)
    const [first, second] = groups
    if (!first || !second) throw new Error('群組不夠')
    const hit = (a: Box, b: Box): boolean =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    // 兩個空群組彼此不疊，也不蓋住任何節點
    expect(hit(first, second)).toBe(false)
    for (const group of groups) {
      expect(all.filter((b) => b.kind !== 'group' && b.w > 0 && hit(group, b))).toEqual([])
    }
  })

  test('剛新增的角色還選著，再從面板新增群組：群組是空的、放在空位，不蓋在角色或場框上（走查 N4）', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-character').click()
    await page.getByTestId('palette-group').click()
    await page.waitForTimeout(800)
    const all = await boxes(page)
    const group = all.find((b) => b.kind === 'group')
    if (!group) throw new Error('沒有群組')
    const hit = (a: Box, b: Box): boolean =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    expect(all.filter((b) => b.kind !== 'group' && b.w > 0 && hit(group, b))).toEqual([])
  })

  test('一次選好幾個檔案放上畫布：每個都放在空位，不疊在別的格子或彼此上面', async ({
    app,
    page,
    projectDir,
  }) => {
    await generateAndOpenCanvas(page)
    // 3 個檔案
    const files: string[] = []
    for (let i = 1; i <= 3; i += 1) {
      const file = join(projectDir, `雨夜${String(i)}.png`)
      writeFileSync(file, png(i))
      files.push(file)
    }
    await pickReturns(app, files)
    await page.getByTestId('palette-freeImage').click()
    await expect
      .poll(async () => (await boxes(page)).filter((b) => b.kind === 'freeImage').length)
      .toBe(3)
    expect(overlapping(await boxes(page))).toEqual([])
  })
})

/** 1×1 的 PNG（最後多一個位元組，讓每張的內容都不一樣）。 */
const png = (n: number): Buffer =>
  Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    ),
    Buffer.from([n]),
  ])

/** 讓主行程的選檔視窗直接回傳這些檔案（不用真的跳視窗）。 */
async function pickReturns(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files })
  }, paths)
}
