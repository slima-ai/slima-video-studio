import type { AppData } from './use-app-data'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS } from '../../test/fake-svs'
import { SettingsPage } from './settings-page'

// 各區自己的內容有各自的測試；這裡只看頁面骨架：五區的順序、頂端小標籤、連線區的轉接
vi.mock('./general-section', () => ({
  GeneralSection: () => <div data-testid="general-section" />,
}))
vi.mock('./connections', () => ({ ConnectionsArea: () => <div data-testid="connections-area" /> }))
vi.mock('./keys-section', () => ({ KeysSection: () => <div data-testid="keys-section" /> }))
vi.mock('./models-section', () => ({ ModelsSection: () => <div data-testid="models-section" /> }))
vi.mock('./project-models-section', () => ({
  ProjectModelsSection: () => <div data-testid="project-models-section" />,
}))
vi.mock('./storyboard-guide-section', () => ({
  StoryboardGuideSection: () => <div data-testid="storyboard-guide-section" />,
}))
vi.mock('./experiments-section', () => ({
  ExperimentsSection: () => <div data-testid="experiments-section" />,
}))

const DATA: AppData = {
  keys: [],
  storage: { available: true, kind: 'memory' },
  settings: SETTINGS,
  models: [],
  locked: [],
  selected: {},
  voices: {},
  project: null,
}

const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})
afterEach(cleanup)

describe('SettingsPage 骨架', () => {
  it('五區照順序：一般 → AI 工具連線 → 服務金鑰 → 模型 → 實驗功能；各區原本的內容（與 testid）都在', () => {
    render(<SettingsPage state={{ status: 'ready', data: DATA }} reload={vi.fn()} />)
    const ids = [...document.querySelectorAll('section[id]')].map((el) => el.id)
    expect(ids).toEqual(['general', 'connections', 'keys', 'models', 'experiments'])
    for (const testId of [
      'general-section',
      'connections-area',
      'keys-section',
      'models-section',
      'storyboard-guide-section',
      'experiments-section',
    ]) {
      expect(screen.getByTestId(testId)).toBeTruthy()
    }
    // 每一區都有一句副標
    for (const id of ids) {
      expect(
        (document.getElementById(id)?.querySelector('p')?.textContent ?? '').length,
      ).toBeGreaterThan(0)
    }
  })

  it('頂端一排小標籤，順序與區一樣；點了捲到那一區', () => {
    render(<SettingsPage state={{ status: 'ready', data: DATA }} reload={vi.fn()} />)
    const tags = screen.getByTestId('settings-tags')
    expect([...tags.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '一般',
      'AI 工具連線',
      '服務金鑰',
      '模型',
      '實驗功能',
    ])
    fireEvent.click(screen.getByTestId('settings-tag-keys'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('keys'))
    expect(screen.getByTestId('settings-tag-keys').getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('settings-tag-general').getAttribute('aria-current')).toBeNull()
  })

  it('讀取中與出錯：不顯示區，出錯有重試', () => {
    const reload = vi.fn()
    render(<SettingsPage state={{ status: 'loading' }} reload={reload} />)
    expect(screen.getByTestId('settings-loading')).toBeTruthy()
    expect(document.querySelector('section[id]')).toBeNull()
    cleanup()
    render(<SettingsPage state={{ status: 'error', message: '讀不到' }} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    expect(reload).toHaveBeenCalled()
  })

  it('有開專案才有「這個專案預設用什麼」', () => {
    render(
      <SettingsPage
        state={{
          status: 'ready',
          data: {
            ...DATA,
            models: [{ id: 'm' } as AppData['models'][number]],
            project: { id: 'p', name: 'P', models: {} } as unknown as AppData['project'],
          },
        }}
        reload={vi.fn()}
      />,
    )
    expect(screen.getByTestId('project-models-section')).toBeTruthy()
  })
})
