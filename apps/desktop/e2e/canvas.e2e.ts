import {
  canvasNodes,
  generateAndOpenCanvas,
  hoverThenClick,
  kindCount,
  viewportOf,
  viewportSettled,
} from './canvas-helpers'
import { expect, test } from './fixtures'

test.describe('畫布首頁（示範模式）', () => {
  test('開 App 就是畫布；還是空的時說明怎麼開始，按鈕新增一句話節點', async ({ page }) => {
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect(page.getByRole('button', { name: '畫布' })).toHaveAttribute('aria-current', 'page')
    // 滿版：畫布吃滿中央工作區，沒有內邊距
    const main = await page.getByTestId('layout-main').boundingBox()
    const root = await page.getByTestId('canvas-root').boundingBox()
    expect(root?.width).toBeCloseTo(main?.width ?? -1, 0)
    expect(root?.height).toBeCloseTo(main?.height ?? -1, 0)
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    // 還沒有專案名稱時寫「未命名專案」
    await expect(page.getByTestId('project-name')).toHaveText('未命名專案')
    // 空畫布中央就能先寫故事，按「新增一句話」就帶著故事放到畫布上
    await page.getByTestId('empty-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByRole('button', { name: '新增一句話' }).click()
    await expect.poll(() => kindCount(page, 'oneliner')).toBe(1)
    await expect(page.getByTestId('canvas-empty')).toHaveCount(0)
    await expect(page.getByTestId('oneliner-story')).toHaveValue('一隻貓在下雨的夜晚找到溫暖的家')
    // 新的一句話整個看得到（沒有被左邊的新增面板蓋住）；畫面會平移過去，等它停下來
    await viewportSettled(page)
    const node = await page.locator('.react-flow__node[data-id^="node:"]').boundingBox()
    const palette = await page.getByTestId('node-palette').boundingBox()
    expect((node?.x ?? 0) >= (palette?.x ?? 0) + (palette?.width ?? 0)).toBe(true)
  })

  test('沒有「節點圖」與進階模式；導覽列第一個是畫布', async ({ page }) => {
    await expect(page.getByRole('button', { name: '節點圖' })).toHaveCount(0)
    const first = page.getByTestId('layout-nav').getByRole('button').first()
    await expect(first).toHaveAccessibleName('畫布')
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('general-section')).toBeVisible()
    await expect(page.getByTestId('advanced-mode')).toHaveCount(0)
  })

  // 以前的快速開始頁生成後還沒有場（要升級成專案才有）；一句話節點一定會長出一個場與剪輯。
  test('一句話長出來後：一個場框裝著三個鏡頭，每鏡的圖與影片都好了，剪輯節點顯示 3/3 鏡', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    expect(await kindCount(page, 'image')).toBe(3)
    expect(await kindCount(page, 'video')).toBe(3)
    expect(await kindCount(page, 'scene')).toBe(1)
    expect(await kindCount(page, 'cut')).toBe(1)
    const nodes = await canvasNodes(page)
    expect(nodes.filter((n) => n.data.kind === 'image').map((n) => n.data.status)).toEqual([
      'done',
      'done',
      'done',
    ])
    expect(nodes.find((n) => n.data.kind === 'cut')?.data).toMatchObject({
      slots: [{ note: '3/3 鏡' }],
    })
    await expect(page.getByTestId('canvas-empty')).toHaveCount(0)
    await expect(page.getByTestId('canvas-topbar')).toBeVisible()
  })

  test('縮放小於 0.5 → 只留縮圖與大字名稱；小於 0.25 → 色塊上寫編號與名稱', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    const root = page.getByTestId('canvas-root')
    const zoomTo = (zoom: number): Promise<void> =>
      page.evaluate((z) => {
        const rf = (window as unknown as { __svsCanvas?: { zoomTo: (z: number) => unknown } })
          .__svsCanvas
        void rf?.zoomTo(z)
      }, zoom)
    await zoomTo(1)
    await expect(root).toHaveAttribute('data-lod', 'full')
    await zoomTo(0.4)
    await expect(root).toHaveAttribute('data-lod', 'mid')
    // 標題列的字小到看不見：鏡頭與一句話在卡片中間寫一行大字的名稱
    await expect(page.locator('.svs-mid-name').filter({ hasText: '第 1 鏡' })).toBeVisible()
    await expect(page.locator('.svs-mid-name').filter({ hasText: '一句話' })).toBeVisible()
    await zoomTo(0.15)
    await expect(root).toHaveAttribute('data-lod', 'low')
    // 色塊：鏡頭寫編號，一句話與剪輯寫名稱
    await expect(page.locator('.svs-block-number').filter({ hasText: /^1$/ })).toBeVisible()
    await expect(page.locator('.svs-block-word').filter({ hasText: '一句話' })).toBeVisible()
    await expect(page.locator('.svs-block-word').filter({ hasText: '剪輯' })).toBeVisible()
    await expect(page.locator('.svs-mid-name').first()).toBeHidden()
  })

  test('視角會記住：平移後重新載入，位置還在', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.evaluate(() => {
      const rf = (window as unknown as { __svsCanvas?: { setViewport: (v: object) => unknown } })
        .__svsCanvas
      void rf?.setViewport({ x: -123, y: 77, zoom: 0.8 })
    })
    // 停下來半秒後才存；等主行程那邊讀得到
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
        return result.ok ? result.data.viewport : undefined
      })
      .toEqual({ x: -123, y: 77, zoom: 0.8 })
    await page.reload()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await expect.poll(() => viewportOf(page)).toEqual({ x: -123, y: 77, zoom: 0.8 })
  })

  test('影片的「放進成品」開關：關掉 → 提示說明影響、剪輯少一鏡；提示上的「復原」與 Cmd/Ctrl+Z 都能還原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'video')).toBe(3)
    const video = (await canvasNodes(page)).find((n) => n.data.kind === 'video')
    if (!video) throw new Error('沒有影片節點')
    await page.evaluate(async (id) => {
      const rf = (
        window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } }
      ).__svsCanvas
      await rf?.fitView({ nodes: [{ id }], maxZoom: 1, duration: 0 })
    }, video.id)
    // 真正的開關（switch），切換時用提示說明影響
    const toggle = page.getByTestId(`node-${video.id}`).getByRole('switch', { name: '放進成品' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('toast')).toContainText(
      '第 1 鏡不放進成品：接成成品時會跳過這一鏡',
    )
    await expect(page.getByTestId('node-cut')).toContainText('2/3 鏡')
    await page.getByTestId('toast-action').click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('node-cut')).toContainText('3/3 鏡')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('左側節點面板預設展開，可以收起再打開', async ({ page }) => {
    await expect(page.getByTestId('node-palette')).toBeVisible()
    for (const kind of ['scene', 'shot', 'character', 'location', 'freeImage', 'note', 'group']) {
      await expect(page.getByTestId(`palette-${kind}`)).toBeVisible()
    }
    await page.getByTestId('palette-close').click()
    await expect(page.getByTestId('node-palette')).toHaveCount(0)
    await page.getByTestId('palette-open').click()
    await expect(page.getByTestId('node-palette')).toBeVisible()
  })

  test('節點面板新增角色：畫布長出角色節點並選取它；新增角色可以復原', async ({ page }) => {
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    await expect(page.getByTestId('toast')).toContainText('已新增角色「新角色」')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    // 專案是這次新增時自動建的，最上面的專案列有專案名
    await expect(page.getByTestId('project-name')).toHaveText('我的短片')
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(2)
    await expect(page.getByTestId('toast')).toContainText('已新增角色「新角色 2」')
    await page.getByTestId('undo').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
  })

  test('新增場與鏡頭：場框多一個、剪輯多一個輸入槽；鏡頭放進最後一場；Cmd/Ctrl+Z 復原', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.getByTestId('palette-shot').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    await expect(page.getByTestId('toast')).toContainText('已新增第 4 鏡')
    await page.getByTestId('undo').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.getByTestId('palette-scene').click()
    await expect.poll(() => kindCount(page, 'scene')).toBe(2)
    const cut = (await canvasNodes(page)).find((n) => n.data.kind === 'cut')
    expect(cut?.data.slots).toHaveLength(2)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
  })

  test('Tab 開新增選單：打字搜尋、Enter 新增；Esc 關掉', async ({ page }) => {
    // 點在空畫布中央最右邊那張「一句話」卡片的右邊（空白處）；點進卡片的話焦點會落在故事輸入框，Tab 就是輸入框自己的
    const form = await page.getByTestId('canvas-empty').locator('form').boundingBox()
    if (!form) throw new Error('沒有空畫布的起點卡片')
    await page.mouse.click(form.x + form.width + 120, form.y + form.height / 2)
    await page.keyboard.press('Tab')
    const menu = page.getByTestId('add-menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(menu).toBeVisible()
    await page.getByLabel('搜尋要新增的種類').fill('地點')
    await expect(menu.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect.poll(() => kindCount(page, 'location')).toBe(1)
    await expect(menu).toHaveCount(0)
  })

  test('雙擊空白處開新增選單，新節點放在雙擊的位置；那裡被佔住就挪到最近的空位', async ({
    page,
  }) => {
    const root = await page.getByTestId('canvas-root').boundingBox()
    if (!root) throw new Error('沒有畫布')
    // 空畫布中央有三張起點卡片：雙擊它們上方的空白處
    const at = { x: root.x + root.width - 300, y: root.y + 130 }
    await page.mouse.dblclick(at.x, at.y)
    await expect(page.getByTestId('add-menu')).toBeVisible()
    await page.getByRole('option', { name: /角色/ }).click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    const node = page.locator('.react-flow__node.selected')
    await expect(node).toHaveCount(1)
    const box = await node.boundingBox()
    // 節點上緣的中間靠近雙擊的位置（吸附到 16px 格線）
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - at.x)).toBeLessThan(40)
    expect(Math.abs((box?.y ?? 0) + 20 - at.y)).toBeLessThan(40)
  })

  test('滑過角色的輸出點出現「＋」，點開只列接得上的鏡頭；新鏡頭已經帶著這個角色', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.getByTestId('palette-character').click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    const hero = (await canvasNodes(page)).find((n) => n.data.kind === 'character')
    if (!hero) throw new Error('沒有角色節點')
    // 新增後畫面會用動畫平移到新角色。動畫中就滑上去的話，節點移走後「＋」失去 hover
    // （沒 hover 時 pointer-events: none），Playwright 重試點擊也不會再滑一次，就一直點不到。
    // 先等新角色整個進到畫面、視角停下來再滑。
    await expect(page.getByTestId(`rf__node-${hero.id}`)).toBeInViewport({ ratio: 1 })
    await viewportSettled(page)
    const port = page.getByTestId(`port-${hero.id}-char-out`)
    await hoverThenClick(() => port.hover(), page.getByTestId(`plus-${hero.id}-char-out`))
    const menu = page.getByTestId('add-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option')).toHaveCount(1)
    await menu.getByRole('option', { name: /鏡頭/ }).click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shots.at(-1)?.data).toMatchObject({ tags: ['新角色'] })
    // 角色到新鏡頭之間多了一條參考線
    await expect(page.locator('.react-flow__edge.react-flow__edge-ref')).toHaveCount(1)
  })

  test('滑過鏡頭的「角色」輸入點：＋ 新增一個角色並加進這一鏡', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    const shot = (await canvasNodes(page)).find((n) => n.data.kind === 'shot')
    if (!shot) throw new Error('沒有鏡頭節點')
    await page.evaluate(async (id) => {
      const rf = (
        window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } }
      ).__svsCanvas
      await rf?.fitView({ nodes: [{ id }], maxZoom: 1, duration: 0 })
    }, shot.id)
    await hoverThenClick(
      () => page.getByTestId(`port-${shot.id}-shot-ref-char`).hover(),
      page.getByTestId(`plus-${shot.id}-shot-ref-char`),
    )
    const menu = page.getByTestId('add-menu')
    await expect(menu.getByRole('option')).toHaveCount(1)
    await menu.getByRole('option', { name: /角色/ }).click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === shot.id)?.data)
      .toMatchObject({ tags: ['新角色'] })
    await page.getByTestId('undo').click()
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === shot.id)?.data.tags)
      .toEqual([])
  })

  test('角色放在被佔住的地方：挪到旁邊的空位，不蓋在別的節點上', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await page.getByTestId('fit-view').click()
    // 全部顯示之後，畫面正中央就是節點；Tab 新增的角色想放在正中央
    await page.getByTestId('canvas-root').click({ position: { x: 1000, y: 40 } })
    await page.keyboard.press('Tab')
    await page.getByRole('option', { name: /角色/ }).click()
    await expect.poll(() => kindCount(page, 'character')).toBe(1)
    const nodes = await page.evaluate(() => {
      const rf = (
        window as unknown as {
          __svsCanvas?: {
            getNodes: () => {
              id: string
              position: { x: number; y: number }
              width?: number
              height?: number
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
        w: n.width ?? 0,
        h: n.height ?? 0,
      }))
    })
    const hero = nodes.find((n) => n.kind === 'character')
    if (!hero) throw new Error('沒有角色節點')
    for (const other of nodes.filter((n) => n.id !== hero.id && n.kind !== 'scene')) {
      const apart =
        hero.x + hero.w <= other.x ||
        other.x + other.w <= hero.x ||
        hero.y + hero.h <= other.y ||
        other.y + other.h <= hero.y
      expect(apart, `角色蓋到了 ${other.id}`).toBe(true)
    }
  })
})
