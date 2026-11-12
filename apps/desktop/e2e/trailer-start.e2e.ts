import type { Page, TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { canvasNodes, centerOn, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'
const BAD_MARK = '【腳本不合格】'

/** 截圖存在 test-results；有設 SVS_SCREENSHOT_DIR 就另外複製一份到那個資料夾（用自己指定的檔名）。 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
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

const shotsOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.shots
}

const statusOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('trailer.status', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

/** 匯出檔有幾格（用 ffprobe 數，不是看影片長度）。 */
function exportedFrames(userDataDir: string): number {
  const projects = join(userDataDir, 'projects')
  const dir = readdirSync(projects).find((name) => existsSync(join(projects, name, 'exports')))
  if (!dir) throw new Error('找不到匯出資料夾')
  const exports = join(projects, dir, 'exports')
  const file = readdirSync(exports).find((name) => name.endsWith('.mp4'))
  if (!file) throw new Error('找不到匯出的 mp4')
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    join(exports, file),
  ])
  return Number(String(out).trim())
}

const openCanvas = async (page: Page) => {
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await expect(page.getByTestId('canvas-root')).toBeVisible()
}

test.describe('做預告片：從空白畫布的入口走到成品（示範模式，不花錢）', () => {
  test.describe.configure({ timeout: 240_000 })

  test('空白畫布 → 貼文字 → 寫腳本 → 標籤 30／30 → 全部生成 → 成品 30 秒、匯出 720 格 → 改 15 秒重寫 → 復原回 30', async ({
    page,
    userDataDir,
  }, testInfo) => {
    await openCanvas(page)
    // 1. 空白畫布：四個起點，第 4 張是「做預告片」；一般專案沒有預告片標籤
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('canvas-empty')).toContainText('四種都可以')
    await expect(page.getByTestId('trailer-start')).toBeVisible()
    await expect(page.getByTestId('trailer-badge')).toHaveCount(0)
    await expect(page.getByTestId('trailer-go')).toBeDisabled()
    await expect(page.getByTestId('trailer-reason')).toContainText('先貼上文字')
    await shoot(page, testInfo, '01-empty-canvas-four-starts.png')

    // 2. 貼文字：預設 30 秒、劇情；示範模式寫「不花錢」
    await page.getByTestId('trailer-text').fill(STORY)
    await page.getByTestId('trailer-title').fill('斷橋')
    await expect(page.getByTestId('trailer-go')).toHaveText('先產生腳本（示範模式不花錢）')
    await expect(page.getByTestId('trailer-start-cost')).toContainText('不會花錢')
    await expect(page.getByTestId('trailer-length')).toContainText('30 秒')
    await expect(page.getByTestId('trailer-kind')).toContainText('劇情')
    await shoot(page, testInfo, '02-text-pasted-demo-free.png')

    // 3. 寫腳本：畫布長出「預告片」場與鏡頭，頂列標籤寫 30／30 秒
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('canvas-empty')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 30／30 秒')
    await expect(page.getByTestId('trailer-badge')).toHaveAttribute('data-matches', 'true')
    const first = await statusOf(page)
    expect(first.scriptSec).toBeCloseTo(30, 6)
    expect(first.settings.sourceText).toBe(STORY)
    await expect.poll(() => kindCount(page, 'shot')).toBe(first.beatCount)
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    expect(scene?.data.title).toContain('預告片')
    await page.getByRole('button', { name: '全部顯示' }).click()
    await shoot(page, testInfo, '03-script-written-canvas.png')

    // 4. 標籤點開：長度、書名、旁白、配樂、重寫
    await page.getByTestId('trailer-badge').click()
    await expect(page.getByTestId('trailer-panel')).toBeVisible()
    await expect(page.getByTestId('trailer-panel-title')).toHaveValue('斷橋')
    await expect(page.getByTestId('trailer-mismatch')).toHaveCount(0)
    await shoot(page, testInfo, '04-badge-panel.png')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('trailer-panel')).toHaveCount(0)

    // 5. 全部生成（字卡與片名卡本機做，不花錢）→ 成品面板寫「成品 30 秒（目標 30 秒）」
    await page.getByTestId('run-all').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 120_000 })
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-length')).toHaveText('成品 30 秒（目標 30 秒）', {
      timeout: 30_000,
    })
    await shoot(page, testInfo, '05-final-cut-30s.png')
    // 匯出（不加片尾字卡）：24 fps × 30 秒 ＝ 720 格，誤差一格內
    await page.getByTestId('final-cut-credits').uncheck()
    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toBeVisible({ timeout: 90_000 })
    expect(Math.abs(exportedFrames(userDataDir) - 720)).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')

    // 6. 改成 15 秒：自動重排，標籤變 15／15（13 格塞進 15 秒，檢查器會說好幾句旁白念不完；面板不能把畫面頂歪）
    const barTop = (await page.getByTestId('canvas-topbar').boundingBox())?.y
    await page.getByTestId('trailer-badge').click()
    await pick(page, 'trailer-panel-length', '15')
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 15／15 秒')
    expect((await statusOf(page)).matches).toBe(true)
    await expect(page.getByTestId('trailer-issues')).toContainText('請把這句縮短')
    expect((await page.getByTestId('canvas-topbar').boundingBox())?.y).toBe(barTop)

    // 7. 用存著的原文重寫（示範模式不花錢）：已有生成過的格子，先確認；寫完還是 15／15
    await page.getByTestId('trailer-rewrite').click()
    await expect(page.getByTestId('trailer-rewrite-confirm')).toContainText('已經生成過畫面或影片')
    await page.getByTestId('trailer-rewrite-confirm').scrollIntoViewIfNeeded()
    expect((await page.getByTestId('canvas-topbar').boundingBox())?.y).toBe(barTop)
    await shoot(page, testInfo, '06-rewrite-confirm.png')
    await page.getByTestId('trailer-rewrite-ok').click()
    await expect(page.getByTestId('trailer-rewrite')).toBeVisible({ timeout: 30_000 })
    const rewritten = await statusOf(page)
    expect(rewritten.scriptSec).toBeCloseTo(15, 6)
    expect(rewritten.matches).toBe(true)
    expect(rewritten.settings.sourceText).toBe(STORY)
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 15／15 秒')
    expect((await shotsOf(page)).every((s) => s.videos.length === 0)).toBe(true)

    // 8. 復原：重寫與改長度各是一步，退兩步回到 30／30、原本的腳本
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByTestId('trailer-badge')).toHaveText('預告片 30／30 秒', {
      timeout: 15_000,
    })
    const undone = await statusOf(page)
    expect(undone.scriptSec).toBeCloseTo(30, 6)
    expect(undone.beatCount).toBe(first.beatCount)
  })

  test('檢查器擋下：畫面上直接顯示那則錯誤；文字不長就不叫人縮短；專案沒被改', async ({
    page,
  }, testInfo) => {
    await openCanvas(page)
    await page.getByTestId('trailer-text').fill(`${STORY}${BAD_MARK}`)
    await expect(page.getByTestId('trailer-go')).toBeEnabled()
    await page.getByTestId('trailer-go').click()
    const alert = page.getByTestId('trailer-error')
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toContainText('腳本沒寫成')
    await expect(alert).toContainText('專案沒有被改')
    await expect(alert).toContainText('第一格必須是畫面')
    await expect(alert).not.toContainText('縮短')
    // 專案沒被改：還在空白畫布，沒有預告片標籤、沒有鏡頭
    await expect(page.getByTestId('canvas-empty')).toBeVisible()
    await expect(page.getByTestId('trailer-badge')).toHaveCount(0)
    expect(await shotsOf(page)).toHaveLength(0)
    // 按鈕回來了，可以改了文字再試
    await expect(page.getByTestId('trailer-go')).toBeEnabled()
    await shoot(page, testInfo, '07-checker-blocked-short-text.png')

    // 文字很長（超過 12,000 字）才多加一句「縮短一點」
    await page.getByTestId('trailer-text').fill(`${STORY.repeat(300)}${BAD_MARK}`)
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-error')).toContainText('縮短一點再試', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('trailer-error')).toContainText('第一格必須是畫面')
    await shoot(page, testInfo, '08-checker-blocked-long-text.png')
  })

  test('角色頁清單：寫腳本建的角色卡標「草稿」，跟場景卡頁一樣', async ({ page }, testInfo) => {
    await openCanvas(page)
    await page.getByTestId('trailer-text').fill(STORY)
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-badge')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByTestId('character-item-draft-小葉')).toHaveText('草稿')
    await expect(page.getByTestId('character-item-draft-老鐘')).toHaveText('草稿')
    await shoot(page, testInfo, '09-characters-draft-marker.png')
    await page.getByRole('button', { name: '場景卡', exact: true }).click()
    await expect(page.getByTestId('location-item-斷橋')).toContainText('草稿')
    await shoot(page, testInfo, '10-locations-draft-marker.png')
  })
})

const HAN_OR_FULLWIDTH = /[㐀-鿿，。：；（）、！？「」・]/u

test.describe('做預告片：英文介面與窄視窗', () => {
  test.describe('英文介面', () => {
    test.use({ appEnv: { SVS_LOCALE: 'en' } })

    test('起點卡、標籤、設定面板、錯誤：畫面上沒有中文', async ({ page }, testInfo) => {
      await page.getByRole('button', { name: 'Canvas', exact: true }).click()
      await expect(page.getByTestId('trailer-start')).toBeVisible()
      const han = (testId: string) =>
        page.getByTestId(testId).evaluate((el, source) => {
          const bad = new RegExp(source, 'u')
          const attrs = [...el.querySelectorAll('[title], [aria-label], [placeholder]')]
            .map((x) =>
              ['title', 'aria-label', 'placeholder'].map((n) => x.getAttribute(n) ?? '').join(' '),
            )
            .join(' ')
          return [...`${el.textContent} ${attrs}`.matchAll(new RegExp(`\\S*${source}+\\S*`, 'gu'))]
            .map((m) => m[0])
            .filter((x) => bad.test(x))
        }, HAN_OR_FULLWIDTH.source)
      expect(await han('trailer-start')).toEqual([])
      await expect(page.getByTestId('trailer-start')).toContainText('Make a trailer')
      await expect(page.getByTestId('trailer-go')).toBeDisabled()

      // 檢查器擋下：英文介面的錯誤也是英文
      await page.getByTestId('trailer-text').fill(`A bridge, a lamp, a knock.${BAD_MARK}`)
      await expect(page.getByTestId('trailer-go')).toHaveText(
        'Write the script first (demo mode, free)',
      )
      await page.getByTestId('trailer-go').click()
      await expect(page.getByTestId('trailer-error')).toBeVisible({ timeout: 30_000 })
      expect(await han('trailer-error')).toEqual([])
      await shoot(page, testInfo, '11-english-blocked.png')

      await page.getByTestId('trailer-text').fill('A bridge, a lamp, a knock. The door opens.')
      await page.getByTestId('trailer-go').click()
      await expect(page.getByTestId('trailer-badge')).toHaveText('Trailer 30/30 s', {
        timeout: 30_000,
      })
      await page.getByTestId('trailer-badge').click()
      expect(await han('trailer-panel')).toEqual([])
      await shoot(page, testInfo, '12-english-panel.png')
    })
  })

  test('390 寬：做預告片的卡片完整露出，不超出視窗，按鈕按得到', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openCanvas(page)
    const card = page.getByTestId('trailer-start')
    await card.scrollIntoViewIfNeeded()
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(390)
    await page.getByTestId('trailer-text').fill(STORY)
    await expect(page.getByTestId('trailer-go')).toBeEnabled()
    await shoot(page, testInfo, '13-narrow-390.png')
    await page.getByTestId('trailer-go').click()
    await expect(page.getByTestId('trailer-badge')).toBeVisible({ timeout: 30_000 })
    // 標籤與面板在窄視窗也完整露出
    await page.getByTestId('trailer-badge').click()
    const panel = await page.getByTestId('trailer-panel').boundingBox()
    expect(panel?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((panel?.x ?? 0) + (panel?.width ?? 999)).toBeLessThanOrEqual(390)
    await shoot(page, testInfo, '14-narrow-390-panel.png')
  })
})
