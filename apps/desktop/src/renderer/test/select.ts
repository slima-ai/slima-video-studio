import { fireEvent, screen, within } from '@testing-library/react'

/** 自訂下拉選單：點開按鈕，再點某個選項（選項的 testId 是 `${testId}-option-${value}`）。 */
export function choose(testId: string, value: string): void {
  fireEvent.click(screen.getByTestId(testId))
  fireEvent.click(screen.getByTestId(`${testId}-option-${value}`))
}

/** 點開下拉選單，回傳每個選項的文字；看完再收起來。 */
export function optionLabels(testId: string): string[] {
  const trigger = screen.getByTestId(testId)
  fireEvent.click(trigger)
  const labels = within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent)
  fireEvent.click(trigger)
  return labels
}
