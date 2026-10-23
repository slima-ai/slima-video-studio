import {
  setLocale,
  type SlimaImportCheck,
  type SlimaImportResult,
  type SlimaTree,
} from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppView } from '../../components/app-layout'
import { appError, installFakeSvs } from '../../test/fake-svs'
import { SlimaImportPage } from './import-page'

afterEach(cleanup)

const READY = { state: 'ready', toolCount: 9 } as const

const BOOKS = [
  { token: 'bk_1', title: '雨夜的貓', kind: 'writing', words: 12345 },
  { token: 'bk_2', title: '鐵與花', kind: 'script', words: 3200 },
] as const

const TREE: SlimaTree = {
  book: BOOKS[0],
  files: [
    { path: 'chapter-01.md', name: 'chapter-01.md', words: 900, suggestedUse: 'story' },
    { path: 'characters/阿鐵.md', name: '阿鐵.md', words: 23, suggestedUse: 'character' },
    { path: 'world/舊倉庫.md', name: '舊倉庫.md', words: 20, suggestedUse: 'location' },
  ],
}

const CHECK: SlimaImportCheck = {
  ok: true,
  storyFiles: 1,
  storyChars: 900,
  characters: ['阿鐵'],
  locations: [],
  scenes: [],
  skipped: [{ path: 'world/舊倉庫.md', reason: '已經有同名的地點「舊倉庫」' }],
  estimatedUsd: 0.05,
  modelName: 'Test LLM',
  demoMode: false,
  replacesOutline: true,
}

const RESULT: SlimaImportResult = {
  actsFromStory: 2,
  characters: ['阿鐵'],
  locations: [],
  scenes: [],
  skipped: [],
}

const nth = <T,>(list: readonly T[], index: number): T => {
  const item = list[index]
  if (item === undefined) throw new Error(`沒有第 ${String(index)} 個`)
  return item
}

const renderPage = () => {
  const onNavigate = vi.fn<(view: AppView) => void>()
  const onOpenSettings = vi.fn()
  render(<SlimaImportPage onOpenSettings={onOpenSettings} onNavigate={onNavigate} />)
  return { onNavigate, onOpenSettings }
}

describe('SlimaImportPage', () => {
  it('還沒連上 Slima：說明並帶去設定，不列書', async () => {
    installFakeSvs({
      'slima.status': () => ({ state: 'error', message: 'Slima 不接受這組 Token' }),
    })
    const { onOpenSettings } = renderPage()
    const offline = await screen.findByTestId('slima-import-offline')
    expect(offline.textContent).toContain('Slima 不接受這組 Token')
    expect(screen.queryByTestId('slima-import-books')).toBeNull()
    fireEvent.click(within(offline).getByRole('button'))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('選書 → 勾選檔案（用途預設依檔案猜、可以改）→ 檢查 → 確定匯入 → 結果與前往連結', async () => {
    const svs = installFakeSvs({
      'slima.status': () => READY,
      'slima.books': () => ({ books: [...BOOKS] }),
      'slima.tree': () => TREE,
      'slima.importCheck': () => CHECK,
      'slima.import': () => RESULT,
    })
    const { onNavigate } = renderPage()
    const books = await screen.findAllByTestId('slima-import-book')
    expect(books.map((b) => b.textContent)).toEqual([
      '雨夜的貓小說・12,345 字',
      '鐵與花劇本・3,200 字',
    ])
    fireEvent.click(nth(books, 0))
    await screen.findByTestId('slima-import-files')
    expect(svs.payloadsOf('slima.tree')).toEqual([{ bookToken: 'bk_1' }])
    expect(screen.getByTestId('slima-import-run').hasAttribute('disabled')).toBe(true)

    const uses = screen.getAllByTestId<HTMLSelectElement>('slima-import-use')
    expect(uses.map((u) => u.value)).toEqual(['story', 'character', 'location'])

    fireEvent.click(screen.getByLabelText('選取 chapter-01.md'))
    fireEvent.click(screen.getByLabelText('選取 world/舊倉庫.md'))
    fireEvent.change(uses[2] as HTMLElement, { target: { value: 'scene' } })
    expect(screen.getByTestId('slima-import-run').textContent).toBe('匯入選取的 2 個檔案')

    fireEvent.click(screen.getByTestId('slima-import-run'))
    await screen.findByTestId('slima-import-check')
    expect(svs.payloadsOf('slima.importCheck')).toEqual([
      {
        bookToken: 'bk_1',
        items: [
          { path: 'chapter-01.md', use: 'story' },
          { path: 'world/舊倉庫.md', use: 'scene' },
        ],
      },
    ])
    const story = screen.getByTestId('slima-import-story').textContent
    expect(story).toContain('1 個檔案（約 900 字）')
    expect(story).toContain('預估約 US$0.05（Test LLM）')
    expect(screen.getByTestId('slima-import-replaces').textContent).toContain('換掉目前的大綱')
    expect(screen.getByTestId('slima-import-skipped').textContent).toContain('已經有同名的地點')
    expect(svs.payloadsOf('slima.import')).toEqual([])

    fireEvent.click(screen.getByTestId('slima-import-confirm'))
    const summary = await screen.findByTestId('slima-import-summary')
    expect(summary.textContent).toBe('新增：拆出 2 幕、1 個角色。')
    expect(svs.payloadsOf('slima.import')).toHaveLength(1)
    expect(screen.queryByTestId('slima-import-files')).toBeNull()

    fireEvent.click(screen.getByTestId('slima-go-outline'))
    fireEvent.click(screen.getByTestId('slima-go-characters'))
    expect(screen.queryByTestId('slima-go-locations')).toBeNull()
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['outline', 'characters'])
  })

  it('示範模式不顯示花費；改了勾選或用途就要重新檢查（舊的檢查結果收起來）', async () => {
    installFakeSvs({
      'slima.status': () => READY,
      'slima.books': () => ({ books: [...BOOKS] }),
      'slima.tree': () => TREE,
      'slima.importCheck': () => ({ ...CHECK, demoMode: true, replacesOutline: false }),
    })
    renderPage()
    fireEvent.click(nth(await screen.findAllByTestId('slima-import-book'), 0))
    await screen.findByTestId('slima-import-files')
    fireEvent.click(screen.getByLabelText('選取 chapter-01.md'))
    fireEvent.click(screen.getByTestId('slima-import-run'))
    expect((await screen.findByTestId('slima-import-story')).textContent).toContain(
      '示範模式不花錢',
    )
    expect(screen.queryByTestId('slima-import-replaces')).toBeNull()

    fireEvent.click(screen.getByLabelText('選取 characters/阿鐵.md'))
    expect(screen.queryByTestId('slima-import-check')).toBeNull()
  })

  it('檢查沒過：只顯示原因，沒有確定匯入；沒有檔案的書與讀取失敗都有說明', async () => {
    const svs = installFakeSvs({
      'slima.status': () => READY,
      'slima.books': () => ({ books: [...BOOKS] }),
      'slima.tree': (payload: { bookToken: string }) => {
        if (payload.bookToken === 'bk_2') throw appError('Slima 沒有回應，請稍後再試。')
        return TREE
      },
      'slima.importCheck': (): SlimaImportCheck => ({
        ...CHECK,
        ok: false,
        issue: '選的文字太長了',
        replacesOutline: false,
      }),
    })
    renderPage()
    const books = await screen.findAllByTestId('slima-import-book')
    fireEvent.click(nth(books, 1))
    expect((await screen.findByRole('alert')).textContent).toContain('沒有回應')

    fireEvent.click(nth(books, 0))
    await screen.findByTestId('slima-import-files')
    fireEvent.click(screen.getByLabelText('選取 chapter-01.md'))
    fireEvent.click(screen.getByTestId('slima-import-run'))
    await waitFor(() => {
      expect(screen.getByTestId('slima-import-issue').textContent).toBe('選的文字太長了')
    })
    expect(screen.queryByTestId('slima-import-confirm')).toBeNull()
    fireEvent.click(screen.getByTestId('slima-import-cancel'))
    expect(screen.queryByTestId('slima-import-check')).toBeNull()
    expect(svs.payloadsOf('slima.import')).toEqual([])

    fireEvent.click(screen.getByTestId('slima-import-back'))
    expect(await screen.findAllByTestId('slima-import-book')).toHaveLength(2)
  })
})

describe('SlimaImportPage（英文介面）', () => {
  afterEach(() => {
    setLocale('zh-TW')
  })

  it('選書 → 檢查 → 匯入 → 結果：單複數與整句都是英文，沒有中文的標點與量詞', async () => {
    setLocale('en')
    installFakeSvs({
      'slima.status': () => READY,
      'slima.books': () => ({ books: [...BOOKS] }),
      'slima.tree': () => TREE,
      'slima.importCheck': () => CHECK,
      'slima.import': () => RESULT,
    })
    renderPage()
    const books = await screen.findAllByTestId('slima-import-book')
    expect(books.map((b) => b.textContent)).toEqual([
      '雨夜的貓Novel · 12,345 words',
      '鐵與花Script · 3,200 words',
    ])
    fireEvent.click(nth(books, 0))
    await screen.findByTestId('slima-import-files')
    fireEvent.click(screen.getByLabelText('Select chapter-01.md'))
    expect(screen.getByTestId('slima-import-run').textContent).toBe('Import the 1 selected file')
    fireEvent.click(screen.getByLabelText('Select world/舊倉庫.md'))
    expect(screen.getByTestId('slima-import-run').textContent).toBe('Import the 2 selected files')
    fireEvent.click(screen.getByTestId('slima-import-run'))
    await screen.findByTestId('slima-import-check')
    expect(screen.getByTestId('slima-import-story').textContent).toBe(
      'Have AI split 1 file (about 900 words) into scenes for about US$0.05 (Test LLM).',
    )
    fireEvent.click(screen.getByTestId('slima-import-confirm'))
    const summary = await screen.findByTestId('slima-import-summary')
    expect(summary.textContent).toBe('Added: 2 acts, 1 character.')
  })
})
