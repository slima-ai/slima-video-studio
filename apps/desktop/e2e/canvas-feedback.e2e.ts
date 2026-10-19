import type { Page } from '@playwright/test'

import {
  canvasNodes,
  centerOn,
  generateAndOpenCanvas,
  kindCount,
  viewportSettled,
  type FlowNode,
} from './canvas-helpers'
import { expect, test } from './fixtures'

// M6-7d-3：上方列（復原步數、整理、已花）、懸空的連接點、拉線時整格淡掉／亮綠、剪線的 ×、
// 拖進別的場框時目標框即時長大、新增的格子不被面板蓋住也不重疊。

const nodeById = async (page: Page, id: string): Promise<FlowNode> => {
  const found = (await canvasNodes(page)).find((n) => n.id === id)
  if (!found) throw new Error(`沒有 ${id}`)
  return found
}

async function centerOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`畫面上找不到 ${testId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('畫布的回饋（示範模式）', () => {
  test('上方列：已花多少、復原與重做旁有步數；「整理」讓拖過的鏡頭回到排好的位置，可以復原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect(page.getByTestId('spent')).toHaveText('已花 US$0.00')
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭')
    const home = shot.position
    await centerOn(page, shot.id)
    const box = await page.getByTestId(`rf__node-${shot.id}`).boundingBox()
    if (!box) throw new Error('看不到鏡頭')
    await page.mouse.move(box.x + 60, box.y + 16)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + 200, { steps: 10 })
    await page.mouse.up()
    await expect
      .poll(async () => (await nodeById(page, shot.id)).position.y)
      .toBeGreaterThan(home.y)
    await expect(page.getByTestId('undo-count')).not.toHaveText('')
    const steps = Number(await page.getByTestId('undo-count').innerText())

    await page.getByTestId('tidy').click()
    // 格子滑回去（300ms 動畫），不是一下跳過去
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-shifting', 'true')
    await expect(page.getByTestId('toast')).toContainText('回到自動排好的位置')
    await expect.poll(async () => (await nodeById(page, shot.id)).position).toEqual(home)
    await expect(page.getByTestId('undo-count')).toHaveText(String(steps + 1))
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-shifting', 'false')
    await page.getByTestId('undo').click()
    await expect
      .poll(async () => (await nodeById(page, shot.id)).position.y)
      .toBeGreaterThan(home.y)
    await expect(page.getByTestId('redo-count')).toHaveText('1')
  })

  test('沒接線的連接點平常藏起來，滑過那一格才出現；拉線時接得上的整格亮綠、接不上的整格淡掉', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    const hero = (await canvasNodes(page)).find((n) => n.data.kind === 'character')
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!hero || !shot) throw new Error('節點不齊')
    await centerOn(page, shot.id)
    const refPort = page.getByTestId(`port-${shot.id}-shot-ref-char`)
    await expect(refPort).toHaveAttribute('data-dangling', 'true')
    await page.mouse.move(5, 5)
    await expect(refPort).toHaveCSS('opacity', '0')
    // 滑過那一格就出現（畫面剛好還在動、滑鼠落空時重新滑一次，跟使用者一樣）
    await expect(async () => {
      await page.getByTestId(`rf__node-${shot.id}`).hover({ position: { x: 100, y: 60 } })
      await expect(refPort).toHaveCSS('opacity', '1', { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })

    // 從角色拉線：鏡頭整格亮綠、圖與影片整格淡掉
    await page.evaluate(async () => {
      const rf = (
        window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } }
      ).__svsCanvas
      await rf?.fitView({
        maxZoom: 1,
        duration: 0,
        padding: { top: '80px', left: '270px', right: '40px', bottom: '48px' },
      })
    })
    await viewportSettled(page)
    const start = await centerOf(page, `port-${hero.id}-char-out`)
    await page.mouse.move(start.x, start.y, { steps: 3 })
    await page.mouse.down()
    await page.mouse.move(start.x + 60, start.y + 40, { steps: 8 })
    await expect(page.getByTestId(`node-${shot.id}`)).toHaveAttribute('data-linkstate', 'valid')
    await expect(page.getByTestId(`node-${shot.id}:video`)).toHaveAttribute(
      'data-linkstate',
      'invalid',
    )
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.getByTestId(`node-${shot.id}`)).not.toHaveAttribute('data-linkstate', /./)
  })

  test('選取角色時，它連到鏡頭的線中點出現「×」，不用剛好滑到線上', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    const hero = (await canvasNodes(page)).find((n) => n.data.kind === 'character')
    const [shot] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!hero || !shot) throw new Error('節點不齊')
    await page.evaluate(
      ([source, target]) =>
        window.svs.invoke('canvas.link', {
          source: { key: source ?? '', port: 'char-out' },
          target: { key: target ?? '', port: 'shot-ref-char' },
        }),
      [hero.id, shot.id],
    )
    await expect.poll(async () => (await nodeById(page, shot.id)).data.tags).toEqual(['新角色'])
    await centerOn(page, hero.id)
    await page.getByTestId(`rf__node-${hero.id}`).click({ position: { x: 60, y: 16 } })
    await expect(page.getByRole('button', { name: '剪掉這條線' })).toHaveCount(1)
  })

  test('新增角色：放在看得到的地方，不被左邊的新增面板蓋住，也不跟其他格子重疊', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    await viewportSettled(page)
    const hero = (await canvasNodes(page)).find((n) => n.data.kind === 'character')
    if (!hero) throw new Error('沒有角色')
    const box = await page.getByTestId(`rf__node-${hero.id}`).boundingBox()
    const palette = await page.getByTestId('node-palette').boundingBox()
    if (!box || !palette) throw new Error('看不到')
    expect(box.x).toBeGreaterThanOrEqual(palette.x + palette.width)
    const rects = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          id: el.getAttribute('data-id') ?? '',
          frame: el.classList.contains('react-flow__node-frame'),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }
      }),
    )
    const me = rects.find((r) => r.id === hero.id)
    const overlaps = rects.filter(
      (r) =>
        me !== undefined &&
        r.id !== me.id &&
        !r.frame &&
        r.x < me.x + me.width &&
        me.x < r.x + r.width &&
        r.y < me.y + me.height &&
        me.y < r.y + r.height,
    )
    expect(overlaps).toEqual([])
  })
})
