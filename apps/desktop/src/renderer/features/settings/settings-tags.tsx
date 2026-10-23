import { useEffect, useRef, useState } from 'react'

import { cn } from '../../lib/cn'
import { t, type MessageRef } from '@svs/schema'

export interface SettingsTag {
  id: string
  label: MessageRef
}

/**
 * 頁面標題列右邊的一排小標籤：點了捲到那一區，捲動時亮著目前看到的這一區。
 * 寬窄視窗都是同一排（窄的時候橫向捲動）。標題列本來就黏在上面，所以標籤也一直在。
 */
/** 最近的、真的會捲動的祖先（設定頁的內容區）。 */
function scrollParentOf(el: HTMLElement): HTMLElement | undefined {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
  }
  return undefined
}

/**
 * 區的頂端捲進視窗上面這一段（視窗高度的 35%，至少標題列下 96px）就算「已經捲進這一區」。
 * 用固定的小數字不行：頁面捲到底、最後幾區的頂端碰不到上緣時，亮的會停在上一區。
 */
const enterLine = (): number => Math.max(96, window.innerHeight * 0.35)
/** 按標籤後，這麼久之內不讓捲動事件改亮的標籤（平滑捲動大約這麼久）。 */
const SCROLL_LOCK_MS = 900

/**
 * 目前在哪一區：最後一個頂端已經捲過上緣線的區；捲到最底了就是最後一區（最後一區很短、頂端永遠碰不到線）。
 * 不用「哪些區跟某條帶子相交、取第一個」：上一區很長時它會一直跟帶子相交，亮的就停在上一區。
 */
export function currentTag(tags: readonly SettingsTag[]): string | undefined {
  let current = tags[0]?.id
  const line = enterLine()
  let last: HTMLElement | null = null
  for (const tag of tags) {
    const el = document.getElementById(tag.id)
    if (!el) continue
    last = el
    if (el.getBoundingClientRect().top <= line) current = tag.id
  }
  if (last) {
    const scroller = scrollParentOf(last)
    if (
      scroller &&
      scroller.scrollTop > 0 &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
    ) {
      return tags[tags.length - 1]?.id
    }
  }
  return current
}

export function SettingsTags({ tags }: { tags: readonly SettingsTag[] }) {
  const [active, setActive] = useState<string>(tags[0]?.id ?? '')
  // 按了標籤、平滑捲動的這段時間，亮的就是按的那一個（不要被捲動途中經過的區搶走）
  const lockedUntil = useRef(0)
  useEffect(() => {
    let frame = 0
    const update = (): void => {
      frame = 0
      if (Date.now() < lockedUntil.current) return
      const id = currentTag(tags)
      if (id) setActive(id)
    }
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    // 內容區是設定頁外面的捲動容器：scroll 事件不會往上傳，用捕獲階段接
    document.addEventListener('scroll', onScroll, true)
    update()
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [tags])
  // 亮的標籤要在標籤列的可視範圍內：窄視窗標籤列要橫向滑，亮的那個自動滑到中間
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const button = nav?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!nav || !button) return
    const navRect = nav.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const delta = rect.left - navRect.left - (nav.clientWidth - rect.width) / 2
    // 整排放得下時 scrollLeft 會被夾在 0，不會動
    if (Math.abs(delta) >= 1) nav.scrollLeft += delta
  }, [active])
  return (
    <nav
      ref={navRef}
      aria-label={t('settings.jumpToThisSectionOf')}
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
            lockedUntil.current = Date.now() + SCROLL_LOCK_MS
            document.getElementById(tag.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          {t(tag.label)}
        </button>
      ))}
    </nav>
  )
}
