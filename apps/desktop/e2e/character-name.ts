import { expect, type Locator, type Page } from '@playwright/test'

/**
 * 角色頁「新角色的名字」輸入框。還沒有任何角色時頁面先顯示空狀態，
 * 要先按「建立第一個角色」輸入框才會出現。
 */
export async function characterNameInput(page: Page): Promise<Locator> {
  const input = page.getByTestId('character-new-name')
  const start = page.getByTestId('character-empty-create')
  await expect(input.or(start)).toBeVisible()
  if (await start.isVisible()) await start.click()
  return input
}
