/** 套件相依規則。與 tools/eslint/boundaries.mjs 互為雙重保險。 */
const PURE = '(db|engine|providers|media|slima|workflows)'
const ELECTRON = '(^|node_modules/)electron(/|$)'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '不允許循環相依。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'schema-is-bottom',
      severity: 'error',
      comment: '@svs/schema 是最底層，不可以依賴其他套件或 app。',
      from: { path: '^packages/schema/' },
      to: { path: '^(packages/(?!schema/)|apps/)' },
    },
    {
      name: 'pure-packages-only-depend-on-schema',
      severity: 'error',
      comment:
        'db / engine / providers / media / slima / workflows 只能依賴 schema（由 apps/desktop 組裝注入）。',
      from: { path: `^packages/${PURE}/` },
      to: {
        path: '^(packages/(?!schema/)|apps/)',
        pathNot: '^packages/$1/',
      },
    },
    {
      name: 'no-electron-in-packages',
      severity: 'error',
      comment: 'packages 必須能在純 Node 下測試，不可以 import electron。',
      from: { path: '^packages/' },
      to: { path: ELECTRON },
    },
    {
      name: 'renderer-only-schema',
      severity: 'error',
      comment: 'renderer 只能 import @svs/schema，其餘功能走 window.svs IPC。',
      from: { path: '^apps/desktop/src/renderer/' },
      to: {
        path: `^packages/(?!schema/)|${ELECTRON}`,
      },
    },
    {
      name: 'preload-only-schema',
      severity: 'error',
      comment: 'preload 只能 import @svs/schema。',
      from: { path: '^apps/desktop/src/preload/' },
      to: { path: '^packages/(?!schema/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types'],
    },
    // 測試檔與建置 / 測試產生的資料夾不檢查
    exclude: { path: '(\\.test\\.tsx?$|/(playwright-report|test-results|out|dist)/)' },
  },
}
