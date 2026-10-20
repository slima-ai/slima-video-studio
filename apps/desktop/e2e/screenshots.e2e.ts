import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Locator, Page, TestInfo } from '@playwright/test'

import {
  canvasNodes,
  centerOn,
  generateAndOpenCanvas,
  kindCount,
  viewportSettled,
} from './canvas-helpers'
import { expect, test } from './fixtures'
import { characterNameInput } from './character-name'
import { pick } from './pick'

/** 截圖存在 test-results；有設 SVS_SCREENSHOT_DIR 就另外複製一份過去。 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  // 顏色漸變、淡入淡出都播完再拍，才不會拍到停用鈕變色的中間狀態
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  await page.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, name))
  }
}

/** 畫布的浮動面板滑入動畫播完：右緣離畫布右緣 12px。 */
async function canvasPanelSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.getByTestId('canvas-panel').boundingBox()
      const root = await page.getByTestId('canvas-root').boundingBox()
      return box && root ? Math.abs(box.x + box.width - (root.x + root.width - 12)) <= 1 : false
    })
    .toBe(true)
}

/** 面板滑入動畫播完：右緣貼齊視窗右緣。 */
async function panelSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.getByTestId('layout-panel').boundingBox()
      const width = await page.evaluate(() => window.innerWidth)
      return box ? Math.abs(box.x + box.width - width) <= 1 : false
    })
    .toBe(true)
}

/** 展開一個自訂下拉選單拍一張，再用 Esc 收起來。 */
async function shootOpenSelect(
  page: Page,
  testInfo: TestInfo,
  testId: string,
  name: string,
): Promise<void> {
  await page.getByTestId(testId).click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  await expect(list).toHaveCSS('opacity', '1')
  await shoot(page, testInfo, name)
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
}

const THEMES = [
  { name: 'dark', label: '深色', background: 'rgb(11, 11, 15)' },
  { name: 'light', label: '淺色', background: 'rgb(245, 245, 248)' },
] as const

/** 到設定頁選外觀，等顏色漸變完。 */
async function chooseTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.getByRole('button', { name: '設定' }).click()
  await page.getByTestId('general-section').getByText(theme.label, { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.name)
  await expect(page.locator('body')).toHaveCSS('background-color', theme.background)
}

/**
 * 各頁面的畫面截圖（深色／淺色），給 UI 審查用。
 * 設定 SVS_SCREENSHOT_DIR 會另外複製一份到那個資料夾，沒設定就只留在 test-results。
 */
for (const theme of THEMES) {
  test.describe(`畫面截圖（${theme.label}）`, () => {
    test('畫布上的一句話：寫好故事、確認面板、長出節點、取代全部的警告', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '畫布' }).click()
      await page.getByTestId('empty-add-oneliner').click()
      await expect(page.getByTestId('oneliner-story')).toBeVisible()
      await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
      await page.getByTestId('oneliner-story').blur()
      await pick(page, 'oneliner-shots', '3')
      await pick(page, 'oneliner-duration', '3')
      await viewportSettled(page)
      await shoot(page, testInfo, `canvas-oneliner-${theme.name}.png`)

      await page.getByTestId('oneliner-generate').click()
      await expect(page.getByTestId('run-confirm')).toBeVisible()
      await shoot(page, testInfo, `canvas-oneliner-confirm-${theme.name}.png`)
      await page.getByTestId('run-confirm-ok').click()
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-growing', 'false', {
        timeout: 60_000,
      })
      await viewportSettled(page)
      await page.getByTestId('fit-view').click()
      await viewportSettled(page)
      await shoot(page, testInfo, `canvas-oneliner-grown-${theme.name}.png`)

      // 再生成一次：勾「取代全部」會警告
      await page.evaluate(() => {
        const rf = (
          window as unknown as {
            __svsCanvas?: {
              getNodes: () => { id: string; position: { x: number; y: number } }[]
              setCenter: (x: number, y: number, o: object) => unknown
            }
          }
        ).__svsCanvas
        const node = rf?.getNodes().find((n) => n.id.startsWith('node:'))
        if (node)
          void rf?.setCenter(node.position.x + 150, node.position.y + 150, { zoom: 1, duration: 0 })
      })
      await page.getByTestId('oneliner-generate').click()
      await page.getByTestId('grow-replace').check()
      await expect(page.getByTestId('grow-replace-warning')).toContainText('會刪掉')
      await shoot(page, testInfo, `canvas-oneliner-replace-${theme.name}.png`)
    })

    test('畫布執行：影片節點 ▶ 的確認面板與標亮的那一串、上方列全部生成', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await chooseTheme(page, theme)
      await generateAndOpenCanvas(page)
      await expect.poll(() => kindCount(page, 'shot')).toBe(3)
      const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
      if (!added.ok) throw new Error(added.error.userMessage)
      await expect.poll(() => kindCount(page, 'shot')).toBe(4)
      const video = `${added.data.key}:video`
      await centerOn(page, video)
      await viewportSettled(page)
      await page.getByTestId(`run-${video}`).click()
      await expect(page.getByTestId('run-confirm')).toBeVisible()
      await expect
        .poll(async () => (await canvasNodes(page)).filter((n) => n.data.glow === true).length)
        .toBe(3)
      await shoot(page, testInfo, `canvas-run-confirm-${theme.name}.png`)
      await page.keyboard.press('Escape')

      await page.getByTestId('run-all').click()
      await expect(page.getByTestId('run-confirm')).toBeVisible()
      await shoot(page, testInfo, `canvas-run-all-${theme.name}.png`)
      await page.keyboard.press('Escape')

      // 改了第 1 鏡的描述：它的圖和影片標「需要重跑」
      const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
      if (!first) throw new Error('找不到鏡頭')
      await page.evaluate(
        (id) =>
          window.svs.invoke('shots.update', {
            shotId: id,
            patch: { description: '貓抬頭看著月亮' },
          }),
        first.id.replace(/^shot:/, ''),
      )
      await expect
        .poll(async () => (await canvasNodes(page)).filter((n) => n.data.status === 'stale').length)
        .toBe(2)
      await centerOn(page, `${first.id}:image`)
      await viewportSettled(page)
      await shoot(page, testInfo, `canvas-stale-${theme.name}.png`)
    })

    test('畫布詳情面板：鏡頭面板與成品面板', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await chooseTheme(page, theme)
      await generateAndOpenCanvas(page)
      const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
      if (!first) throw new Error('找不到鏡頭')
      await centerOn(page, first.id)
      await page.getByTestId(`open-${first.id}`).click()
      await expect(page.getByTestId('shot-panel')).toBeVisible()
      await canvasPanelSettled(page)
      await viewportSettled(page)
      await shoot(page, testInfo, `canvas-panel-shot-${theme.name}.png`)
      await page.keyboard.press('Escape')
      await centerOn(page, 'cut')
      await page.getByTestId('open-cut').click()
      await expect(page.getByTestId('final-cut-video')).toBeVisible()
      await shoot(page, testInfo, `canvas-panel-cut-${theme.name}.png`)
    })

    test('畫布首頁：空畫布、有內容、選取一個鏡頭、縮小到只剩標題與色塊', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '畫布' }).click()
      await expect(page.getByTestId('canvas-empty')).toBeVisible()
      await shoot(page, testInfo, `canvas-empty-${theme.name}.png`)

      // 用一句話生成一支 3 鏡的影片，畫布就有一個場、三個鏡頭與剪輯節點
      await generateAndOpenCanvas(page)
      await expect(
        page.getByTestId('canvas-root').locator('.react-flow__node').first(),
      ).toBeVisible()
      // 全部顯示，等視角動畫結束
      await page.getByTestId('fit-view').click()
      await viewportSettled(page)
      await shoot(page, testInfo, `canvas-home-${theme.name}.png`)

      await page.locator('.react-flow__node[data-id^="shot:"]').first().click()
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
      await shoot(page, testInfo, `canvas-selected-${theme.name}.png`)

      const zoom = (z: number): Promise<void> =>
        page.evaluate(async (value) => {
          const rf = (
            window as unknown as { __svsCanvas?: { fitView: (o: object) => Promise<boolean> } }
          ).__svsCanvas
          await rf?.fitView({ minZoom: value, maxZoom: value, padding: 0.2, duration: 0 })
        }, z)
      await zoom(0.4)
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-lod', 'mid')
      await shoot(page, testInfo, `canvas-zoom-mid-${theme.name}.png`)
      await zoom(0.2)
      await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-lod', 'low')
      await shoot(page, testInfo, `canvas-zoom-low-${theme.name}.png`)
    })

    test.describe('示範模式放慢、會拒絕含「【拒絕】」的請求', () => {
      test.use({ appEnv: { SVS_MOCK_LATENCY_MS: '400', SVS_MOCK_REJECT_TEXT: '【拒絕】' } })

      test('畫布狀態：拉線中（接得上的點亮綠）、生成中、失敗', async ({ page }, testInfo) => {
        test.setTimeout(180_000)
        await page.setViewportSize({ width: 1600, height: 1000 })
        await chooseTheme(page, theme)
        await generateAndOpenCanvas(page)

        // 拉線中：從角色拉向鏡頭，還沒放開
        await page.getByTestId('palette-character').click()
        await expect.poll(() => kindCount(page, 'character')).toBe(1)
        await page.getByTestId('fit-view').click()
        await viewportSettled(page)
        const nodes = await canvasNodes(page)
        const hero = nodes.find((n) => n.data.kind === 'character')
        const shot = nodes.find((n) => n.data.kind === 'shot')
        if (!hero || !shot) throw new Error('沒有角色或鏡頭')
        const from = await page.getByTestId(`port-${hero.id}-char-out`).boundingBox()
        const to = await page.getByTestId(`port-${shot.id}-shot-ref-char`).boundingBox()
        if (!from || !to) throw new Error('找不到連接點')
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 5 })
        await page.mouse.down()
        await page.mouse.move(to.x - 40, to.y + to.height / 2, { steps: 15 })
        await expect(page.getByTestId(`port-${shot.id}-shot-ref-char`)).toHaveAttribute(
          'data-link',
          'valid',
        )
        await shoot(page, testInfo, `canvas-linking-${theme.name}.png`)
        // 放在空白處會開「接上新的一格」的選單：關掉，什麼都不接
        await page.mouse.up()
        await expect(page.getByTestId('add-menu')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('add-menu')).toHaveCount(0)

        // 失敗：描述裡有「【拒絕】」的新鏡頭，生第一張畫面被拒絕
        const add = async (description: string): Promise<string> => {
          const added = await page.evaluate(() => window.svs.invoke('canvas.add', { kind: 'shot' }))
          if (!added.ok) throw new Error(added.error.userMessage)
          const id = added.data.key.replace(/^shot:/, '')
          await page.evaluate(
            ({ shotId, text }) =>
              window.svs.invoke('shots.update', { shotId, patch: { description: text } }),
            { shotId: id, text: description },
          )
          return id
        }
        const bad = await add('一隻貓【拒絕】')
        const slow = await add('貓在窗邊打盹')
        const badImage = `shot:${bad}:image`
        await centerOn(page, badImage)
        await page.getByTestId(`run-${badImage}`).click()
        await page.getByTestId('run-confirm-ok').click()
        await expect(page.getByTestId(`node-${badImage}`).getByTestId('node-error')).toBeVisible({
          timeout: 30_000,
        })

        // 生成中：下一鏡的影片（先畫第一張畫面），失敗的那一鏡在它上面
        const slowImage = `shot:${slow}:image`
        await centerOn(page, slowImage)
        await page.getByTestId(`run-shot:${slow}:video`).click()
        await page.getByTestId('run-confirm-ok').click()
        await expect(
          page.getByTestId(`node-${slowImage}`).getByTestId('node-working'),
        ).toBeVisible()
        await shoot(page, testInfo, `canvas-running-failed-${theme.name}.png`)
        await page.getByTestId('run-stop').click()
      })
    })

    test('畫布新增：節點面板、新增選單、滑過輸出點的「＋」與從它開的選單', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await chooseTheme(page, theme)
      await generateAndOpenCanvas(page)
      await expect(page.getByTestId('node-palette')).toBeVisible()
      await page.getByTestId('fit-view').click()
      await viewportSettled(page)
      // 新增一個角色，滑過它的輸出點
      await page.getByTestId('palette-character').click()
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
      await viewportSettled(page)
      const hero = page.locator('.react-flow__node[data-id^="character:"]')
      const id = (await hero.getAttribute('data-id')) ?? ''
      // 長出來的動畫結束後才滑過連接點；滑過、按下「＋」整段一起重試，避免動畫中途游標位置不準
      await expect(hero.locator('[data-born="true"]')).toHaveCount(0)
      await expect(async () => {
        await page.mouse.move(0, 0)
        await page.getByTestId(`port-${id}-char-out`).hover()
        await expect(page.getByTestId(`plus-${id}-char-out`)).toHaveCSS('opacity', '1', {
          timeout: 1500,
        })
        await shoot(page, testInfo, `canvas-add-plus-${theme.name}.png`)
        await page.getByTestId(`plus-${id}-char-out`).click({ timeout: 1500 })
        await expect(page.getByTestId('add-menu')).toBeVisible({ timeout: 1500 })
      }).toPass()
      await shoot(page, testInfo, `canvas-add-menu-port-${theme.name}.png`)
      await page.keyboard.press('Escape')
      // Tab 開的完整新增選單
      await page.getByTestId('canvas-root').click({ position: { x: 700, y: 760 } })
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('add-menu')).toBeVisible()
      await shoot(page, testInfo, `canvas-add-menu-${theme.name}.png`)
    })

    test('設定頁：填好服務金鑰之後的樣子，含展開的模型選單', async ({ page }, testInfo) => {
      await chooseTheme(page, theme)
      await page.getByTestId('demo-mode').uncheck()
      await page.getByLabel('fal.ai 的服務金鑰').fill('fal-e2e-SECRETVALUE-wxyz')
      await page.getByTestId('key-fal').getByRole('button', { name: '儲存' }).click()
      await expect(page.getByTestId('key-fal-status')).toHaveText('已設定（結尾 wxyz）')

      // 設定頁不需要詳細面板與生成佇列
      await expect(page.getByTestId('layout-panel')).toHaveAttribute('data-open', 'false')
      await expect(page.getByTestId('layout-queue')).toHaveCount(0)

      // 先回到頁首再拍，審查才看得到完整的第一屏
      const main = page.getByTestId('layout-main')
      await main.evaluate((el) => {
        el.scrollTo({ top: 0 })
      })
      await shoot(page, testInfo, `settings-${theme.name}.png`)

      // 捲到「使用的模型」，再拍一張展開選單的樣子。
      // 不能捲到頁面最底：設定頁後面還有別的區塊（分鏡準則、Slima 連線、一般），模型區會被捲出視窗
      await page.locator('#models').evaluate((el) => {
        el.scrollIntoView({ block: 'start' })
      })
      await expect(page.locator('#models')).toBeInViewport()
      await page.getByTestId('model-t2i').click()
      await expect(page.getByRole('listbox')).toBeVisible()
      // 等淡入動畫播完再拍
      await expect(page.getByRole('listbox')).toHaveCSS('opacity', '1')
      await shoot(page, testInfo, `settings-model-select-${theme.name}.png`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)

      // 影片用途的選單（選項比較多、價格比較貴）
      await shootOpenSelect(
        page,
        testInfo,
        'model-i2v',
        `settings-model-select-video-${theme.name}.png`,
      )
    })

    test('一句話：下拉選單、佇列、側欄提示；點開一個鏡頭，右側面板滑入', async ({
      page,
    }, testInfo) => {
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '畫布', exact: true }).click()
      await page.getByTestId('empty-add-oneliner').click()
      await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
      await page.getByTestId('oneliner-story').blur()
      // 一句話節點的下拉展開時的樣子
      await shootOpenSelect(page, testInfo, 'oneliner-shots', `oneliner-select-${theme.name}.png`)
      await generateAndOpenCanvas(page)
      // 佇列有鏡頭工作時：每一列標出「第 N 鏡・圖片／影片」，最多展開 160px
      const queue = page.getByTestId('queue-panel')
      if ((await queue.getAttribute('data-collapsed')) === 'true') {
        await page.getByRole('button', { name: '展開生成佇列' }).click()
      }
      await expect(queue).toHaveAttribute('data-collapsed', 'false')
      await expect(
        page.getByTestId('job-label').filter({ hasText: '第 1 鏡' }).first(),
      ).toBeVisible()
      await shoot(page, testInfo, `queue-expanded-${theme.name}.png`)

      // 沒選取時中央滿寬；佇列收成一條標題
      await page.getByRole('button', { name: '收合生成佇列' }).click()
      await expect(page.getByTestId('queue-panel')).toHaveAttribute('data-collapsed', 'true')
      await expect(page.getByTestId('layout-panel')).toHaveAttribute('data-open', 'false')
      await expect(page.getByTestId('queue-panel')).toHaveCSS('height', '32px')
      await shoot(page, testInfo, `canvas-full-width-${theme.name}.png`)

      // 側欄：滑過圖示顯示名稱
      const navButton = page.getByRole('button', { name: '大綱' })
      // 滑過的瞬間頁面剛好在重繪時，hover 會掉一次，所以整段一起重試
      await expect(async () => {
        await navButton.hover()
        await expect(navButton.locator('span').last()).toHaveCSS('opacity', '1', { timeout: 1000 })
      }).toPass()
      await shoot(page, testInfo, `nav-tooltip-${theme.name}.png`)
      await page.mouse.move(700, 400)

      // 點開一個鏡頭：右側面板滑入
      const second = (await canvasNodes(page)).find((n) => n.data.title === '第 2 鏡')
      if (!second) throw new Error('找不到第 2 鏡')
      await centerOn(page, second.id)
      await page.getByTestId(`open-${second.id}`).click()
      await expect(page.getByTestId('canvas-panel')).toHaveAttribute('data-open', 'true')
      await canvasPanelSettled(page)
      await shoot(page, testInfo, `shot-panel-${theme.name}.png`)

      // 鏡頭面板裡的下拉（鏡頭怎麼動）展開的樣子
      await shootOpenSelect(page, testInfo, 'shot-camera', `shot-panel-select-${theme.name}.png`)
    })

    test('分鏡表：讓 AI 拆場之後的故事板與表格', async ({ page }, testInfo) => {
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '大綱' }).click()
      await page.getByTestId('act-add').click()
      await expect(page.getByTestId('scene-card')).toHaveCount(1)
      await page.getByTestId('scene-title').fill('街角')
      await page.getByTestId('scene-title').blur()
      await page.getByRole('button', { name: '分鏡表' }).click()
      await page.getByTestId('storyboard-split-run').click()
      await expect(page.getByTestId('shot-row').first()).toBeVisible({ timeout: 30_000 })
      await shoot(page, testInfo, `storyboard-${theme.name}.png`)
    })

    test('復原提示與一句話的確認面板', async ({ page }, testInfo) => {
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '大綱' }).click()
      await page.getByTestId('act-add').click()
      await expect(page.getByTestId('act-card')).toHaveCount(1)
      await page.getByTestId('act-title').fill('序幕')
      await page.getByRole('heading', { level: 1 }).click()
      await expect(page.getByTestId('history-undo')).toHaveAttribute(
        'aria-label',
        '復原：修改這一幕',
      )
      await page.keyboard.press('ControlOrMeta+z')
      await expect(page.getByTestId('toast').last()).toContainText('已復原：修改這一幕')
      await shoot(page, testInfo, `undo-toast-${theme.name}.png`)

      // 大綱已經有一幕（畫布不是空的），從節點面板新增一句話
      await page.getByRole('button', { name: '畫布', exact: true }).click()
      await page.getByTestId('palette-oneliner').click()
      await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
      await page.getByTestId('oneliner-story').blur()
      await page.getByTestId('oneliner-generate').click()
      await expect(page.getByTestId('run-confirm')).toBeVisible()
      await shoot(page, testInfo, `confirm-dialog-${theme.name}.png`)
    })

    test('角色：清單全寬，點角色才滑出編輯面板', async ({ page }, testInfo) => {
      await chooseTheme(page, theme)
      await page.getByRole('button', { name: '角色', exact: true }).click()
      await expect(page.getByTestId('character-empty')).toBeVisible()
      await shoot(page, testInfo, `character-empty-${theme.name}.png`)
      await (await characterNameInput(page)).fill('阿鐵')
      await page.getByTestId('character-add').click()
      await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛、左臉有一道小疤')
      await page.getByTestId('character-outfit').fill('深藍色工作服')
      await expect(page.getByTestId('layout-panel')).toHaveAttribute('data-open', 'true')
      await panelSettled(page)
      await shoot(page, testInfo, `character-${theme.name}.png`)
    })
  })
}

/** 元素截圖：跟 shoot 一樣存在 test-results，有設 SVS_SCREENSHOT_DIR 就另外複製一份。 */
async function shootElement(locator: Locator, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await locator.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, name))
  }
}

/** 元素截圖，四周多留一點邊（卡片的邊框才不會被切到）。元素要整個在畫面裡。 */
async function shootPadded(
  page: Page,
  locator: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${name}: 找不到元素`)
  const pad = 12
  const path = testInfo.outputPath(name)
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, name))
  }
}

/** 新專案：從專案選單回首頁，按「新專案」、取名字、建立。 */
async function createProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('project-menu-button').click()
  await page.getByTestId('menu-home').click()
  await page.getByTestId('home-new').click()
  await page.getByTestId('new-project-name').fill(name)
  await page.getByTestId('new-project-create').click()
  await expect(page.getByTestId('project-name')).toHaveText(name)
}

/**
 * README 用的圖（淺色，跟 docs/images 裡其他的一樣是 App 真實的畫面）：
 * 要更新時 `SVS_SCREENSHOT_DIR=docs/images pnpm test:e2e e2e/screenshots.e2e.ts -g "README 用的圖"`，
 * 或從 CI 的 e2e-report 下載同名的檔案。檔名的編號：01 設定精靈、08 設定頁的連線區、09 成品面板的聲音區、10～14 其餘。
 */
test.describe('README 用的圖', () => {
  test('10 首頁、11 空白畫布的三種開始方式', async ({ page }, testInfo) => {
    // 這兩張的內容不高，視窗矮一點，圖裡就不會有一大片空白
    await page.setViewportSize({ width: 1600, height: 600 })
    await chooseTheme(page, THEMES[1])
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await createProject(page, '雨夜的貓')
    await createProject(page, '海邊的早晨')
    // 現在開著的是「海邊的早晨」，「雨夜的貓」在最近的專案
    await page.getByTestId('project-menu-button').click()
    await page.getByTestId('menu-home').click()
    await expect(page.getByTestId('home-current')).toBeVisible()
    await expect(page.getByTestId('home-recent')).toHaveCount(1)
    await shoot(page, testInfo, '10-home.png')

    await page.getByTestId('home-current').getByRole('button').first().click()
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await page.setViewportSize({ width: 1600, height: 760 })
    await viewportSettled(page)
    await shoot(page, testInfo, '11-canvas-start.png')
  })

  test('12 一句話卡片', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await chooseTheme(page, THEMES[1])
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('empty-add-oneliner').click()
    await page.getByTestId('oneliner-story').fill('一隻貓在下雨的夜晚找到溫暖的家')
    await page.getByTestId('oneliner-story').blur()
    await pick(page, 'oneliner-shots', '3')
    await pick(page, 'oneliner-duration', '3')
    await viewportSettled(page)
    await shootElement(
      page.locator('.react-flow__node[data-id^="node:"]').first(),
      testInfo,
      '12-oneliner-card.png',
    )
  })

  test('08 設定頁的 AI 工具連線區、14 設定頁的一般區', async ({ page }, testInfo) => {
    // 視窗夠高，兩個區才會整個進畫面（元素截圖超過視窗高度會被切掉）
    await page.setViewportSize({ width: 1280, height: 1800 })
    await chooseTheme(page, THEMES[1])
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByTestId('settings-tags')).toBeVisible()
    await page.locator('#general').scrollIntoViewIfNeeded()
    await shootPadded(page, page.locator('#general'), testInfo, '14-settings-general.png')
    // 總開關打開：示意圖與燈是「開放中」，Claude Desktop／Claude Code 還沒連接
    await page.getByTestId('mcp-enabled').check()
    await expect(page.getByTestId('mcp-status')).toContainText('開放中')
    await page.waitForTimeout(400) // 開關的滑動與顏色漸變播完
    await page.locator('#connections').scrollIntoViewIfNeeded()
    await shootPadded(page, page.locator('#connections'), testInfo, '08-connect-claude.png')
  })

  test('13 ▶ 旁的選單', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await chooseTheme(page, THEMES[1])
    await generateAndOpenCanvas(page)
    const video = (await canvasNodes(page)).find((n) => n.data.kind === 'video')
    if (!video) throw new Error('沒有影片節點')
    await centerOn(page, video.id)
    await page.getByTestId(`run-mode-${video.id}`).click()
    const menu = page.getByTestId('run-mode-menu')
    await expect(menu).toBeVisible()
    for (const scope of ['this', 'from-here', 'chain']) {
      await expect(menu.getByTestId(`run-mode-${scope}`)).toContainText('約 US$')
    }
    // 只留影片節點與它的選單（整個畫面太雜：節點面板、提示都在）
    const boxes = [
      await page.locator(`.react-flow__node[data-id="${video.id}"]`).boundingBox(),
      await menu.boundingBox(),
    ].filter((box) => box !== null)
    const left = Math.min(...boxes.map((box) => box.x)) - 24
    const top = Math.min(...boxes.map((box) => box.y)) - 24
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 24
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 24
    const path = testInfo.outputPath('13-run-modes.png')
    await page.screenshot({
      path,
      clip: {
        x: Math.max(0, left),
        y: Math.max(0, top),
        width: right - left,
        height: bottom - top,
      },
    })
    const dir = process.env.SVS_SCREENSHOT_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      copyFileSync(path, join(dir, '13-run-modes.png'))
    }
  })
})
