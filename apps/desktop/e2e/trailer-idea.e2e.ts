import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { centerOn } from './canvas-helpers'
import { expect, test } from './fixtures'

const IDEA =
  '這本書說：越忙越沒進度，是因為優先順序錯了。先做最重要的一件事，把待辦清單砍掉一半，每天留一小時專心。'

const shotsOf = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('shots.list', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data.shots
}

/** 最新一個匯出檔的路徑（這個測試自己的 userData 資料夾裡只有它一個）。 */
function exportedFile(userDataDir: string): string {
  const projects = join(userDataDir, 'projects')
  const dir = readdirSync(projects).find((name) => existsSync(join(projects, name, 'exports')))
  if (!dir) throw new Error('找不到匯出資料夾')
  const exports = join(projects, dir, 'exports')
  const file = readdirSync(exports).find((name) => name.endsWith('.mp4'))
  if (!file) throw new Error('找不到匯出的 mp4')
  return join(exports, file)
}

const frameCount = (file: string): number =>
  Number(
    String(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'csv=p=0',
        file,
      ]),
    ).trim(),
  )

test.describe('金句型：句子疊在畫面上（示範模式，不花錢）', () => {
  test.describe.configure({ timeout: 240_000 })

  test('30 秒做到匯出：5 句疊在不動的畫面上、沒有黑底字卡；成品 720 格；抽出有疊字的一格；改字不花錢、不重生圖', async ({
    page,
    userDataDir,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const planned = await page.evaluate(
      (text) => window.svs.invoke('trailer.plan', { text, kind: 'idea', targetSec: 30 }),
      IDEA,
    )
    if (!planned.ok) throw new Error(planned.error.userMessage)
    expect(planned.data.settings.kind).toBe('idea')
    expect(planned.data.errors).toEqual([])
    expect(planned.data.matches).toBe(true)

    const written = await shotsOf(page)
    const overlays = written.filter((s) => s.overlay !== undefined)
    expect(overlays).toHaveLength(5)
    expect(overlays.every((s) => s.beatKind === 'still')).toBe(true)
    expect(written.filter((s) => s.beatKind === 'card')).toHaveLength(0)
    // 旁白念的就是畫面上那一句
    for (const s of overlays) expect(s.dialogue === '' || s.dialogue === s.overlay?.text).toBe(true)

    // 全部生成 → 成品 30 秒 → 匯出 24 fps × 30 秒 ＝ 720 格
    await page.getByTestId('run-all').click()
    await page.getByTestId('run-confirm-ok').click()
    await expect(page.getByTestId('run-all')).toHaveText('全部都生成好了', { timeout: 120_000 })
    await centerOn(page, 'cut')
    await page.getByTestId('open-cut').click()
    await expect(page.getByTestId('final-cut-length')).toHaveText('成品 30 秒', {
      timeout: 30_000,
    })
    await page.getByTestId('final-cut-export').click()
    await expect(page.getByTestId('final-cut-exported')).toBeVisible({ timeout: 90_000 })
    const file = exportedFile(userDataDir)
    expect(Math.abs(frameCount(file) - 720)).toBeLessThanOrEqual(1)

    // 從成品抽出第一個有疊字的格子（每一格的起點是前面各格秒數的加總，過 1.5 秒字已經淡入）
    const all = await shotsOf(page)
    const firstIndex = all.findIndex((s) => s.overlay !== undefined)
    const startSec = all.slice(0, firstIndex).reduce((sum, s) => sum + s.durationSec, 0)
    const png = testInfo.outputPath('idea-overlay-frame.png')
    execFileSync(ffmpegPath ?? 'ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(startSec + 1.5),
      '-i',
      file,
      '-frames:v',
      '1',
      png,
    ])
    expect(existsSync(png)).toBe(true)

    // 改一句金句：只有那一格在本機重做，沒有新首幀，不花錢
    const target = all.find((s) => s.overlay !== undefined)
    if (!target) throw new Error('沒有疊字格')
    const framesBefore = target.firstFrames.length
    const videosBefore = target.videos.length
    const edited = await page.evaluate(
      (id) =>
        window.svs.invoke('shots.update', {
          shotId: id,
          patch: { overlay: { text: '先做最重要的那一件', subtext: '' } },
        }),
      target.id,
    )
    expect(edited.ok).toBe(true)
    await expect
      .poll(async () => (await shotsOf(page)).find((s) => s.id === target.id)?.videos.length, {
        timeout: 60_000,
      })
      .toBe(videosBefore + 1)
    const after = (await shotsOf(page)).find((s) => s.id === target.id)
    expect(after?.firstFrames).toHaveLength(framesBefore)
    expect(after?.videos.at(-1)?.costUsd ?? 0).toBe(0)
  })
})
