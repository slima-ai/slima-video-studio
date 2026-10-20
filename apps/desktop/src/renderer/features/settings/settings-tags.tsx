import { useEffect, useState } from 'react'

import { cn } from '../../lib/cn'

export interface SettingsTag {
  id: string
  label: string
}

/**
 * 頁面標題列右邊的一排小標籤：點了捲到那一區，捲動時亮著目前看到的這一區。
 * 寬窄視窗都是同一排（窄的時候橫向捲動）。標題列本來就黏在上面，所以標籤也一直在。
 */
export function SettingsTags({ tags }: { tags: readonly SettingsTag[] }) {
  const [active, setActive] = useState<string>(tags[0]?.id ?? '')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const seen = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting)
        const first = tags.find((tag) => seen.get(tag.id) === true)
        if (first) setActive(first.id)
      },
      // 標題列 56px：它下面這一條才算「看到」；只看上半部，下面剛露頭的區不算
      { rootMargin: '-64px 0px -55% 0px' },
    )
    for (const tag of tags) {
      const el = document.getElementById(tag.id)
      if (el) observer.observe(el)
    }
    return () => {
      observer.disconnect()
    }
  }, [tags])
  return (
    <nav
      aria-label="跳到設定的這一區"
      data-testid="settings-tags"
      className="flex max-w-full items-center gap-1 overflow-x-auto"
    >
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          data-testid={`settings-tag-${tag.id}`}
          aria-current={active === tag.id ? 'true' : undefined}
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-xs',
            active === tag.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-fg/10',
          )}
          onClick={() => {
            setActive(tag.id)
            document.getElementById(tag.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          {tag.label}
        </button>
      ))}
    </nav>
  )
}
