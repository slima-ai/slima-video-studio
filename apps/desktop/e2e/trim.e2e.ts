import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { canvasNodes, centerOn, generateAndOpenCanvas } from './canvas-helpers'
import { expect, test } from './fixtures'

async function openShot(page: Page, number: number): Promise<void> {
  const node = (await canvasNodes(page)).find(
    (n) => n.data.kind === 'shot' && n.data.title === `第 ${String(number)} 鏡`,
  )
  if (!node) throw new Error(`找不到第 ${String(number)} 鏡`)
  await centerOn(page, node.id)
  await page.getByTestId(`open-${node.id}`).click()
  await expect(page.getByTestId('shot-panel')).toBeVisible()
}

/** 浮動面板滑到定位：右緣離畫布右緣 12px（滑動中量到的座標會跑掉）。 */
async function panelSettled(page: Page): Promise<void> {
  const panel = page.getByTestId('canvas-panel')
  const root = page.getByTestId('canvas-root')
  await expect
    .poll(async () => {
      const box = await panel.boundingBox()
      const area = await root.boundingBox()
      return box && area ? Math.round(area.x + area.width - (box.x + box.width)) : -1
    })
    .toBe(12)
}

/** 把預覽影片停在某一格裡（第 n 格開頭過 1/4 格），焦點放在影片上。 */
async function parkAtFrame(page: Page, frame: number): Promise<void> {
  await page.evaluate(
    (target) => {
      const video = document.querySelector<HTMLVideoElement>('[data-testid="shot-preview"]')
      if (!video) throw new Error('沒有預覽影片')
      video.pause()
      video.currentTime = target
      video.focus()
    },
    (frame + 0.25) / 24,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLVideoElement>('[data-testid="shot-preview"]')?.seeking,
      ),
    )
    .toBe(false)
}

const field = async (page: Page, id: 'trim-in' | 'trim-out'): Promise<number> =>
  Number(await page.getByTestId(id).inputValue())

/** 最新一個匯出檔有幾格（用 ffprobe 數，不是看影片長度）。 */
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

const finalOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('canvas.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.nodes.find((n) => n.kind === 'cut')?.final
}

test.describe('剪裁每一鏡的頭尾（示範模式，每鏡 3 秒的假影片）', () => {
  test('拖出點把手、I／O 快捷鍵設入點出點、←→ 逐格；成品標「要重新接」；接片後匯出的格數對得上', async ({
    page,
    userDataDir,
  }) => {
    await generateAndOpenCanvas(page)
    expect((await finalOf(page))?.stale).toBe(false)
    await openShot(page, 1)
    await expect(page.getByTestId('trim-control')).toBeVisible()
    await expect(page.getByTestId('trim-handle-out')).toBeEnabled()
    await expect(page.getByTestId('trim-summary')).toContainText('整支都用：3.0 秒、72 格')
    await panelSettled(page)

    // 1) 真的拖出點把手到時間尺中間（3 秒的一半＝1.5 秒），放開才存
    const track = await page.getByTestId('trim-track').boundingBox()
    const handle = await page.getByTestId('trim-handle-out').boundingBox()
    if (!track || !handle) throw new Error('時間尺沒有畫出來')
    const y = handle.y + handle.height / 2
    await page.mouse.move(handle.x + handle.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * 0.5, y, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => field(page, 'trim-out')).toBeCloseTo(1.5, 1)
    await expect(page.getByTestId('trim-summary')).toContainText('留下 0.0–')
    // 改了裁切：剪輯卡的成品要標成「要重新接」，不是聲音
    await expect.poll(async () => (await finalOf(page))?.stale).toBe(true)
    await expect.poll(async () => (await finalOf(page))?.staleReason).toBe('shots')

    // 2) 播放位置停在第 12 格按 I → 入點 0.5 秒；停在第 48 格按 O → 出點 2.0 秒
    await parkAtFrame(page, 12)
    await page.keyboard.press('i')
    await expect.poll(() => field(page, 'trim-in')).toBe(0.5)
    await parkAtFrame(page, 48)
    await page.keyboard.press('o')
    await expect.poll(() => field(page, 'trim-out')).toBe(2)
    await expect(page.getByTestId('trim-summary')).toHaveText('留下 0.5–2.0 秒：1.5 秒、36 格')

    // 3) → 逐格：播放位置前進一格（不改裁切）
    await parkAtFrame(page, 20)
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.floor(
            (document.querySelector<HTMLVideoElement>('[data-testid="shot-preview"]')
              ?.currentTime ?? 0) *
              24 +
              1e-3,
          ),
        ),
      )
      .toBe(21)
    expect(await field(page, 'trim-in')).toBe(0.5)

    // 4) 卡片縮圖上有徽章：「✂ 1.5／3.0」（成品用 1.5 秒，影片 3.0 秒）
    await page.keyboard.press('Escape')
    const badge = page.locator('[data-testid^="trim-badge-"]')
    await expect(badge).toHaveCount(1)
    await expect(badge).toHaveText('✂ 1.5／3.0')

    // 5) 接成成品、匯出（不加片尾字卡）：第 1 鏡 36 格＋另外兩鏡各 72 格＝180 格
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-panel')).toBeVisible()
    await page.getByTestId('final-cut-credits').uncheck()
    await page.getByTestId('final-cut-rejoin').click()
    await expect.poll(async () => (await finalOf(page))?.stale, { timeout: 60_000 }).toBe(false)
    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toBeVisible({ timeout: 60_000 })
    expect(exportedFrames(userDataDir)).toBe(180)
  })

  test('重設回整支、數字欄位直接打秒數；打錯會說明、不會存', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await openShot(page, 2)
    await expect(page.getByTestId('trim-handle-out')).toBeEnabled()
    await page.getByTestId('trim-out').fill('2')
    await page.getByTestId('trim-out').press('Enter')
    await expect.poll(() => field(page, 'trim-out')).toBe(2)
    await expect(page.getByTestId('trim-reset')).toBeEnabled()
    // 打字不是快捷鍵：在欄位裡按 i 只是打出一個字，不會設入點；Esc 放棄草稿
    await page.getByTestId('trim-in').press('i')
    await expect(page.getByTestId('trim-in')).toHaveValue(/i/)
    await expect(page.getByTestId('trim-summary')).toContainText('留下 0.0–2.0 秒')
    await page.getByTestId('trim-in').press('Escape')
    await expect(page.getByTestId('trim-in')).toHaveValue('0.0')
    // 打錯：說明，欄位回到存著的值
    await page.getByTestId('trim-out').fill('三點五')
    await page.getByTestId('trim-out').press('Enter')
    await expect(page.getByTestId('trim-error')).toContainText('請輸入秒數')
    expect(await field(page, 'trim-out')).toBe(2)
    // 入點打到出點之後：伺服器說明原因
    await page.getByTestId('trim-in').fill('2.5')
    await page.getByTestId('trim-in').press('Enter')
    await expect(page.getByTestId('trim-error')).toContainText('入點要比出點早')
    expect(await field(page, 'trim-in')).toBe(0)
    // 重設：回到整支，沒有確認框
    await page.getByTestId('trim-reset').click()
    await expect(page.getByTestId('trim-summary')).toContainText('整支都用')
    await expect(page.getByTestId('trim-reset')).toBeDisabled()
    await expect(page.locator('[data-testid^="trim-badge-"]')).toHaveCount(0)
  })
})
