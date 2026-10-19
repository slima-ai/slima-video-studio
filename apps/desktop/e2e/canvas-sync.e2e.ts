import type { Page } from '@playwright/test'

import { characterNameInput } from './character-name'
import { canvasNodes, centerOn, generateAndOpenCanvas, kindCount } from './canvas-helpers'
import { expect, test } from './fixtures'

const invoke = (page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) => {
      const result = await (
        window.svs.invoke as (c: string, p: unknown) => Promise<{ ok: boolean }>
      )(channel, payload)
      if (!result.ok) throw new Error(`${channel} 失敗`)
      return result
    },
    { channel, payload },
  )

test.describe('畫布與表單頁同步', () => {
  test('在畫布的面板改鏡頭描述，分鏡表馬上看到；在分鏡表刪鏡頭，畫布上的格子消失', async ({
    page,
  }) => {
    await generateAndOpenCanvas(page)
    const [first] = (await canvasNodes(page)).filter((n) => n.data.kind === 'shot')
    if (!first) throw new Error('沒有鏡頭')
    await centerOn(page, first.id)
    await page.getByTestId(`open-${first.id}`).click()
    await page.getByTestId('shot-description').fill('貓在屋頂上看著月亮')
    await page.getByTestId('shot-save').click()
    await expect(page.getByTestId(`node-${first.id}`)).toContainText('貓在屋頂上看著月亮')

    await page.getByRole('button', { name: '分鏡表' }).click()
    const rows = page.getByTestId('shot-row')
    // 分鏡表的描述是輸入框：找輸入框裡有這段字的那一列
    const rowWith = (text: string) =>
      rows.evaluateAll(
        (els, wanted) =>
          els.findIndex((row) =>
            [
              ...row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
            ].some((field) => field.value.includes(wanted)),
          ),
        text,
      )
    await expect.poll(() => rowWith('貓在屋頂上看著月亮')).toBeGreaterThanOrEqual(0)
    const before = await rows.count()

    await rows
      .nth(await rowWith('貓在屋頂上看著月亮'))
      .getByTestId('row-select')
      .check()
    await page.getByTestId('storyboard-delete').click()
    await page.getByTestId('storyboard-delete-confirm').click()
    await expect(rows).toHaveCount(before - 1)
    expect(await rowWith('貓在屋頂上看著月亮')).toBe(-1)

    await page.getByRole('button', { name: '畫布', exact: true }).click()
    // 只等「被刪的那格不在了」不夠：畫布剛切回來、節點還沒載入時 canvasNodes 是空的，
    // 這個條件對空畫布也成立，接著就會讀到 0 格（機器忙時才踩得到）。所以先等鏡頭數對，再確認那格不在
    await expect.poll(() => kindCount(page, 'shot')).toBe(before - 1)
    expect((await canvasNodes(page)).some((n) => n.id === first.id)).toBe(false)
  })

  test('角色頁開著時，別的地方改了角色名字：清單馬上跟著變（不用重新整理）', async ({ page }) => {
    await page.getByRole('button', { name: '角色', exact: true }).click()
    await (await characterNameInput(page)).fill('阿鐵')
    await page.getByTestId('character-add').click()
    await expect(page.getByTestId('character-item-阿鐵')).toBeVisible()
    const list = await page.evaluate(() => window.svs.invoke('characters.list', {}))
    if (!list.ok) throw new Error('讀不到角色')
    const id = list.data.characters[0]?.id ?? ''
    // 例如在畫布的浮動面板裡改名
    await invoke(page, 'characters.update', { characterId: id, patch: { name: '阿鐵二號' } })
    await expect(page.getByTestId('character-item-阿鐵二號')).toBeVisible()
    await expect(page.getByTestId('character-item-阿鐵')).toHaveCount(0)
  })

  test('場景卡頁開著時，大綱改了地點名字：清單馬上跟著變；畫布上的地點也一樣', async ({ page }) => {
    await generateAndOpenCanvas(page)
    await page.getByTestId('palette-location').click()
    await expect.poll(() => kindCount(page, 'location')).toBe(1)
    const place = (await canvasNodes(page)).find((n) => n.data.kind === 'location')
    if (!place) throw new Error('沒有地點')
    const locationId = place.id.replace('location:', '')

    await page.getByRole('button', { name: '場景卡' }).click()
    await expect(page.getByTestId(`location-item-${place.data.title}`)).toBeVisible()
    await invoke(page, 'outline.edit', {
      op: 'updateLocation',
      locationId,
      patch: { name: '雨夜的巷口' },
    })
    await expect(page.getByTestId('location-item-雨夜的巷口')).toBeVisible()

    await page.getByRole('button', { name: '畫布', exact: true }).click()
    await expect
      .poll(async () => (await canvasNodes(page)).find((n) => n.id === place.id)?.data.title)
      .toBe('雨夜的巷口')
  })
})
