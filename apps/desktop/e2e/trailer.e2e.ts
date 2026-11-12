import { writeFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { canvasNodes, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

const status = async (page: Page) => {
  const result = await page.evaluate(() => window.svs.invoke('trailer.status', {}))
  if (!result.ok) throw new Error(result.error.userMessage)
  return result.data
}

const plan = (page: Page, text: string, extra: Record<string, unknown> = {}) =>
  page.evaluate(([t, e]) => window.svs.invoke('trailer.plan', { text: t, ...(e as object) }), [
    text,
    extra,
  ] as const)

test.describe('預告片：寫腳本（示範模式，假腳本，不花錢）', () => {
  test('角色與地點草稿卡：分鏡表看得到出場角色與地點；角色頁、場景卡頁有草稿卡；每格的字不重複', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    const result = await plan(page, STORY)
    if (!result.ok) throw new Error(result.error.userMessage)
    const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!listed.ok) throw new Error(listed.error.userMessage)
    const shots = listed.data.shots
    // 每一格的字不重複
    const texts = (pick: (s: (typeof shots)[number]) => string) =>
      shots.map(pick).filter((x) => x !== '')
    for (const list of [
      texts((s) => s.description),
      texts((s) => s.dialogue),
      texts((s) => s.card?.text ?? ''),
    ]) {
      expect(new Set(list).size).toBe(list.length)
    }
    // 草稿卡：1～2 個角色、1～2 個地點
    const chars = await page.evaluate(() => window.svs.invoke('characters.list', {}))
    const outline = await page.evaluate(() => window.svs.invoke('outline.get', {}))
    if (!chars.ok || !outline.ok) throw new Error('讀不到角色或地點')
    expect(chars.data.characters.map((c) => c.name).sort()).toEqual(['小葉', '老鐘'])
    expect(outline.data.locations.map((l) => l.name).sort()).toEqual(['斷橋', '河岸'])

    // 分鏡表：出場角色與地點兩欄看得到名字（表很寬，捲到右邊）
    await page.getByRole('button', { name: '分鏡表' }).click()
    await expect(page.getByTestId('shot-row')).toHaveCount(shots.length)
    await expect(page.getByRole('button', { name: '預告片', exact: true }).first()).toBeVisible()
    await page.getByTestId('storyboard-table').evaluate((el) => {
      el.parentElement?.scrollTo({ left: el.parentElement.scrollWidth })
    })
    const row = page.getByTestId('shot-row').first()
    await expect(row.getByTestId('cell-characters')).toHaveValue('小葉')
    await expect(row.getByTestId('cell-location')).toHaveAttribute('title', '斷橋')
    await page.screenshot({ path: testInfo.outputPath('storyboard-characters-places.png') })

    // 角色頁與場景卡頁：有草稿卡
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByText('小葉').first()).toBeVisible()
    await expect(page.getByText('老鐘').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('characters-page.png') })
    await page.getByRole('button', { name: '場景卡', exact: true }).click()
    await expect(page.getByText('斷橋').first()).toBeVisible()
    await expect(page.getByText('河岸').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('locations-page.png') })
  })

  test('貼一段故事 → 寫腳本：預設 30 秒；畫布長出「預告片」場與鏡頭；分鏡表看得到腳本；加總 30.0／目標 30', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const check = await page.evaluate(() => window.svs.invoke('trailer.check', {}))
    expect(check).toMatchObject({ ok: true, data: { ok: true, demoMode: true, existingBeats: 0 } })

    const result = await plan(page, STORY)
    if (!result.ok) throw new Error(result.error.userMessage)
    expect(result.data).toMatchObject({
      exists: true,
      targetSec: 30,
      matches: true,
      retried: false,
      errors: [],
    })
    expect(result.data.scriptSec).toBeCloseTo(30, 6)
    expect(result.data.settings.kind).toBe('story')

    // 畫布：一個「預告片」場、鏡頭數對得上、有字卡與片名卡（卡片上標記）
    await expect.poll(() => kindCount(page, 'shot')).toBe(result.data.beatCount)
    const scene = (await canvasNodes(page)).find((n) => n.data.kind === 'scene')
    expect(scene?.data.title).toContain('預告片')
    await expect(page.getByTestId('beat-badge').first()).toBeAttached()
    await expect(page.getByRole('button', { name: '預告片', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '全部顯示' }).click()
    await page.screenshot({ path: testInfo.outputPath('trailer-canvas.png') })

    // 分鏡表：種類、秒數、旁白一格一列
    await page.getByRole('button', { name: '分鏡表' }).click()
    await expect(page.getByTestId('shot-row')).toHaveCount(result.data.beatCount)
    await expect(page.getByTestId('shot-beat-kind').last()).toHaveText('片名卡')
    await page.screenshot({ path: testInfo.outputPath('trailer-storyboard.png') })

    // 狀態：腳本加總＝目標
    const now = await status(page)
    expect(now.scriptSec).toBeCloseTo(30, 6)
    expect(now.matches).toBe(true)
  })

  test('檢查器擋下：腳本寫壞了（第一格是字卡）→ 白話錯誤，已有的腳本一個字都沒被改', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect(page.getByTestId('canvas-root')).toBeVisible()
    const good = await plan(page, STORY)
    if (!good.ok) throw new Error(good.error.userMessage)
    await expect.poll(() => kindCount(page, 'shot')).toBe(good.data.beatCount)
    const before = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!before.ok) throw new Error(before.error.userMessage)

    const result = await plan(page, `${STORY}【腳本不合格】`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.userMessage).toContain('專案沒有被改')
    expect(result.error.userMessage).toContain('第一格必須是畫面')
    // 專案沒被改：腳本還是上一版（鏡頭 id、秒數、字卡都一樣），加總還是 30
    const after = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!after.ok) throw new Error(after.error.userMessage)
    expect(
      after.data.shots.map((x) => [x.id, x.durationSec, x.beatKind ?? 'video', x.card?.text]),
    ).toEqual(
      before.data.shots.map((x) => [x.id, x.durationSec, x.beatKind ?? 'video', x.card?.text]),
    )
    expect((await status(page)).scriptSec).toBeCloseTo(30, 6)
    // 上方專案列的名字晚幾百毫秒才更新（自動建的專案叫「預告片」）：等它，截圖才不會是舊的
    await expect(page.getByRole('button', { name: '預告片', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '全部顯示' }).click()
    await page.screenshot({ path: testInfo.outputPath('trailer-blocked-canvas-unchanged.png') })
    // 現在沒有畫面能顯示這則錯誤（入口在 T7）：把 IPC 的回覆原文存下來
    writeFileSync(
      testInfo.outputPath('checker-blocked-reply.json'),
      JSON.stringify(result, null, 2),
    )
  })

  test('自己把某一格改長：加總對不上目標，檢查器說差幾秒（長度規則）；照新長度重排後剛好', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '畫布', exact: true }).click()
    const planned = await plan(page, STORY, { targetSec: 20 })
    if (!planned.ok) throw new Error(planned.error.userMessage)
    expect(planned.data.scriptSec).toBeCloseTo(20, 6)
    const listed = await page.evaluate(() => window.svs.invoke('shots.list', {}))
    if (!listed.ok) throw new Error(listed.error.userMessage)
    const second = listed.data.shots[1]
    if (!second) throw new Error('沒有第 2 格')
    const edited = await page.evaluate(
      ([id, sec]) =>
        window.svs.invoke('shots.update', {
          shotId: id,
          patch: { durationSec: sec },
        }),
      [second.id, second.durationSec + 2.5] as const,
    )
    expect(edited.ok).toBe(true)
    const off = await status(page)
    expect(off.matches).toBe(false)
    expect(off.errors.map((e) => e.code)).toContain('length')
    const fitted = await page.evaluate(() =>
      window.svs.invoke('trailer.update', { patch: { targetSec: 20 }, refit: true }),
    )
    if (!fitted.ok) throw new Error(fitted.error.userMessage)
    expect(fitted.data.matches).toBe(true)
    expect(fitted.data.scriptSec).toBeCloseTo(20, 6)
  })
})
