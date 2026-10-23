import { DEFAULT_LOCALE, setLocale } from '@svs/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KEYS, MODELS, SETTINGS, installFakeSvs } from '../../test/fake-svs'
import { ConnectionsArea } from './connections'
import { ExperimentsSection } from './experiments-section'
import { GeneralSection } from './general-section'
import { KeysSection } from './keys-section'
import { ModelsSection } from './models-section'
import { ProductionGuideSection } from './production-guide-section'
import { ProjectModelsSection } from './project-models-section'
import { StoryboardGuideSection } from './storyboard-guide-section'
import { VideoNegativeSection } from './video-negative-section'

beforeEach(() => {
  setLocale('en')
})
afterEach(() => {
  cleanup()
  setLocale(DEFAULT_LOCALE)
})

const HAN = /[㐀-鿿，。：；（）、！？「」・]/
const around = (text: string): string | undefined =>
  new RegExp(`.{0,20}${HAN.source}.{0,20}`).exec(text)?.[0]

/** 畫面上看得到的字（不含輸入框與文字區裡使用者的內容）。 */
const visibleText = (): string => {
  const copy = document.body.cloneNode(true) as HTMLElement
  for (const el of copy.querySelectorAll('textarea, input')) el.remove()
  return copy.textContent
}

describe('設定頁在英文介面：各區的字都是英文', () => {
  it('一般、實驗功能（含語言選單）、服務金鑰、模型：畫面上沒有中文', async () => {
    installFakeSvs({
      'app.getInfo': () => ({ name: 'x', version: '0', platform: 'darwin', packaged: true }),
    })
    // 模型的價格字串是主行程算好送來的（fake 資料裡是中文），這裡換成英文，只看畫面本身的字
    const models = MODELS.map((m) => ({
      ...m,
      priceLabel: 'About US$0.08/image',
      priceShort: 'About US$0.08 per image',
    }))
    render(
      <>
        <GeneralSection settings={SETTINGS} onChanged={vi.fn()} />
        <ExperimentsSection settings={SETTINGS} onChanged={vi.fn()} />
        <KeysSection keys={KEYS} storage={{ available: true, kind: 'os' }} onChanged={vi.fn()} />
        <ModelsSection models={models} selected={{}} onChanged={vi.fn()} onGoToKeys={vi.fn()} />
        <ProjectModelsSection
          project={{ name: 'Lighthouse', models: {} }}
          models={models}
          selected={{}}
          onChanged={vi.fn()}
        />
        <StoryboardGuideSection settings={SETTINGS} onChanged={vi.fn()} />
        <ProductionGuideSection settings={SETTINGS} onChanged={vi.fn()} />
        <VideoNegativeSection settings={SETTINGS} videoModel={undefined} onChanged={vi.fn()} />
      </>,
    )
    await screen.findByTestId('experiment-claude-chat')
    expect(visibleText()).toContain('Demo mode')
    expect(visibleText()).toContain('Per-run spending limit')
    expect(visibleText()).toContain('Claude chat on the canvas')
    // 語言選單的選項用各自語言的名字（這是故意留中文的唯一一處）
    const text = visibleText().replace('繁體中文', '')
    expect(HAN.test(text), around(text)).toBe(false)
  })

  it('AI 工具連線：連線圖、Claude 兩張卡、Slima 帳號（含書單的單複數）都是英文', async () => {
    installFakeSvs({
      'mcp.status': () => ({
        enabled: true,
        running: true,
        port: 47821,
        url: 'http://127.0.0.1:47821/mcp',
        token: 'svs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        allowanceUsd: 2,
        committedUsd: 0.5,
      }),
      'mcp.connectInfo': () => ({
        claudeDesktop: {
          supported: true,
          configPath: '/x/claude_desktop_config.json',
          installed: false,
          connected: false,
        },
        claudeCode: { installed: false, connected: false },
        desktopSnippet: '{}',
        claudeCodeCommand: "claude mcp add --scope user slima-video-studio -- '/app'",
      }),
      'slima.status': () => ({ state: 'ready', toolCount: 9, last4: 'abcd' }),
      'slima.books': () => ({
        books: [{ token: 'a', title: 'Lighthouse', kind: 'writing', words: 12345 }],
      }),
    })
    render(<ConnectionsArea onChanged={vi.fn()} storageAvailable />)
    await screen.findByTestId('connection-diagram')
    await screen.findByTestId('slima-book')
    for (const button of screen.getAllByTestId('setting-card-more')) fireEvent.click(button)
    expect(visibleText()).toContain('Found 1 book:')
    expect(visibleText()).toContain('Novel · 12,345 words')
    const text = visibleText()
    expect(HAN.test(text), around(text)).toBe(false)
  })

  it('語言選單：三個選項（跟隨系統、繁體中文、English）；選 English 只送 language', async () => {
    const fake = installFakeSvs({ 'settings.update': () => ({}) })
    const onChanged = vi.fn()
    render(<GeneralSection settings={SETTINGS} onChanged={onChanged} />)
    expect(screen.getByTestId<HTMLInputElement>('language-system').checked).toBe(true)
    expect(screen.getByTestId('language-zh-TW').parentElement?.textContent).toBe('繁體中文')
    expect(screen.getByTestId('language-en').parentElement?.textContent).toBe('English')
    fireEvent.click(screen.getByTestId('language-en'))
    await vi.waitFor(() => {
      expect(fake.calls.find((c) => c.channel === 'settings.update')?.payload).toEqual({
        language: 'en',
      })
    })
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
    })
  })

  it('語言存不起來：選項還原並顯示原因', async () => {
    installFakeSvs({
      'settings.update': () => {
        throw new Error('disk full')
      },
    })
    render(<GeneralSection settings={SETTINGS} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('language-en'))
    await screen.findByRole('alert')
    expect(screen.getByTestId<HTMLInputElement>('language-system').checked).toBe(true)
  })
})
