import type { Page, TestInfo } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { characterNameInput } from './character-name'
import { expect, test } from './fixtures'

// 畫面文字的改前、改後對照用（第二批）：設定頁各區、Claude 對話說明卡、角色頁、場景卡頁、生成紀錄、專案頁、聲音區。
// 拍完存在測試自己的路徑；有設 SVS_SCREENSHOT_DIR 就用 SVS_SHOT_PREFIX（例如 before／after）加在檔名前面另存一份。
// 平常跑整套時不設環境變數，只是多拍幾張圖、不比對內容。

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const dir = process.env.SVS_SCREENSHOT_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(path, join(dir, `${process.env.SVS_SHOT_PREFIX ?? ''}${name}`))
  }
}

const nav = (page: Page, name: string) =>
  page.getByTestId('layout-nav').getByRole('button', { name, exact: true })

test.describe('文案截圖第二批（改前改後對照）', () => {
  test.describe.configure({ timeout: 240_000 })

  test('設定頁五區', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: '設定' }).click()
    let index = 1
    for (const id of ['general', 'connections', 'keys', 'models', 'experiments']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded()
      await page.locator(`#${id}`).evaluate((el) => {
        el.scrollIntoView({ block: 'start' })
      })
      await shoot(page, testInfo, `s${String(index).padStart(2, '0')}-settings-${id}.png`)
      index += 1
    }
  })

  test('Claude 對話說明卡（還沒打開 AI 工具連線）', async ({ page }, testInfo) => {
    await page.evaluate(() =>
      window.svs.invoke('settings.update', { experiments: { claudeChat: true } }),
    )
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-prereq')).toBeVisible()
    await shoot(page, testInfo, 's06-chat-prereq-mcp-off.png')
  })

  test('角色頁、場景卡頁、生成紀錄、專案頁', async ({ page }, testInfo) => {
    await generateAndOpenCanvas(page)
    await nav(page, '角色').click()
    await expect(page.getByTestId('characters-page')).toBeVisible()
    await shoot(page, testInfo, 's07-characters-empty.png')
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await expect(page.getByTestId('character-card')).toBeVisible()
    await page.getByTestId('character-appearance').fill('短黑髮、琥珀色眼睛')
    await page.getByTestId('character-save').click()
    await expect(page.getByTestId('concept-generate')).toBeEnabled()
    await shoot(page, testInfo, 's08-characters-one.png')

    await nav(page, '場景卡').click()
    await expect(page.getByTestId('locations-page')).toBeVisible()
    await shoot(page, testInfo, 's09-locations.png')

    await nav(page, '生成紀錄').click()
    await expect(page.getByTestId('records-page')).toBeVisible()
    await page.getByTestId('record-toggle').first().click()
    await page.getByTestId('record-draft').first().fill('貓咪蜷縮在窗邊看雨，溫暖的燈光')
    await page.getByTestId('record-redo').first().click()
    await expect(page.getByTestId('record-confirm-note').first()).toBeVisible()
    await shoot(page, testInfo, 's10-records-redo-confirm.png')

    await nav(page, '專案').click()
    await expect(page.getByTestId('projects-page')).toBeVisible()
    await shoot(page, testInfo, 's11-projects.png')
  })

  test('聲音區：旁白被刪掉後「N 個鏡頭還沒念」', async ({ page }, testInfo) => {
    await generateAndOpenCanvas(page)
    const shots = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!shots.ok) throw new Error(shots.error.userMessage)
    const first = shots.data.shots[0]
    if (!first) throw new Error('沒有鏡頭')
    await page.evaluate(
      (shotId) =>
        window.svs.invoke('shots.update', { shotId, patch: { dialogue: '黑藤爬滿了斷橋。' } }),
      first.id,
    )
    await page.getByTestId('palette-close').click()
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await page.getByTestId('sound-add').click()
    await page.getByTestId('sound-add-go').click()
    await expect(page.getByTestId('sound-mixer')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('sound-narration-delete').click()
    await expect(page.getByTestId('sound-narration-missing')).toBeVisible()
    await page.getByTestId('sound-panel').scrollIntoViewIfNeeded()
    await shoot(page, testInfo, 's12-sound-narration-missing.png')
  })
})

// 英文介面的設定頁五區（確認英文字不會斷行、擠成一團）
test.describe('文案截圖第二批（英文介面）', () => {
  test.use({ appEnv: { SVS_LOCALE: 'en' } })
  test.describe.configure({ timeout: 240_000 })

  test('設定頁五區（英文）', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    let index = 1
    for (const id of ['general', 'connections', 'keys', 'models', 'experiments']) {
      await page.locator(`#${id}`).evaluate((el) => {
        el.scrollIntoView({ block: 'start' })
      })
      await shoot(page, testInfo, `en-s${String(index).padStart(2, '0')}-settings-${id}.png`)
      index += 1
    }
  })
})
