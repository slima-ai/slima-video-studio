import type { Page } from '@playwright/test'

/** 自訂下拉選單選一個值（testId 是選單按鈕，選項是 `${testId}-option-${value}`）。 */
export async function pick(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByTestId(`${testId}-option-${value}`).click()
}
