import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Mascot, MASCOT_MOODS } from './mascot'

describe('Mascot', () => {
  afterEach(cleanup)

  it('只露出 4×4 圖裡的一格：背景放大到整張圖的大小，位置對到那一格', () => {
    render(<Mascot mood="done" size={40} />)
    const el = screen.getByTestId('mascot')
    // 40px 一格 → 整張 160px；done 在第 1 列第 3 欄
    expect(el.style.backgroundSize).toBe('160px 160px')
    expect(el.style.backgroundPosition).toBe('-120px -40px')
    expect(el.style.width).toBe('40px')
    expect(el.dataset.mood).toBe('done')
  })

  it('預設是等你說話的睜眼那格，而且只是裝飾，對讀屏軟體隱藏', () => {
    render(<Mascot />)
    const el = screen.getByTestId('mascot')
    expect(el.dataset.mood).toBe('idle')
    expect(el.style.backgroundPosition).toMatch(/^(0px|-0px) (0px|-0px)$/)
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('每個表情的格子都不一樣', () => {
    const positions = new Set<string>()
    for (const mood of MASCOT_MOODS) {
      const { unmount } = render(<Mascot mood={mood} size={160} />)
      positions.add(screen.getByTestId('mascot').style.backgroundPosition)
      unmount()
    }
    expect(positions.size).toBe(MASCOT_MOODS.length)
  })
})

describe('brand 資料夾的授權聲明', () => {
  it('資料夾自己有 NOTICE，根目錄的 NOTICE 指過來（圖像不在 Apache-2.0 內）', () => {
    const here = join(__dirname)
    expect(readFileSync(join(here, 'NOTICE'), 'utf8')).toContain('NOT licensed under the')
    expect(readFileSync(join(here, '../../../../../NOTICE'), 'utf8')).toContain(
      'apps/desktop/src/renderer/brand/',
    )
  })
})
