import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { canvasNodes, centerOn } from './canvas-helpers'
import { expect, test } from './fixtures'
import { pick } from './pick'

const shotsOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.shots
}

const soundOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('sound.get', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

const shotNode = async (page: Page, number: number) => {
  const node = (await canvasNodes(page)).find(
    (n) => n.data.kind === 'shot' && n.data.title === `第 ${String(number)} 鏡`,
  )
  if (!node) throw new Error(`找不到第 ${String(number)} 鏡`)
  return node
}

async function openShot(page: Page, number: number): Promise<void> {
  const node = await shotNode(page, number)
  await centerOn(page, node.id)
  await page.getByTestId(`open-${node.id}`).click()
  await expect(page.getByTestId('shot-panel')).toBeVisible()
}

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

test.describe('預告片的格子：會動、不動、字卡（示範模式）', () => {
  // 真的會生成並用 FFmpeg 接片、匯出
  test.describe.configure({ timeout: 180_000 })

  test('三種格子從標記、確認視窗、生成、接成品、匯出到改字重跑：長度 3.0＋2.5＋2.0＝7.5 秒，本機的格子不花錢', async ({
    page,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    // 有場才有剪輯：新增一場、三個鏡頭
    await page.getByTestId('palette-scene').click()
    await expect
      .poll(async () => (await canvasNodes(page)).some((n) => n.data.kind === 'scene'))
      .toBe(true)
    for (const n of [1, 2, 3]) {
      await page.getByTestId('palette-shot').click()
      await expect.poll(async () => (await shotsOf(page)).length).toBe(n)
    }
    // 秒數 3、2.5、2
    const listed = await shotsOf(page)
    for (const [index, sec] of [3, 2.5, 2].entries()) {
      const shot = listed[index]
      if (!shot) throw new Error('鏡頭數不對')
      const done = await page.evaluate(
        ([id, durationSec]) =>
          window.svs.invoke('shots.update', {
            shotId: String(id),
            patch: { durationSec: Number(durationSec) },
          }),
        [shot.id, sec],
      )
      expect(done.ok).toBe(true)
    }

    // 第 2 鏡選「不動」、第 3 鏡選「字卡」並填字（都在鏡頭面板，只存檔不生成）
    await openShot(page, 2)
    await pick(page, 'shot-beat', 'still')
    await page.getByTestId('shot-save').click()
    await expect.poll(async () => (await shotsOf(page))[1]?.beatKind).toBe('still')
    await openShot(page, 3)
    await pick(page, 'shot-beat', 'card')
    await expect(page.getByTestId('shot-description')).toHaveCount(0)
    await expect(page.getByTestId('shot-apply')).toBeDisabled()
    await page.getByTestId('shot-card-text').fill('有些光，要有人陪你一起守')
    await page.screenshot({ path: testInfo.outputPath('panel-card.png') })
    await page.getByTestId('shot-save').click()
    await expect
      .poll(async () => (await shotsOf(page))[2]?.card?.text)
      .toBe('有些光，要有人陪你一起守')

    // 畫布上：第 2 鏡標「不動」、第 3 鏡標「字卡」、第 1 鏡沒有標記；字卡沒有「第一張畫面」節點
    await page.keyboard.press('Escape')
    const nodes = await canvasNodes(page)
    const [first, second, third] = [1, 2, 3].map((n) =>
      nodes.find((x) => x.data.title === `第 ${String(n)} 鏡`),
    )
    if (!first || !second || !third) throw new Error('找不到三個鏡頭')
    await centerOn(page, second.id)
    await expect(page.getByTestId(`node-${second.id}`).getByTestId('beat-badge')).toHaveText('不動')
    await centerOn(page, third.id)
    await expect(page.getByTestId(`node-${third.id}`).getByTestId('beat-badge')).toHaveText('字卡')
    await expect(page.getByTestId(`node-${first.id}`).getByTestId('beat-badge')).toHaveCount(0)
    expect((await canvasNodes(page)).some((n) => n.id === `${third.id}:image`)).toBe(false)
    expect((await canvasNodes(page)).some((n) => n.id === `${second.id}:image`)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('canvas-three-kinds.png') })

    // 分鏡表：出現唯讀的「種類」欄
    await page.getByRole('button', { name: '分鏡表', exact: true }).click()
    await expect(page.getByTestId('shot-beat-kind')).toHaveText(['會動', '不動', '字卡'])
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()

    // 「生成空的」：確認視窗列出影片、不動的畫面、字卡，後兩項寫不花錢
    await page.getByTestId('run-all').click()
    const confirm = page.getByTestId('run-confirm')
    await expect(confirm).toContainText('第 1 鏡：影片')
    await expect(confirm).toContainText('第 2 鏡：不動的畫面（本機，不花錢）')
    await expect(confirm).toContainText('第 3 鏡：字卡（本機，不花錢）')
    await expect(confirm).not.toContainText('第 3 鏡：第一張畫面')
    await page.screenshot({ path: testInfo.outputPath('run-confirm.png') })
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 90_000 })

    // 本機做的兩格：版本記「本機」、沒有花費紀錄（價格是 0）
    const after = await shotsOf(page)
    expect(after.map((s) => s.videos.at(-1)?.modelId)).toEqual([
      'mock/video',
      'local-still',
      'local-card',
    ])
    expect(after[1]?.videos.at(-1)?.costUsd ?? 0).toBe(0)
    expect(after[2]?.videos.at(-1)?.costUsd ?? 0).toBe(0)
    expect(after[2]?.firstFrames).toHaveLength(0)

    // 成品面板的時間軸：三格 3.0、2.5、2.0，總長 7.5 秒
    const sound = await soundOf(page)
    expect(sound.shots.map((s) => s.durationSec)).toEqual([3, 2.5, 2])
    expect(sound.totalSec).toBeCloseTo(7.5, 1)
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('film-timeline')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('timeline.png') })

    // 匯出（不加片尾字卡）：量檔案，7.5 秒＝180 格（24 fps），誤差一格內
    await page.getByTestId('final-cut-credits').uncheck()
    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toBeVisible({ timeout: 60_000 })
    expect(Math.abs(exportedFrames(userDataDir) - 180)).toBeLessThanOrEqual(1)

    // 把字卡的字改掉：那一格標「需要重跑」，重跑不花錢，舊版本還在
    await openShot(page, 3)
    await page.getByTestId('shot-card-text').fill('光還在，有人陪你守')
    await page.getByTestId('shot-save').click()
    await expect
      .poll(
        async () =>
          (await canvasNodes(page)).find((n) => n.id === `${third.id}:video`)?.data.status,
      )
      .toBe('stale')
    const plan = await page.evaluate(() =>
      window.svs.invoke('canvas.runPlan', { keys: [], all: true, batch: 'stale' }),
    )
    if (!plan.ok) throw new Error(plan.error.userMessage)
    expect(plan.data.estimatedUsd).toBe(0)
    expect(plan.data.steps.map((s) => s.label)).toContain('第 3 鏡：字卡（本機，不花錢）')
    await page.keyboard.press('Escape')
    await page.getByTestId('run-all-more').click()
    await page.getByTestId('run-all-stale').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect
      .poll(async () => (await shotsOf(page))[2]?.videos.length, { timeout: 60_000 })
      .toBe(2)
    const rerun = (await shotsOf(page))[2]
    expect(rerun?.videos.map((v) => v.version)).toEqual([1, 2])
    expect(rerun?.videos.at(-1)?.costUsd ?? 0).toBe(0)
  })
})
