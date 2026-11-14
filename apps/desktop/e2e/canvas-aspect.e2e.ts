import { canvasNodes } from './canvas-helpers'
import { expect, test } from './fixtures'

const STORY = '黑藤爬滿了斷橋。她一個人守著最後一盞燈，直到有人敲門。門外的人說，他來自河的另一邊。'

const invoke = async (call: () => Promise<{ ok: boolean }>) => {
  const result = await call()
  expect(result.ok).toBe(true)
}

test('預告片專案的畫布：鏡頭卡標題寫段落「鉤子・1」；直式專案的畫布標成 9:16（縮圖整張放進框裡）', async ({
  page,
}) => {
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await invoke(() =>
    page.evaluate(() => window.svs.invoke('project.createNew', { name: '直式預告片' })),
  )
  await invoke(() =>
    page.evaluate(() => window.svs.invoke('project.configure', { aspectRatio: '9:16' })),
  )
  await invoke(() => page.evaluate((text) => window.svs.invoke('trailer.plan', { text }), STORY))
  await page.getByRole('button', { name: '畫布', exact: true }).click()
  await expect(page.getByTestId('canvas-root')).toHaveAttribute('data-aspect', '9:16')
  const titles = (await canvasNodes(page)).map((n) => n.data.title)
  expect(titles).toContain('鉤子・1')
  expect(titles).not.toContain('第 1 鏡')
})
