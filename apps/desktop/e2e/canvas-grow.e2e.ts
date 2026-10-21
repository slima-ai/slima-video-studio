import type { Locator, Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'

import ffmpegPath from 'ffmpeg-static'

import { canvasEdges, canvasNodes, kindCount, viewportOf, viewportSettled } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

const oneliner = (page: Page) => page.locator('.react-flow__node[data-id^="node:"]').first()

/** 長完之後畫面停在新的場；把一句話節點拉回畫面中央（畫面外的節點不會畫出來）。 */
async function focusOneliner(page: Page): Promise<void> {
  // 長完時畫面會自己平移到新的場（提示出現前就開始了）；等它停下來再拉回一句話
  await viewportSettled(page)
  await page.evaluate(() => {
    const rf = (
      window as unknown as {
        __svsCanvas?: {
          getNodes: () => { id: string; position: { x: number; y: number }; width?: number }[]
          setCenter: (x: number, y: number, o: object) => unknown
        }
      }
    ).__svsCanvas
    const node = rf?.getNodes().find((n) => n.id.startsWith('node:'))
    if (node)
      void rf?.setCenter(node.position.x + 150, node.position.y + 150, { zoom: 1, duration: 0 })
  })
  await expect(oneliner(page)).toBeVisible()
}

/** 空畫布按「新增一句話」，寫好故事、選 3 個鏡頭、每鏡 3 秒（讓示範模式跑得快）。 */
/** 這一行的中心點上面實際看到的是確認框裡的東西（不是被提示條之類的蓋住）。 */
async function expectNotCovered(page: Page, line: Locator): Promise<void> {
  const box = await line.boundingBox()
  if (!box) throw new Error('找不到這一行')
  const inside = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="run-confirm"]') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  )
  expect(inside, '這一行被別的東西蓋住了').toBe(true)
}

/** 確認框：整個框、清單最後一行、「用什麼」那行、確認鈕都在視窗內，清單沒有被切掉（不用捲動）。 */
async function expectAllInView(page: Page): Promise<void> {
  const confirm = page.getByTestId('run-confirm')
  await expect(confirm).toBeInViewport({ ratio: 1 })
  await expect(confirm.getByTestId('run-confirm-ok')).toBeInViewport({ ratio: 1 })
  const items = confirm.getByTestId('run-confirm-steps').locator('li')
  await expect(items.last()).toBeInViewport({ ratio: 1 })
  await expectNotCovered(page, confirm.getByText(/預估約 US\$/))
  await expectNotCovered(page, confirm.getByTestId('run-confirm-pinned'))
  const cutOff = await confirm
    .getByTestId('run-confirm-steps')
    .locator('ul')
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(cutOff).toBe(false)
}

async function prepare(page: Page, story = '一隻貓在下雨的夜晚找到溫暖的家'): Promise<void> {
  await page.getByTestId('empty-add-oneliner').click()
  await expect(oneliner(page)).toBeVisible()
  await page.getByTestId('oneliner-story').fill(story)
  await page.getByTestId('oneliner-story').blur()
  await pick(page, 'oneliner-shots', '3')
  await pick(page, 'oneliner-duration', '3')
}

/** 按「一次做完整支」→ 看確認面板 → 確認。 */
async function generate(page: Page, options: { replace?: boolean } = {}): Promise<void> {
  await page.getByTestId('oneliner-generate').click()
  await expect(page.getByTestId('run-confirm')).toBeVisible()
  if (options.replace) await page.getByTestId('grow-replace').check()
  await page.getByTestId('run-confirm-ok').click()
  await expect(page.getByTestId('run-confirm')).toHaveCount(0)
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
}

/** 生成結束（資料讀完、畫面也整理好）。提示會停 5 秒，不能拿它判斷是第幾次生成，所以看畫布自己的狀態。 */
const finished = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
    timeout: 60_000,
  })
  await expect(page.getByTestId('toast').filter({ hasText: '短片生成好了' })).toBeVisible()
}

/**
 * 成品的音軌：有幾條、平均音量（dB，用 ffmpeg 的 volumedetect 量；沒有音軌是 undefined，全靜音約 -91）。
 * 不用 ffprobe：打包版沒有，開發版也不一定找得到。
 */
function audioOf(file: string): { tracks: number; meanDb: number | undefined } {
  const run = (args: string[]) =>
    spawnSync(ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-i', file, ...args], { encoding: 'utf8' })
  const info = run([])
  if (!info.stderr.includes('Duration:')) throw new Error(`讀不到影片：${info.stderr.slice(-200)}`)
  const tracks = info.stderr.split('\n').filter((l) => /Stream #\d+:\d+.*: Audio:/.test(l)).length
  if (tracks === 0) return { tracks, meanDb: undefined }
  const mean = /mean_volume: (-?[\d.]+|-inf) dB/.exec(
    run(['-af', 'volumedetect', '-f', 'null', '-']).stderr,
  )
  return { tracks, meanDb: mean?.[1] === undefined ? undefined : Number(mean[1]) }
}

/** 接片一定會留一條音軌：旁白與配樂加上去之後聽得到（平均音量高於 -60 dB），沒加就是靜音（約 -91 dB）。 */
function expectAudio(audio: ReturnType<typeof audioOf>, want: 'audible' | 'silent'): void {
  expect(audio.tracks).toBe(1)
  if (want === 'audible') expect(audio.meanDb ?? -Infinity).toBeGreaterThan(-60)
  else expect(audio.meanDb ?? 0).toBeLessThan(-80)
}

/**
 * 先產生分鏡（卡片上的聲音照 `sound` 勾；勾了旁白，拆鏡就會替每一鏡寫台詞）→ 按右上角「全部生成」。
 * 回傳分鏡寫好之後每一鏡的台詞、按下之前確認面板的文字。
 */
async function storyboardThenGenerateAll(
  page: Page,
  sound: { narration: boolean; music: boolean },
): Promise<{ confirmText: string; dialogues: string[] }> {
  await prepare(page)
  // 影片原聲關掉：成品裡有沒有音軌，完全看旁白與配樂有沒有加
  await page.getByTestId('oneliner-sound-native').uncheck()
  for (const key of ['narration', 'music'] as const) {
    if (!sound[key]) await page.getByTestId(`oneliner-sound-${key}`).uncheck()
  }
  await page.getByTestId('oneliner-storyboard').click()
  await page.getByTestId('run-confirm-ok').click()
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
    timeout: 60_000,
  })
  await expect.poll(() => kindCount(page, 'shot')).toBe(3)
  const dialogues = await page.evaluate(async () => {
    const list = await window.svs.invoke('shots.list', {})
    if (!list.ok) throw new Error(list.error.userMessage)
    return list.data.shots.map((shot) => shot.dialogue)
  })
  await page.getByTestId('run-all').click()
  const confirm = page.getByTestId('run-confirm')
  await expect(confirm).toBeVisible()
  const confirmText = await confirm.innerText()
  await page.getByTestId('run-confirm-ok').click()
  await expect(confirm).toHaveCount(0)
  return { confirmText, dialogues }
}

const soundState = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.svs.invoke('sound.get', {})
    if (!result.ok) throw new Error(result.error.userMessage)
    const { shots, music, final } = result.data
    return {
      narrated: shots.filter((s) => s.narration !== undefined).length,
      shots: shots.length,
      music: music !== undefined,
      hasSound: final?.hasSound,
      finalVersion: final?.version,
    }
  })

/** 匯出最新成品（不加片尾字卡）並回傳檔案路徑。 */
const exportedFinal = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const result = await window.svs.invoke('quickstart.export', { credits: false })
    if (!result.ok) throw new Error(result.error.userMessage)
    return result.data.path
  })

test.describe('畫布上的一句話（示範模式）', () => {
  test('寫一句話 → 確認花費 → 畫布長出場、鏡頭、圖、影片和剪輯，一句話連到新的場', async ({
    page,
  }) => {
    await prepare(page)
    await page.getByTestId('oneliner-generate').click()
    // 確認面板列出會做什麼與預估花費；示範模式註明不會花錢
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('拆成 3 個鏡頭')
    await expect(confirm).toContainText('3 支影片（每支 3 秒）')
    // 卡片上預設勾了旁白與配樂：彈窗也要列出來，花費已經算進預估
    await expect(confirm).toContainText('旁白')
    await expect(confirm).toContainText('一首配樂')
    await expect(confirm).toContainText('花費已算進預估')
    await expect(confirm).toContainText('示範模式')
    await expect(confirm).toContainText('預估約')
    // 專案還是空的：沒有「取代全部」
    await expect(page.getByTestId('grow-replace')).toHaveCount(0)
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')

    // 生成中：上方列寫「生成中」，旁邊有停止
    await expect(page.getByTestId('run-progress')).toContainText('生成中')
    await expect(page.getByTestId('run-stop')).toBeVisible()
    await finished(page)

    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
    // 剛生成好的圖與影片不會被當成「需要重跑」
    expect((await canvasNodes(page)).filter((n) => n.data.status === 'stale')).toHaveLength(0)
    expect(await kindCount(page, 'shot')).toBe(3)
    expect(await kindCount(page, 'image')).toBe(3)
    expect(await kindCount(page, 'video')).toBe(3)
    expect(await kindCount(page, 'cut')).toBe(1)
    const nodes = await canvasNodes(page)
    const scene = nodes.find((n) => n.data.kind === 'scene')
    const one = nodes.find((n) => n.data.kind === 'oneliner')
    expect(nodes.filter((n) => n.data.kind === 'video').map((n) => n.data.status)).toEqual([
      'done',
      'done',
      'done',
    ])
    expect(one?.data.status).not.toBe('running')
    // 一句話的線連到新的場
    const edges = await canvasEdges(page)
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: one?.id,
        sourceHandle: 'story-out',
        target: scene?.id,
        targetHandle: 'scene-story',
      }),
    )
    // 生成好了，按鈕回到可以再生成（畫面可能已經平移到新的場，先把一句話拉回來）
    await focusOneliner(page)
    await expect(page.getByTestId('oneliner-generate')).toHaveText('一次做完整支')
  })

  test('長完之後一眼看到整串：1440×900 的視窗，先產生分鏡，剪輯在畫面內，縮放不低於看得清楚的下限', async ({
    app,
    page,
  }) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
    })
    // 預設的 4 個鏡頭（第一次用的人不會去改）
    await page.getByTestId('empty-add-oneliner').click()
    await expect(oneliner(page)).toBeVisible()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await page.getByTestId('oneliner-storyboard').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    await viewportSettled(page)
    // 一句話、第一鏡、最後一鏡的影片、剪輯，整串都在畫面內（以前停在 100%，剪輯在右邊外面）
    const nodes = await canvasNodes(page)
    const lastVideo = nodes.filter((n) => n.data.kind === 'video').at(-1)
    if (!lastVideo) throw new Error('沒有影片格子')
    for (const id of [
      nodes.find((n) => n.data.kind === 'oneliner')?.id ?? '',
      lastVideo.id,
      'cut',
    ]) {
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeInViewport({
        ratio: 0.9,
      })
    }
    // 縮到看不清楚（卡片只剩色塊）就失去意義：不低於 50%
    expect((await viewportOf(page)).zoom).toBeGreaterThanOrEqual(0.5)
  })

  test('確認框的內容在 1280×800 全部放得下：先產生分鏡與全部生成都看得到每一行，包括「用什麼」那行', async ({
    app,
    page,
  }, testInfo) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
    })
    await page.getByTestId('empty-add-oneliner').click()
    await expect(oneliner(page)).toBeVisible()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    // 預設 4 個鏡頭
    await page.getByTestId('oneliner-storyboard').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toBeVisible()
    await expectAllInView(page)
    await expect(confirm.getByTestId('run-confirm-pinned')).toContainText('這一步用：')
    await page.screenshot({ path: testInfo.outputPath('confirm-storyboard.png') })
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)

    // 全部生成：4 鏡 = 9 步（8 步 + 接成成品），一行都不能被切掉
    await page.getByTestId('run-all').click()
    await expect(confirm).toContainText('這次會做 9 步')
    await expectAllInView(page)
    await expect(confirm.getByTestId('run-confirm-steps')).toContainText('接成成品')
    await expect(confirm.getByTestId('run-confirm-pinned')).toContainText('用：')
    await expect(confirm.getByTestId('run-confirm-more')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('confirm-9-steps.png') })
  })

  test('「分鏡寫好了」的提示條還在的時候按「全部生成」：提示條不蓋在確認框上（價錢那行看得到），框關掉之後提示條回來、「復原」還在', async ({
    app,
    page,
  }) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
    })
    await page.getByTestId('empty-add-oneliner').click()
    await expect(oneliner(page)).toBeVisible()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await page.getByTestId('oneliner-storyboard').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    // 提示條剛出現，馬上按「全部生成」（真的使用者就是這樣）
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('分鏡寫好了')
    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toBeVisible()
    // 價錢那一行中心點上看到的是確認框裡的東西；提示條先收起來
    await expectNotCovered(page, confirm.getByText(/預估約 US\$/))
    await expectNotCovered(page, confirm.getByTestId('run-confirm-pinned'))
    await expect(toast).toBeHidden()
    // 取消：提示條回來，「復原」還在
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(toast).toBeVisible()
    await expect(toast.getByTestId('toast-action')).toHaveText('復原')
  })

  test('步驟很多（27 鏡）：清單可以捲動，看得出下面還有；「用什麼」與價錢那行永遠看得到', async ({
    app,
    page,
  }, testInfo) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
    })
    await page.getByTestId('empty-add-oneliner').click()
    await expect(oneliner(page)).toBeVisible()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await page.getByTestId('oneliner-storyboard').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    await expect.poll(() => kindCount(page, 'shot')).toBe(4)
    // 補到 27 個鏡頭（都放進第一個場）
    await page.evaluate(async () => {
      const list = await window.svs.invoke('shots.list', {})
      if (!list.ok) throw new Error(list.error.userMessage)
      const sceneId = list.data.shots[0]?.sceneId
      for (let i = list.data.shots.length; i < 27; i++) {
        const made = await window.svs.invoke('shots.create', { sceneId })
        if (!made.ok) throw new Error(made.error.userMessage)
      }
    })
    await expect.poll(() => kindCount(page, 'shot')).toBe(27)

    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('這次會做 55 步')
    // 整個框、價錢、「用什麼」、確認鈕都在視窗內；清單捲動，而且有提示
    await expect(confirm).toBeInViewport({ ratio: 1 })
    await expect(confirm.getByTestId('run-confirm-pinned')).toBeInViewport({ ratio: 1 })
    await expect(confirm.getByTestId('run-confirm-ok')).toBeInViewport({ ratio: 1 })
    await expect(confirm.getByText(/預估約 US\$/)).toBeInViewport({ ratio: 1 })
    await expectNotCovered(page, confirm.getByText(/預估約 US\$/))
    await expectNotCovered(page, confirm.getByTestId('run-confirm-pinned'))
    await expect(confirm.getByTestId('run-confirm-more')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('confirm-27-shots.png') })
    const scrollable = await confirm
      .getByTestId('run-confirm-steps')
      .locator('ul')
      .evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(scrollable).toBe(true)
    // 捲到底：提示消失
    await confirm
      .getByTestId('run-confirm-steps')
      .locator('ul')
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
    await expect(confirm.getByTestId('run-confirm-more')).toHaveCount(0)
  })

  test('主按鈕「先產生分鏡」：白話說兩步各多少錢 → 只長出場與鏡頭，沒有圖片、影片和成品', async ({
    page,
  }) => {
    await prepare(page)
    await expect(page.getByTestId('oneliner-storyboard')).toHaveText('先產生分鏡')
    await page.getByTestId('oneliner-storyboard').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('這一步只寫分鏡')
    await expect(confirm).toContainText('下一步才生圖片和影片')
    await expect(confirm).toContainText('全部生成')
    await expect(confirm).toContainText('準確的預估')
    await expect(confirm).toContainText('旁白與配樂也不在這一步')
    await expect(page.getByTestId('oneliner-sound-note')).toContainText('按右上角的「全部生成」')
    await expect(confirm).toContainText('示範模式')
    // 兩個價錢都寫出來：這一步、下一步
    await expect(confirm).toContainText(/約 US\$\d+\.\d\d/)
    await expect(confirm.getByText(/下一步才生圖片和影片：.*約 US\$\d+\.\d\d/)).toBeVisible()
    await expect(confirm).not.toContainText('接成一支完整的片子')
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
      timeout: 60_000,
    })
    const done = page.getByTestId('toast').filter({ hasText: '分鏡寫好了' })
    await expect(done).toBeVisible()
    // 分鏡寫好之後，畫面上提到「全部生成」的價錢只有一個來源：右上角那顆；提示不寫數字
    await expect(done).not.toContainText('US$')
    await expect(page.getByTestId('run-all')).toContainText(/全部生成（約 US\$\d+\.\d\d/)
    const prices = await page.evaluate(() => {
      const found = new Set<string>()
      for (const el of document.querySelectorAll(
        '[data-testid="toast"], [data-testid="run-all"]',
      )) {
        const text = el.textContent
        if (!text.includes('全部生成')) continue
        for (const m of text.matchAll(/US\$\d+\.\d\d/g)) found.add(m[0])
      }
      return [...found]
    })
    expect(prices).toHaveLength(1)
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
    expect(await kindCount(page, 'shot')).toBe(3)
    // 圖片、影片、成品都還沒生成
    const nodes = await canvasNodes(page)
    expect(nodes.filter((n) => n.data.kind === 'video' && n.data.status === 'done')).toHaveLength(0)
    expect(nodes.filter((n) => n.data.kind === 'image' && n.data.status === 'done')).toHaveLength(0)
    expect(nodes.find((n) => n.data.kind === 'cut')?.data.status).not.toBe('done')
    // 一句話的線連到新的場；按鈕回到可以再按
    const one = nodes.find((n) => n.data.kind === 'oneliner')
    const scene = nodes.find((n) => n.data.kind === 'scene')
    expect(await canvasEdges(page)).toContainEqual(
      expect.objectContaining({ source: one?.id, target: scene?.id }),
    )
    await focusOneliner(page)
    await expect(page.getByTestId('oneliner-storyboard')).toHaveText('先產生分鏡')
    await expect(page.getByTestId('oneliner-storyboard')).toBeEnabled()
  })

  test('選幾鏡就長出幾鏡：5 鏡的描述照故事分段、全是中文；剪輯顯示 5/5 鏡', async ({ page }) => {
    await prepare(
      page,
      '一隻貓在下雨的夜晚，躲進巷子裡的紙箱，遇到一個撐傘的小女孩，被抱回家，在暖爐旁睡著了',
    )
    await pick(page, 'oneliner-shots', '5')
    await generate(page)
    await finished(page)
    const shots = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    expect(shots).toHaveLength(5)
    const summaries = shots.map((n) => (n.data as { summary?: string }).summary ?? '')
    expect(summaries[0]).toBe('開場：一隻貓在下雨的夜晚')
    expect(summaries[4]).toBe('結尾：在暖爐旁睡著了')
    for (const text of summaries) expect(text).not.toMatch(/[a-z]/i)
    const cut = (await canvasNodes(page)).find((n) => n.data.kind === 'cut')
    expect(cut?.data.slots).toEqual([expect.objectContaining({ note: '5/5 鏡' })])
  })

  test('再生成一次預設新增成新的一場；勾「取代全部」要警告，確認後只剩新的', async ({ page }) => {
    await prepare(page)
    await generate(page)
    await finished(page)
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)

    // 第二次：不勾取代 → 兩個場、六個鏡頭，舊的還在
    await focusOneliner(page)
    await generate(page)
    await finished(page)
    await expect.poll(() => kindCount(page, 'scene')).toBe(2)
    expect(await kindCount(page, 'shot')).toBe(6)
    const one = (await canvasNodes(page)).find((n) => n.data.kind === 'oneliner')
    expect((await canvasEdges(page)).filter((e) => e.source === one?.id)).toHaveLength(2)

    // 第三次：勾取代全部 → 警告、確認鈕改字，取消不會動資料
    await focusOneliner(page)
    await page.getByTestId('oneliner-generate').click()
    await page.getByTestId('grow-replace').check()
    await expect(page.getByTestId('grow-replace-warning')).toContainText('會刪掉 2 個場、6 個鏡頭')
    await expect(page.getByTestId('grow-replace-warning')).toContainText('復原')
    await expect(page.getByTestId('run-confirm-ok')).toHaveText('刪掉並生成')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
    expect(await kindCount(page, 'scene')).toBe(2)

    // 真的取代：回到一個場、三個鏡頭
    await page.getByTestId('oneliner-generate').click()
    await page.getByTestId('grow-replace').check()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')
    await finished(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    await expect.poll(() => kindCount(page, 'scene')).toBe(1)
    const after = (await canvasNodes(page)).find((n) => n.data.kind === 'oneliner')
    expect((await canvasEdges(page)).filter((e) => e.source === after?.id)).toHaveLength(1)
  })

  test('整次生成一步就能復原、也能重做；刪掉現有內容重新生成之後復原，舊的內容全部回來', async ({
    page,
  }) => {
    await prepare(page)
    await generate(page)
    await finished(page)
    expect(await kindCount(page, 'shot')).toBe(3)
    // 長完的提示就有「復原」
    await page.getByTestId('toast').getByRole('button', { name: '復原' }).click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(0)
    expect(await kindCount(page, 'scene')).toBe(0)
    // 一句話本身還在（它是生成之前就新增的）
    expect(await kindCount(page, 'oneliner')).toBe(1)
    await page.getByTestId('redo').click()
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    expect(await kindCount(page, 'video')).toBe(3)
    const before = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot').map((n) => n.id)

    // 刪掉現有內容重新生成 → 復原：舊的三個鏡頭（同一批）回來，新的不見
    await focusOneliner(page)
    await generate(page, { replace: true })
    await finished(page)
    await expect
      .poll(async () =>
        (await canvasNodes(page)).filter((n) => n.data.kind === 'shot').map((n) => n.id),
      )
      .not.toEqual(before)
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () =>
        (await canvasNodes(page)).filter((n) => n.data.kind === 'shot').map((n) => n.id),
      )
      .toEqual(before)
    expect(await kindCount(page, 'scene')).toBe(1)
    expect((await canvasNodes(page)).filter((n) => n.data.status === 'stale')).toHaveLength(0)
  })

  test('故事離開輸入框就存起來，重新載入還在；沒寫故事不能生成', async ({ page }) => {
    await page.getByTestId('empty-add-oneliner').click()
    await expect(page.getByTestId('oneliner-generate')).toBeDisabled()
    await page.getByTestId('oneliner-story').fill('機器人學畫畫')
    await page.getByTestId('oneliner-story').blur()
    await expect(page.getByTestId('oneliner-generate')).toBeEnabled()
    await pick(page, 'oneliner-style', 'anime')
    await page.reload()
    await expect(page.getByTestId('oneliner-story')).toHaveValue('機器人學畫畫')
    await expect(page.getByTestId('oneliner-style')).toContainText('日系動畫')
  })

  test.describe('示範模式放慢', () => {
    // 示範模式本來一瞬間就做完；不放慢的話，按「停止」之前可能已經生成好了，按鈕就消失了
    test.use({ appEnv: { SVS_MOCK_LATENCY_MS: '400' } })
    test('長的過程中畫面不動、欄位鎖住並說明原因、佇列不會自己展開；長完才一次把一句話和新的場放進畫面', async ({
      page,
    }) => {
      await prepare(page)
      // 每個欄位都有看得到的標籤
      const node = oneliner(page)
      await expect(page.getByTestId('oneliner-story')).toHaveAccessibleName('故事')
      for (const label of ['畫風', '鏡頭數', '每鏡幾秒', '畫面比例']) {
        await expect(node.getByText(label, { exact: true })).toBeVisible()
      }
      await viewportSettled(page)
      const view = await viewportOf(page)
      await generate(page)
      await expect(page.getByTestId('oneliner-story')).toBeDisabled()
      await expect(page.getByTestId('oneliner-locked')).toContainText('生成中，故事和設定先鎖住')
      // 已經長出幾個鏡頭了，畫面還在原地；佇列只在標題列顯示數量
      await expect.poll(() => kindCount(page, 'shot'), { timeout: 30_000 }).toBe(3)
      expect(await viewportOf(page)).toEqual(view)
      await expect(page.getByTestId('queue-panel')).toHaveAttribute('data-collapsed', 'true')
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'true')

      await finished(page)
      expect(await viewportOf(page)).not.toEqual(view)
      const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
      await expect(page.locator(`.react-flow__node[data-id="${scene?.id ?? ''}"]`)).toBeInViewport()
      await expect(oneliner(page)).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('oneliner-locked')).toHaveCount(0)
      await expect(page.getByTestId('queue-panel')).toHaveAttribute('data-collapsed', 'true')
    })

    test('生成到一半按「停止」：提示已停止，一句話回到可以再生成', async ({ page }) => {
      await prepare(page)
      await generate(page)
      await page.getByTestId('run-stop').click()
      await expect(page.getByTestId('toast').filter({ hasText: '已經停止生成' })).toBeVisible()
      await focusOneliner(page)
      await expect(page.getByTestId('oneliner-generate')).toHaveText('一次做完整支')
    })
  })

  test('沒有設定模型（示範模式關閉）→ 用提示說明，不會跳出確認', async ({ page }) => {
    await page.getByRole('button', { name: '設定' }).click()
    await page.getByTestId('demo-mode').uncheck()
    await page.getByRole('button', { name: '畫布' }).click()
    await prepare(page)
    await page.getByTestId('oneliner-generate').click()
    await expect(page.getByTestId('toast').filter({ hasText: '請到設定填入' })).toBeVisible()
    await expect(page.getByTestId('run-confirm')).toHaveCount(0)
  })

  test('先產生分鏡 → 全部生成：照卡片勾的旁白與配樂，預估含聲音，成品聽得到聲音', async ({
    page,
  }) => {
    const { confirmText, dialogues } = await storyboardThenGenerateAll(page, {
      narration: true,
      music: true,
    })
    // 勾了旁白：先產生分鏡就替每一鏡寫了台詞，鏡頭卡上看得到（「旁白：…」），也改得到
    expect(dialogues).toHaveLength(3)
    for (const line of dialogues) expect(line.trim().length).toBeGreaterThan(0)
    await expect(page.getByTestId('shot-dialogue').first()).toContainText('旁白：')
    expect(confirmText).toMatch(/接好片之後自動加旁白與配樂（約 US\$\d+\.\d\d）/)
    expect(confirmText).toContain('旁白：3 個鏡頭有台詞，會念出來')
    await expect(page.getByTestId('toast').filter({ hasText: '旁白與配樂也加好了' })).toBeVisible({
      timeout: 60_000,
    })
    const state = await soundState(page)
    expect(state).toMatchObject({ narrated: 3, shots: 3, music: true, hasSound: true })
    // 佇列裡有旁白那一筆（3 句台詞各一筆語音）
    const jobs = await page.evaluate(async () => {
      const result = await window.svs.invoke('queue.list', {})
      return result.ok ? result.data.jobs.filter((job) => job.kind === 'tts').length : -1
    })
    expect(jobs).toBe(3)
    // 影片原聲關著（沒加聲音的對照是靜音），所以聽得到聲音就是旁白與配樂混出來的
    expectAudio(audioOf(await exportedFinal(page)), 'audible')
  })

  test('先產生分鏡時只勾旁白：全部生成只念旁白，不生配樂', async ({ page }) => {
    const { confirmText } = await storyboardThenGenerateAll(page, { narration: true, music: false })
    expect(confirmText).toContain('接好片之後自動加旁白（約')
    expect(confirmText).not.toContain('配樂')
    await expect(page.getByTestId('toast').filter({ hasText: '旁白加好了' })).toBeVisible({
      timeout: 60_000,
    })
    expect(await soundState(page)).toMatchObject({ narrated: 3, music: false, hasSound: true })
    expectAudio(audioOf(await exportedFinal(page)), 'audible')
  })

  test('先產生分鏡時旁白與配樂都沒勾：全部生成不加聲音，成品是靜音的', async ({ page }) => {
    const { confirmText } = await storyboardThenGenerateAll(page, {
      narration: false,
      music: false,
    })
    expect(confirmText).not.toContain('自動加')
    await expect(page.getByTestId('toast').filter({ hasText: '成品接好了' })).toBeVisible({
      timeout: 60_000,
    })
    expect(await soundState(page)).toMatchObject({ narrated: 0, music: false, hasSound: false })
    expectAudio(audioOf(await exportedFinal(page)), 'silent')
  })

  test('一次做完整支：完成的提示照實說——勾了旁白與配樂就是「旁白與配樂也加好了」（示範的鏡頭有台詞）', async ({
    page,
  }) => {
    await prepare(page)
    await generate(page)
    await finished(page)
    await expect(
      page.getByTestId('toast').filter({ hasText: '短片生成好了（旁白與配樂也加好了）' }),
    ).toBeVisible()
    expect(await soundState(page)).toMatchObject({ narrated: 3, music: true, hasSound: true })
  })

  test('一次做完整支沒勾旁白：不寫台詞，完成的提示說配樂加好了、沒有提到旁白', async ({ page }) => {
    await prepare(page)
    await page.getByTestId('oneliner-sound-narration').uncheck()
    await generate(page)
    await finished(page)
    await expect(
      page.getByTestId('toast').filter({ hasText: '短片生成好了（配樂加好了）' }),
    ).toBeVisible()
    expect(await soundState(page)).toMatchObject({ narrated: 0, music: true, hasSound: true })
  })

  test('不勾旁白：先產生分鏡不寫台詞，鏡頭卡上沒有旁白，確認面板說旁白不會念，只加配樂', async ({
    page,
  }) => {
    const { confirmText, dialogues } = await storyboardThenGenerateAll(page, {
      narration: false,
      music: true,
    })
    expect(dialogues).toEqual(['', '', ''])
    await expect(page.getByTestId('shot-dialogue')).toHaveCount(0)
    expect(confirmText).toMatch(/接好片之後自動加配樂（約 US\$\d+\.\d\d）/)
    expect(confirmText).not.toContain('自動加旁白')
    await expect(page.getByTestId('toast').filter({ hasText: '配樂加好了' })).toBeVisible({
      timeout: 60_000,
    })
    expect(await soundState(page)).toMatchObject({ narrated: 0, music: true, hasSound: true })
  })

  test('一次做完整支勾了旁白：每一鏡也有台詞，做完有旁白，成品聽得到', async ({ page }) => {
    await prepare(page)
    await page.getByTestId('oneliner-sound-native').uncheck()
    await page.getByTestId('oneliner-sound-music').uncheck()
    await page.getByTestId('oneliner-generate').click()
    await page.getByTestId('run-confirm-ok').click()
    await finished(page)
    await expect.poll(() => kindCount(page, 'shot')).toBe(3)
    const dialogues = await page.evaluate(async () => {
      const list = await window.svs.invoke('shots.list', {})
      if (!list.ok) throw new Error(list.error.userMessage)
      return list.data.shots.map((shot) => shot.dialogue)
    })
    for (const line of dialogues) expect(line.trim().length).toBeGreaterThan(0)
    // 做完整支時，接好片之後照勾選加旁白：3 句台詞各念一次
    expect(await soundState(page)).toMatchObject({ narrated: 3, music: false, hasSound: true })
  })

  test('鏡頭卡上的旁白雙擊就能改：改完存起來、可以復原；清空就是不念', async ({ page }) => {
    await storyboardThenGenerateAll(page, { narration: true, music: false })
    // 先等背景自動加旁白做完：它的提示會蓋掉「已改這一鏡的旁白」
    await expect(page.getByTestId('toast').filter({ hasText: '旁白加好了' })).toBeVisible({
      timeout: 60_000,
    })
    const card = page.getByTestId('shot-dialogue').first()
    await card.dblclick()
    const input = page.getByTestId('shot-dialogue-edit')
    await input.fill('雨停了，貓走進屋裡。')
    await input.press('Enter')
    await expect(page.getByTestId('shot-dialogue').first()).toContainText('雨停了，貓走進屋裡。')
    await expect(page.getByTestId('toast').filter({ hasText: '已改這一鏡的旁白' })).toBeVisible()
    await page.getByTestId('toast').getByRole('button', { name: '復原' }).click()
    await expect(page.getByTestId('shot-dialogue').first()).not.toContainText(
      '雨停了，貓走進屋裡。',
    )
  })

  test('旁白念到一半使用者改了那一鏡的台詞：改的字留著，舊聲音標出「跟台詞不一樣」，不會悄悄掛上去', async ({
    page,
  }) => {
    await storyboardThenGenerateAll(page, { narration: true, music: false })
    await expect(page.getByTestId('toast').filter({ hasText: '旁白加好了' })).toBeVisible({
      timeout: 60_000,
    })
    const fresh = '雨停了，貓走進屋裡。'
    // 同時送出：念第 3 鏡（讀的是舊台詞）、使用者把第 3 鏡的台詞改掉
    const result = await page.evaluate(async (line) => {
      const list = await window.svs.invoke('shots.list', {})
      if (!list.ok) throw new Error(list.error.userMessage)
      const third = list.data.shots[2]
      if (!third) throw new Error('沒有第 3 鏡')
      const narrating = window.svs.invoke('sound.generateNarration', { shotId: third.id })
      await window.svs.invoke('shots.update', { shotId: third.id, patch: { dialogue: line } })
      await narrating
      const state = await window.svs.invoke('sound.get', {})
      if (!state.ok) throw new Error(state.error.userMessage)
      const view = state.data.shots.find((s) => s.shotId === third.id)
      return {
        shotId: third.id,
        dialogue: view?.dialogue,
        narrationText: view?.narration?.text,
        warnings: state.data.warnings.map((w) => ({ kind: w.kind, shotId: w.shotId })),
      }
    }, fresh)
    // 改的字沒有被蓋回舊的
    expect(result.dialogue).toBe(fresh)
    // 聲音是用舊字念的：一定要有提示，使用者才知道要重念
    expect(result.narrationText).not.toBe(fresh)
    expect(result.warnings).toContainEqual({
      kind: 'narration_text_changed',
      shotId: result.shotId,
    })
  })

  test('加過就不再自動補：刪掉配樂再按全部生成，配樂不會回來；在卡片上重新勾就再加', async ({
    page,
  }) => {
    await storyboardThenGenerateAll(page, { narration: true, music: true })
    await expect(page.getByTestId('toast').filter({ hasText: '旁白與配樂也加好了' })).toBeVisible({
      timeout: 60_000,
    })
    const first = await soundState(page)
    expect(first).toMatchObject({ narrated: 3, music: true })

    // 使用者刪掉配樂，又多加一個有台詞的鏡頭
    await page.evaluate(async () => {
      const state = await window.svs.invoke('sound.get', {})
      if (!state.ok || !state.data.music) throw new Error('應該有配樂')
      const removed = await window.svs.invoke('sound.removeClip', { clipId: state.data.music.id })
      if (!removed.ok) throw new Error(removed.error.userMessage)
      const list = await window.svs.invoke('shots.list', {})
      if (!list.ok) throw new Error(list.error.userMessage)
      const created = await window.svs.invoke('shots.create', {
        sceneId: list.data.shots[0]?.sceneId,
      })
      if (!created.ok) throw new Error(created.error.userMessage)
      const edited = await window.svs.invoke('shots.update', {
        shotId: created.data.id,
        patch: { dialogue: '多出來的一鏡。' },
      })
      if (!edited.ok) throw new Error(edited.error.userMessage)
    })
    expect((await soundState(page)).music).toBe(false)

    // 再按全部生成：確認面板不提自動加聲音，生成完配樂還是沒有
    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toBeVisible()
    expect(await confirm.innerText()).not.toContain('自動加')
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(async () => (await soundState(page)).finalVersion, { timeout: 60_000 })
      .toBeGreaterThan(first.finalVersion ?? 0)
    await expect(page.getByTestId('toast').filter({ hasText: '成品接好了' })).toBeVisible()
    expect(await soundState(page)).toMatchObject({ music: false, narrated: 3 })

    // 在卡片上重新勾一次「配樂」（取消再勾回來）：下一次全部生成再照勾選加
    await focusOneliner(page)
    await page.getByTestId('oneliner-sound-music').uncheck()
    await page.getByTestId('oneliner-sound-music').check()
    await page.evaluate(async () => {
      const list = await window.svs.invoke('shots.list', {})
      if (!list.ok) throw new Error(list.error.userMessage)
      const created = await window.svs.invoke('shots.create', {
        sceneId: list.data.shots[0]?.sceneId,
      })
      if (!created.ok) throw new Error(created.error.userMessage)
    })
    await page.getByTestId('run-all').click()
    await expect(page.getByTestId('run-confirm')).toContainText('接好片之後自動加')
    await page.getByTestId('run-confirm-ok').click()
    await expect.poll(async () => (await soundState(page)).music, { timeout: 60_000 }).toBe(true)
  })
})
