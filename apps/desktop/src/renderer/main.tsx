import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './zod-config'
import { CSP_VIOLATION_PREFIX } from '../shared/csp'
import { App } from './app'
import { I18nRoot, loadLocale } from './lib/i18n'
import { restoreTheme } from './lib/theme'
import './styles.css'

// CSP 違規 → console 訊息，由主行程攔截後寫入 log
document.addEventListener('securitypolicyviolation', (e) => {
  console.error(`${CSP_VIOLATION_PREFIX} ${e.violatedDirective} blocked ${e.blockedURI}`)
})

// 第一次畫出來之前先套好上次的外觀（設定要等主行程回應，不先套會先閃一下淺色）
restoreTheme()

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root')

// 先問主行程現在的介面語言再畫第一次，才不會先閃一下別的語言
void loadLocale().then(() => {
  createRoot(root).render(
    <StrictMode>
      <I18nRoot>
        <App />
      </I18nRoot>
    </StrictMode>,
  )
})
