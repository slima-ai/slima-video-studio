import type { ReactNode } from 'react'

export interface SettingGroupProps {
  /** 錨點 id（頂端的小標籤捲到這裡）。 */
  id: string
  title: string
  /** 一句白話副標。 */
  hint: string
  testId?: string
  children: ReactNode
}

/** 設定頁的一區：區標題＋一句副標＋一組卡片（桌面兩欄、窄視窗一欄）。 */
export function SettingGroup({ id, title, hint, testId, children }: SettingGroupProps) {
  const headingId = `${id}-heading`
  return (
    <section
      id={id}
      data-testid={testId ?? id}
      aria-labelledby={headingId}
      // 頂端的頁面標題列是 56px 高、黏在上面：捲到這一區時留出它的位置
      className="scroll-mt-16 space-y-3"
    >
      <div>
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">{hint}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}
