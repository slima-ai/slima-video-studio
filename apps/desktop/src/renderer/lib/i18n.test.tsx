import { DEFAULT_LOCALE, getLocale, setLocale, t } from '@svs/schema'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { installFakeSvs } from '../test/fake-svs'
import { I18nRoot, loadLocale } from './i18n'

afterEach(() => {
  cleanup()
  setLocale(DEFAULT_LOCALE)
  document.documentElement.lang = 'zh-Hant'
})

function Label() {
  return <span data-testid="label">{t('menu.save')}</span>
}

describe('畫面的介面語言', () => {
  it('啟動時先問主行程現在的語言，並設好 <html lang>；問不到就維持預設', async () => {
    installFakeSvs({ 'app.locale': () => ({ locale: 'en' }) })
    await loadLocale()
    expect(getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')

    setLocale(DEFAULT_LOCALE)
    installFakeSvs({}) // 沒有實作 app.locale → 回錯誤
    await loadLocale()
    expect(getLocale()).toBe('zh-TW')
  })

  it('主行程說語言變了（locale.changed）：整棵重畫，字全部換掉，<html lang> 也換', () => {
    const svs = installFakeSvs()
    render(
      <I18nRoot>
        <Label />
      </I18nRoot>,
    )
    expect(screen.getByTestId('label').textContent).toBe('儲存')
    act(() => {
      svs.emit('locale.changed', { locale: 'en' })
    })
    expect(screen.getByTestId('label').textContent).toBe('Save')
    expect(document.documentElement.lang).toBe('en')
    act(() => {
      svs.emit('locale.changed', { locale: 'zh-TW' })
    })
    expect(screen.getByTestId('label').textContent).toBe('儲存')
    expect(document.documentElement.lang).toBe('zh-Hant')
  })
})
