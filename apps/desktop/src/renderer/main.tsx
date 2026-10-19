import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './zod-config'
import { CSP_VIOLATION_PREFIX } from '../shared/csp'
import { App } from './app'
import './styles.css'

// CSP 違規 → console 訊息，由主行程攔截後寫入 log
document.addEventListener('securitypolicyviolation', (e) => {
  console.error(`${CSP_VIOLATION_PREFIX} ${e.violatedDirective} blocked ${e.blockedURI}`)
})

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
