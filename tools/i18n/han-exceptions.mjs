// 寫死中文字串的 ESLint 規則（見 no-hard-coded-han.mjs）的例外清單。
// 每一條都要寫理由；tools/i18n/no-hard-coded-han.test.ts 會逐條驗證「拿掉這一條，規則就會紅」
// （所以清單裡不會留著已經不需要的條目）。新增例外之前先問：這串字能不能改成 t()／msg()？
// 能就改，不能（送給模型的字、給開發者的工具、拿來比對資料的字）才加在這裡，並說明為什麼。

/** @type {Array<{ files: string[]; reason: string }>} */
export const HAN_EXCEPTIONS = [
  // ── 不是正式程式 ──
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.e2e.{ts,tsx}',
      '**/e2e/**',
      'packages/test-utils/**',
      'apps/desktop/src/renderer/test/**',
      'apps/desktop/src/main/mcp/test-support.ts',
      'apps/desktop/src/main/settings/test-deps.ts',
      'apps/desktop/src/main/shots/test-harness.ts',
      'apps/desktop/src/main/test-support/**',
      'packages/db/src/__tests__/**',
      'packages/engine/src/test-helpers.ts',
    ],
    reason:
      '測試與測試輔助：固定用繁體中文跑（docs/i18n.md「測試固定用繁體中文」），假資料與斷言本來就寫中文。',
  },
  {
    files: ['packages/schema/src/i18n/locales/zh-TW/**'],
    reason: '繁體中文字串檔本身：中文就該寫在這裡（key 的型別也從這裡來）。',
  },
  {
    files: ['apps/desktop/src/main/smoke/**'],
    reason:
      '真實 API 冒煙測試（pnpm smoke）：開發者手動跑、會花錢，報告與測試故事寫中文，使用者看不到。',
  },
  {
    files: ['apps/desktop/src/main/perf/demo-seed.ts'],
    reason: '效能自測用的示範專案資料（開發者用），使用者看不到。',
  },
  {
    files: ['apps/desktop/src/renderer/features/canvas/perf-overlay.tsx'],
    reason:
      '開發者自測浮層（從「？」選單開，量畫布效能），使用者看不到；決定見 HQ i18n PR 7 計畫第 5 節決定 3。',
  },

  // ── 送給模型的字：改了會讓已存專案的快取失效、要重花錢（輸出用雜湊釘住，見 packages/workflows/src/prompts-golden.test.ts 與 story-language-prompts.test.ts） ──
  {
    files: [
      'packages/workflows/src/nodes.ts',
      'packages/workflows/src/styles.ts',
      'packages/workflows/src/structured.ts',
      'packages/schema/src/domain/camera.ts',
      'packages/schema/src/domain/character-prompts.ts',
      'packages/schema/src/domain/storyboard-guide.ts',
    ],
    reason:
      '送給圖片／影片／文字模型的提示詞與組裝片段：語言是模型看的，不隨介面語言變（README 與 docs/i18n.md 有說明）；輸出用 SHA-256 釘住，改一個字測試就紅。',
  },
  {
    files: [
      'apps/desktop/src/main/storyboard/storyboard-service.ts',
      'apps/desktop/src/main/outline/outline-service.ts',
      'apps/desktop/src/main/characters/anchor-suggester.ts',
    ],
    reason:
      '拆鏡、拆大綱／場、整理固定外觀的 system prompt：送給模型，用雜湊釘住（story-language-prompts.test.ts），不隨介面語言變。',
  },
  {
    files: [
      'packages/schema/src/domain/story.ts',
      'packages/schema/src/domain/characters.ts',
      'packages/schema/src/domain/location-cards.ts',
      'packages/schema/src/domain/quickstart.ts',
    ],
    reason:
      '景別、角度、畫風、參考圖用途的中文名稱表：同時是送進 Prompt／MCP 的字（用雜湊釘住）。給人看的名字另有跟介面語言走的 labels.ts。',
  },

  // ── 拿來比對資料、或刻意中英並列的字 ──
  {
    files: ['apps/desktop/src/main/mcp/ai-changes.ts'],
    reason: '比對「第 N 鏡／第 N 場」：舊專案存的標題是中文，要把編號蓋掉才能比出內容有沒有改。',
  },
  {
    files: ['apps/desktop/src/main/mcp/stdio-bridge.ts'],
    reason:
      'stdio 橋是獨立行程、沒有介面語言：訊息英文，畫面上的名字刻意中英並列（「設定 → AI 工具連線」）。',
  },
  {
    files: ['packages/db/src/repositories/characters.ts'],
    reason: '`預設服裝`：只存在資料裡的預設名，畫面不顯示；舊專案存的就是這個字，不能改。',
  },
  {
    files: ['apps/desktop/src/main/quickstart/quickstart-service.ts'],
    reason: "`'字'.repeat(40)`：估旁白計費字數用的一串中文字（旁白以字計費），不是顯示用的字。",
  },
  {
    files: ['apps/desktop/src/preload/api.ts'],
    reason:
      'preload 是獨立行程、沒有介面語言（t() 永遠是繁中）；這兩句只在 IPC 通道缺失或內部錯誤時才可能出現。',
  },
]
