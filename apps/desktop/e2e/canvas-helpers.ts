import type { Locator, Page } from '@playwright/test'

import { expect } from './fixtures'
import { pick } from './pick'

export interface FlowNode {
  id: string
  position: { x: number; y: number }
  data: {
    sceneId?: string
    kind: string
    status?: string
    inCut?: boolean
    title: string
    slots?: unknown[]
    tags?: string[]
    glow?: boolean
  }
}

/** 畫布裡所有節點（含畫面外沒畫出來的）。 */
export function canvasNodes(page: Page): Promise<FlowNode[]> {
  return page.evaluate(() => {
    const rf = (window as unknown as { __svsCanvas?: { getNodes: () => unknown[] } }).__svsCanvas
    return (rf?.getNodes() ?? []) as FlowNode[]
  })
}

export interface FlowEdge {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** 畫布裡所有連線。 */
export function canvasEdges(page: Page): Promise<FlowEdge[]> {
  return page.evaluate(() => {
    const rf = (window as unknown as { __svsCanvas?: { getEdges: () => unknown[] } }).__svsCanvas
    return (rf?.getEdges() ?? []) as FlowEdge[]
  })
}

export const kindCount = async (page: Page, kind: string): Promise<number> =>
  (await canvasNodes(page)).filter((n) => n.data.kind === kind).length

/**
 * 示範模式在畫布上用「一句話」生一支 3 鏡的影片（每鏡 3 秒），等它長完；專案裡會有一個場、
 * 三個鏡頭與剪輯節點，剪輯也已經接好成品。停在畫布。
 */
export async function generateAndOpenCanvas(
  page: Page,
  story = '一隻貓在下雨的夜晚找到溫暖的家',
  options: { sound?: boolean } = {},
): Promise<void> {
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await expect(page.getByTestId('canvas-root')).toBeVisible()
  // 畫布上已經有一句話就用它，沒有才新增一個
  if ((await kindCount(page, 'oneliner')) === 0) {
    const empty = page.getByTestId('empty-add-oneliner')
    if (await empty.isVisible()) await empty.click()
    else await page.getByTestId('palette-oneliner').click()
  }
  const oneliner = page.locator('.react-flow__node[data-id^="node:"]').first()
  await expect(oneliner).toBeVisible()
  await page.getByTestId('oneliner-story').fill(story)
  await page.getByTestId('oneliner-story').blur()
  await pick(page, 'oneliner-shots', '3')
  await pick(page, 'oneliner-duration', '3')
  // 聲音三個勾選預設全開；其他測試不是在測聲音，這裡先取消（旁白、配樂完成後會自動加，成品會多一版、花費也會變）。
  // 要測聲音的測試傳 { sound: true } 保持勾選
  if (options.sound !== true) {
    for (const key of ['native', 'narration', 'music']) {
      await page.getByTestId(`oneliner-sound-${key}`).uncheck()
    }
  }
  await page.getByTestId('oneliner-generate').click()
  await page.getByTestId('run-confirm-ok').click()
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
    timeout: 60_000,
  })
  await expect(page.getByTestId('toast').filter({ hasText: '短片生成好了' })).toBeVisible()
}

export async function viewportOf(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const rf = (
      window as unknown as {
        __svsCanvas?: { getViewport: () => { x: number; y: number; zoom: number } }
      }
    ).__svsCanvas
    return rf?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
  })
}

/** 畫布的視角動畫結束（連續兩次讀到一樣）。 */
export async function viewportSettled(page: Page): Promise<void> {
  let last = ''
  await expect
    .poll(async () => {
      const now = await page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
      const same = now === last
      last = now
      return same
    })
    .toBe(true)
}

/**
 * 把某個節點拉到畫面中央（縮放 100%）；畫面外的節點不會畫出來，點不到。
 * setCenter 不是立刻生效（實測約 140 毫秒後節點才跳到新位置），所以要等它回傳的 Promise，再等畫面不動；
 * 沒等就去滑鼠移上去，節點會在滑鼠底下搬走（「滑過說明」的測試偶爾因此逾時，CI 上機器忙時更常發生）。
 */
export async function centerOn(page: Page, nodeId: string): Promise<void> {
  await viewportSettled(page)
  await page.evaluate(async (id) => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNode: (id: string) => { position: { x: number; y: number } } | undefined
          setCenter: (x: number, y: number, o: object) => Promise<boolean> | unknown
        }
      }
    ).__svsCanvas
    const node = rf?.getNode(id)
    if (node) {
      await rf?.setCenter(node.position.x + 130, node.position.y + 60, { zoom: 1, duration: 0 })
    }
  }, nodeId)
  // 縮放真的到 100% 了（比只等 Promise 更穩：機器忙時 Promise 回來得比畫面早）
  await expect.poll(async () => (await viewportOf(page)).zoom).toBeCloseTo(1, 2)
  await viewportSettled(page)
  await expect(page.locator(`.react-flow__node[data-id="${nodeId}"]`)).toBeVisible()
}

/**
 * 滑上去才出現的按鈕（連接點旁的「＋」、線中點的「×」）：先滑過去再點。
 * 這類按鈕沒被滑過時 pointer-events 是 none；如果滑過去之後畫面剛好還在動（平移、長出動畫），
 * 滑鼠就不在它上面了，而 Playwright 重試點擊時不會再滑一次，會一直點到底下的畫布。
 * 所以每次重試都把「滑過去 → 點」整個做一遍，就像使用者沒點到會再移一次滑鼠。
 */
export async function hoverThenClick(hover: () => Promise<void>, target: Locator): Promise<void> {
  await expect(async () => {
    await hover()
    await target.click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/**
 * 點畫布上一塊空白處（取消選取、讓輸入框失焦）：右下角，避開左側面板與上方列；
 * 左側面板的高度會跟著能新增的種類變，不要點左邊。
 */
export async function clickEmpty(page: Page): Promise<void> {
  const pane = await page.locator('.react-flow__pane').boundingBox()
  if (!pane) throw new Error('畫面上找不到畫布')
  await page.mouse.click(pane.x + pane.width - 60, pane.y + pane.height - 60)
}

/** 畫布上一個空白的點（往右下方找，避開格子和左側面板）。 */
export async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) return undefined
    for (let y = pane.bottom - 200; y > pane.top + 60; y -= 40) {
      for (let x = pane.right - 260; x > pane.left + 320; x -= 40) {
        // 這一點和右下方 240×160 都是空白，貼上的格子才不會被擋住
        const clear = [0, 120, 240].every((ox) =>
          [0, 80, 160].every((oy) =>
            document.elementFromPoint(x + ox, y + oy)?.classList.contains('react-flow__pane'),
          ),
        )
        if (clear) return { x, y }
      }
    }
    return undefined
  })
  if (!point) throw new Error('畫面上找不到空白處')
  return point
}
