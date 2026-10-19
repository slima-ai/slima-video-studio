import type { Page } from '@playwright/test'

import {
  clickEmpty,
  canvasNodes,
  centerOn,
  generateAndOpenCanvas,
  kindCount,
  viewportOf,
} from './canvas-helpers'
import { expect, test } from './fixtures'

/** 在最後面新增一個空的鏡頭（沒有圖也沒有影片），回傳它的 id。 */
async function addEmptyShot(page: Page): Promise<string> {
  const before = await kindCount(page, 'shot')
  const result = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
  if (!result.ok) throw new Error(result.error.userMessage)
  await expect.poll(() => kindCount(page, 'shot')).toBe(before + 1)
  return result.data.key.replace(/^shot:/, '')
}

const nodeOf = async (page: Page, id: string) => (await canvasNodes(page)).find((n) => n.id === id)

/** 每個鏡頭的版本數：[首幀圖, 影片]。 */
async function takeCounts(page: Page): Promise<[number, number][]> {
  const result = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.shots.map((s) => [s.firstFrames.length, s.videos.length])
}

test.describe('畫布執行（示範模式）', () => {
  // 這幾個測試真的會生成並用 FFmpeg 接片，每一步最多等 60 秒；測試本身（含關掉 App）要比那個長，
  // 不然機器忙的時候等待用掉整個時間，關 App 就被算成逾時
  test.describe.configure({ timeout: 120_000 })

  test('影片節點 ▶：確認面板只列這一鏡缺的兩步，標亮那一串；確認後依序補圖、補影片，其他鏡頭不重跑', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const id = await addEmptyShot(page)
    const video = `shot:${id}:video`
    await expect.poll(async () => (await nodeOf(page, video))?.data.status).toBe('idle')

    await centerOn(page, video)
    await page.getByTestId(`run-${video}`).click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('第 4 鏡：第一張畫面')
    await expect(confirm).toContainText('第 4 鏡：影片')
    await expect(confirm).not.toContainText('第 1 鏡')
    // 「執行到這裡」：那一串節點標亮，其他不亮
    await expect.poll(async () => (await nodeOf(page, `shot:${id}:image`))?.data.glow).toBe(true)
    expect((await nodeOf(page, video))?.data.glow).toBe(true)
    expect((await canvasNodes(page)).filter((n) => n.data.glow === true)).toHaveLength(3)
    // 面板貼在 ▶ 旁邊，不蓋住標亮的那一串
    await expect(confirm).toHaveAttribute('data-placed', 'true')
    const panel = await confirm.boundingBox()
    const button = await page.getByTestId(`run-${video}`).boundingBox()
    if (!panel || !button) throw new Error('量不到面板或按鈕')
    const gap = Math.max(
      panel.x - (button.x + button.width),
      button.x - (panel.x + panel.width),
      panel.y - (button.y + button.height),
      button.y - (panel.y + panel.height),
    )
    expect(gap).toBeLessThan(40)
    for (const glow of await page.locator('.svs-glow').all()) {
      const box = await glow.boundingBox()
      if (!box) continue
      const apart =
        panel.x >= box.x + box.width ||
        box.x >= panel.x + panel.width ||
        panel.y >= box.y + box.height ||
        box.y >= panel.y + panel.height
      expect(apart).toBe(true)
    }

    await page.getByTestId('run-confirm-ok').click()
    await expect(confirm).toHaveCount(0)
    await expect
      .poll(async () => (await nodeOf(page, video))?.data.status, { timeout: 60_000 })
      .toBe('done')
    expect((await nodeOf(page, `shot:${id}:image`))?.data.status).toBe('done')
    expect((await canvasNodes(page)).some((n) => n.data.glow === true)).toBe(false)
    // 新的鏡頭各一個版本；原本的三個鏡頭沒有重跑
    expect(await takeCounts(page)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ])
  })

  test('上方列「全部生成」：顯示預估、只補沒生成的；補完後變成「全部都生成好了」', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了')
    await expect(page.getByTestId('run-all')).toBeDisabled()

    await addEmptyShot(page)
    await expect(page.getByTestId('run-all')).toContainText('全部生成（約 US$')
    await page.getByTestId('run-all').click()
    // 補兩步，再把四段接成成品（成品對不上了，所以包括接片）
    await expect(page.getByTestId('run-confirm')).toContainText('這次會做 3 步')
    await expect(page.getByTestId('run-confirm')).toContainText(
      '接成成品（4 段，在本機處理、免費）',
    )
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 60_000 })
    await centerOn(page, 'cut')
    await expect(page.getByTestId('cut-footer')).toHaveText(/^成品 v2 · 0:\d\d$/)
    expect(await takeCounts(page)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ])
  })

  test('改了鏡頭描述：這一鏡的圖和影片標「需要重跑」，其他不受影響；全部生成補跑它們', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    // 生成、升級成專案之後，沒有任何節點需要重跑
    expect((await canvasNodes(page)).filter((n) => n.data.status === 'stale')).toHaveLength(0)
    const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first) throw new Error('找不到鏡頭')
    const shotId = first.id.replace(/^shot:/, '')
    const edited = await page.evaluate(
      (id) =>
        window.svs.invoke('shots.update', { shotId: id, patch: { description: '貓抬頭看著月亮' } }),
      shotId,
    )
    expect(edited.ok).toBe(true)
    const image = `${first.id}:image`
    const video = `${first.id}:video`
    await expect.poll(async () => (await nodeOf(page, image))?.data.status).toBe('stale')
    expect((await nodeOf(page, video))?.data.status).toBe('stale')
    expect((await canvasNodes(page)).filter((n) => n.data.status === 'stale')).toHaveLength(2)

    await centerOn(page, image)
    await expect(page.getByTestId(`node-${image}`)).toContainText('需要重跑')
    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('第 1 鏡：第一張畫面')
    await expect(confirm).toContainText('第 1 鏡：影片')
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(async () => (await nodeOf(page, video))?.data.status, {
        timeout: 60_000,
      })
      .toBe('done')
    expect((await nodeOf(page, image))?.data.status).toBe('done')
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了')
  })

  test('已完成的影片按 ▶：滑過說明是重做；面板寫會產生 v2、保留 v1，說明收起來；確認後多一個影片版本，圖不變', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const first = (await canvasNodes(page)).find((n) => n.data.kind === 'video')
    if (!first) throw new Error('找不到影片節點')
    await centerOn(page, first.id)
    const play = page.getByTestId(`run-${first.id}`)
    await play.hover()
    await expect(page.getByTestId('hover-tip')).toHaveText('重做這一步：產生新的一版，舊的保留')
    await play.click()
    await expect(page.getByTestId('run-confirm')).toContainText('影片（重做：產生 v2，保留 v1）')
    await expect(page.getByTestId('run-confirm-ok')).toHaveText('重做（產生 v2，保留 v1）')
    // 面板一打開，按鈕的說明就收起來，不會壓在面板上
    await expect(page.getByTestId('hover-tip')).toHaveCount(0)
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(() => takeCounts(page), { timeout: 60_000 })
      .toEqual([
        [1, 2],
        [1, 1],
        [1, 1],
      ])
  })

  test('上方列全部生成：要做的那一格在畫面外，先平移（不縮放）把它帶進來，面板才出現', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const id = await addEmptyShot(page)
    // 把畫面移到很遠的地方，新的鏡頭不在畫面裡
    await page.evaluate(async () => {
      const rf = (
        window as unknown as {
          __svsCanvas: { setViewport: (v: object, o: object) => Promise<boolean> }
        }
      ).__svsCanvas
      await rf.setViewport({ x: 3000, y: 3000, zoom: 0.8 }, { duration: 0 })
    })
    await expect(page.locator(`.react-flow__node[data-id="shot:${id}:image"]`)).toHaveCount(0)
    await page.getByTestId('run-all').click()
    await expect(page.getByTestId('run-confirm')).toBeVisible()
    await expect(page.locator(`.react-flow__node[data-id="shot:${id}:image"]`)).toBeInViewport()
    expect((await viewportOf(page)).zoom).toBeCloseTo(0.8, 5)
    await page.keyboard.press('Escape')
  })

  test('剪輯卡顯示成品：第一格縮圖、第幾版與長度，按 ▶ 就在卡片上播放', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await centerOn(page, 'cut')
    await expect(page.getByTestId('cut-footer')).toHaveText(/^成品 v1 · 0:\d\d$/)
    const video = page.getByTestId('cut-final-video')
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
      .toBeGreaterThanOrEqual(1)
    await page.getByTestId('cut-play').click()
    await expect(page.getByTestId('cut-play')).toHaveCount(0)
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThan(0)
  })

  test('關掉一鏡的「放進成品」：成品標成要重新接，上方列變「接成成品」，一行確認、免費；接好後跳過那一鏡', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [, second] = (await canvasNodes(page)).filter((n) => n.data.kind === 'video')
    if (!second) throw new Error('影片不夠')
    await centerOn(page, second.id)
    await page.getByTestId(`incut-${second.id}`).click()
    await expect(page.getByTestId('run-all')).toHaveText('接成成品')
    await centerOn(page, 'cut')
    await expect(page.getByTestId('cut-footer')).toContainText('鏡頭有變動，要重新接')

    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm.getByRole('heading')).toHaveText('接成成品 · 2 段 · 免費（在本機處理）')
    await expect(confirm).not.toContainText('US$')
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 60_000 })
    await expect(page.getByTestId('cut-footer')).toHaveText(/^成品 v2 · 0:\d\d$/)
  })

  test('剪輯節點 ▶：把缺的都生成，再把全部影片接成成品', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await addEmptyShot(page)
    await centerOn(page, 'cut')
    await page.getByTestId('run-cut').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('接成成品（4 段，在本機處理、免費）')
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('toast').filter({ hasText: '成品接好了' })).toBeVisible({
      timeout: 60_000,
    })
    expect(await takeCounts(page)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ])
  })

  test('Ctrl+Enter 執行選取的節點；沒選任何東西會提示；Esc 取消不會動資料', async ({ page }) => {
    await generateAndOpenCanvas(page)
    const id = await addEmptyShot(page)
    const shot = `shot:${id}`
    await centerOn(page, shot)
    await clickEmpty(page)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByTestId('toast').filter({ hasText: '先選取要執行的' })).toBeVisible()

    await page.locator(`.react-flow__node[data-id="${shot}"]`).click()
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByTestId('run-confirm')).toContainText('第 4 鏡：第一張畫面')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
    expect(await takeCounts(page)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [0, 0],
    ])

    await page.locator(`.react-flow__node[data-id="${shot}"]`).click()
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(() => takeCounts(page), { timeout: 60_000 })
      .toEqual([
        [1, 1],
        [1, 1],
        [1, 1],
        [1, 1],
      ])
  })

  test.describe('示範模式放慢', () => {
    test.use({ appEnv: { SVS_MOCK_LATENCY_MS: '500' } })

    test('生成中：格子上有骨架畫面與進度、■ 停止；上方列「生成中 0/2 · 停止」；開始和完成的提示照面板的清單寫', async ({
      page,
    }) => {
      await generateAndOpenCanvas(page)
      const id = await addEmptyShot(page)
      const image = `shot:${id}:image`
      const video = `shot:${id}:video`
      await centerOn(page, video)
      await page.getByTestId(`run-${video}`).click()
      await page.getByTestId('run-confirm-ok').click()
      // 開始的提示和面板說的一樣
      await expect(page.getByTestId('toast')).toHaveText(
        '開始生成：第 4 鏡 第一張畫面、影片（2 步）',
      )
      await expect(page.getByTestId('run-progress')).toContainText('生成中 0/2')
      await expect(page.getByTestId('run-all')).toHaveCount(0)
      const imageCard = page.getByTestId(`node-${image}`)
      await expect(imageCard.getByTestId('node-working')).toContainText('正在畫第一張畫面')
      await expect(imageCard.getByTestId(`stop-${image}`)).toBeVisible()
      // 佇列與格子同步：圖做完、影片開始時格子也跟著換
      await expect(page.getByTestId(`node-${video}`).getByTestId('node-working')).toContainText(
        '正在生成影片',
        { timeout: 30_000 },
      )
      await expect(page.getByTestId('run-progress')).toContainText('生成中 1/2')
      // 做完：提示換成「完成」；上方列回到按鈕（多了一段影片，成品要重新接）
      await expect(page.getByTestId('toast')).toHaveText('完成：第 4 鏡 第一張畫面、影片（2 步）', {
        timeout: 60_000,
      })
      await expect(page.getByTestId('run-all')).toHaveText('接成成品')
    })

    test('中途按上方列的「停止」：這一鏡停下來，做好的部分留著', async ({ page }) => {
      await generateAndOpenCanvas(page)
      const id = await addEmptyShot(page)
      const video = `shot:${id}:video`
      await centerOn(page, video)
      await page.getByTestId(`run-${video}`).click()
      await page.getByTestId('run-confirm-ok').click()
      await expect(page.getByTestId('run-progress')).toBeVisible()
      await page.getByTestId('run-stop').click()
      await expect(page.getByTestId('toast')).toHaveText('已經停止，做好的部分留著')
      await expect(page.getByTestId('run-progress')).toHaveCount(0)
      await expect.poll(async () => (await nodeOf(page, video))?.data.status).not.toBe('running')
      await expect.poll(async () => (await nodeOf(page, video))?.data.status).not.toBe('queued')
    })
  })

  test.describe('示範供應商會拒絕含「【拒絕】」的請求', () => {
    test.use({ appEnv: { SVS_MOCK_REJECT_TEXT: '【拒絕】' } })

    test('失敗：格子寫原因、按鈕變「重試」、提示說有幾步沒成功；改掉內容後按「重試」就好了', async ({
      page,
    }) => {
      await generateAndOpenCanvas(page)
      const id = await addEmptyShot(page)
      const edited = await page.evaluate(
        (shotId) =>
          window.svs.invoke('shots.update', {
            shotId,
            patch: { description: '一隻貓【拒絕】' },
          }),
        id,
      )
      expect(edited.ok).toBe(true)
      const image = `shot:${id}:image`
      await centerOn(page, image)
      await page.getByTestId(`run-${image}`).click()
      await page.getByTestId('run-confirm-ok').click()
      await expect
        .poll(async () => (await nodeOf(page, image))?.data.status, { timeout: 30_000 })
        .toBe('failed')
      await expect(page.getByTestId(`node-${image}`).getByTestId('node-error')).toContainText(
        '內容被拒絕',
      )
      await expect(page.getByTestId('toast')).toContainText('有 1 步沒有成功')
      const retry = page.getByTestId(`run-${image}`)
      await expect(retry).toHaveText('重試')

      // 改掉被拒絕的內容，再按「重試」
      await page.evaluate(
        (shotId) =>
          window.svs.invoke('shots.update', { shotId, patch: { description: '一隻貓在窗邊' } }),
        id,
      )
      await retry.click()
      await page.getByTestId('run-confirm-ok').click()
      await expect
        .poll(async () => (await nodeOf(page, `shot:${id}:video`))?.data.status, {
          timeout: 60_000,
        })
        .toBe('done')
      expect((await nodeOf(page, image))?.data.status).toBe('done')
    })

    test('重做已完成的影片卻失敗：影片那一格標失敗（舊的還在），第一張畫面照常；提示說沒成功', async ({
      page,
    }) => {
      await generateAndOpenCanvas(page)
      const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
      if (!first) throw new Error('沒有鏡頭')
      // 只改運鏡（影片的 Prompt 才會帶到），讓重做影片被拒絕
      await page.evaluate(
        (shotId) =>
          window.svs.invoke('shots.update', { shotId, patch: { cameraMove: '慢慢推近【拒絕】' } }),
        first.id.replace(/^shot:/, ''),
      )
      const video = `${first.id}:video`
      await centerOn(page, video)
      await page.getByTestId(`run-${video}`).click()
      await page.getByTestId('run-confirm-ok').click()
      await expect
        .poll(async () => (await nodeOf(page, video))?.data.status, { timeout: 30_000 })
        .toBe('failed')
      expect((await nodeOf(page, `${first.id}:image`))?.data.status).toBe('done')
      await expect(page.getByTestId(`node-${video}`).getByTestId('node-error')).toContainText(
        '內容被拒絕',
      )
      await expect(page.getByTestId('toast')).toContainText('有 1 步沒有成功')
    })
  })
})
