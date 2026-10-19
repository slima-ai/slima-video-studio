import { z } from 'zod'

// Zod 預設會用 `new Function` 加速驗證，這會觸發 CSP 的 unsafe-eval 違規。
// 畫面端不允許 eval，所以關掉這個加速（要在任何 schema 被使用之前執行）。
z.config({ jitless: true })
