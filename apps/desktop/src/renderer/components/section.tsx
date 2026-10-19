import type { ReactNode } from 'react'

export interface SectionProps {
  title: string
  description?: string
  children: ReactNode
  testId?: string
}

/** 設定頁與引導精靈共用的區塊外框。 */
export function Section({ title, description, children, testId }: SectionProps) {
  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-border bg-surface-raised shadow-card p-6"
      aria-label={title}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="wrap-zh mt-1 text-sm text-fg-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}
