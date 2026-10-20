#!/usr/bin/env node
// 沒登入的假 claude：`auth status` 回 loggedIn:false。（App 只給 claude 行程最小的環境變數，
// 所以不能靠環境變數切換，要用另一支執行檔。）
process.env.FAKE_CLAUDE_LOGGED_OUT = '1'
await import('./claude.mjs')
