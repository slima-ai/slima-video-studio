// 套件相依方向：
// schema ← db / engine / providers / media / slima / workflows ← apps/desktop
// 這份規則同時被 eslint.config.mjs 與 tools/eslint/boundaries.test.ts 使用。

const PACKAGES = [
  'schema',
  'db',
  'engine',
  'providers',
  'media',
  'slima',
  'workflows',
  'test-utils',
]

/** 讓 pattern 同時擋住 `@svs/x` 與 `@svs/x/子路徑`。 */
const pkgPatterns = (names) => names.flatMap((n) => [`@svs/${n}`, `@svs/${n}/*`])

const ELECTRON = {
  group: ['electron', 'electron/*'],
  message: '這個套件必須能在純 Node 下測試，不可以 import electron。',
}

/**
 * @param {Array<{ group: string[]; message: string }>} patterns
 * @returns {import('eslint').Linter.RulesRecord}
 */
const restrict = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] })

const noElectron = (files) => ({ files, rules: restrict([ELECTRON]) })

/** 只允許依賴 schema 的套件。 */
const schemaOnly = (name, { electron = true } = {}) => {
  const others = PACKAGES.filter((p) => p !== 'schema' && p !== name)
  return {
    files: [`packages/${name}/**/*.{ts,tsx}`],
    rules: restrict([
      ...(electron ? [ELECTRON] : []),
      {
        group: pkgPatterns(others),
        message: `@svs/${name} 只能依賴 @svs/schema，不可以依賴其他套件（改由 apps/desktop 組裝注入）。`,
      },
      {
        group: ['@svs/desktop', '@svs/desktop/*'],
        message: '套件不可以反向依賴 apps/desktop。',
      },
    ]),
  }
}

/** @type {import('eslint').Linter.Config[]} */
export const boundaryConfigs = [
  // schema：不依賴任何其他套件
  {
    files: ['packages/schema/**/*.{ts,tsx}'],
    rules: restrict([
      ELECTRON,
      {
        group: [...pkgPatterns(PACKAGES.filter((p) => p !== 'schema')), '@svs/desktop'],
        message: '@svs/schema 是最底層，不可以依賴其他套件。',
      },
    ]),
  },
  schemaOnly('db'),
  schemaOnly('engine'),
  schemaOnly('providers'),
  schemaOnly('media'),
  schemaOnly('slima'),
  schemaOnly('workflows'),
  // test-utils 是測試共用，可以依賴各套件，但一樣不可碰 electron
  noElectron(['packages/test-utils/**/*.{ts,tsx}']),
  // renderer：只能 import schema
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [...pkgPatterns(PACKAGES.filter((p) => p !== 'schema')), 'electron', 'electron/*'],
        message: 'renderer 只能 import @svs/schema，其餘功能一律走 window.svs IPC。',
      },
    ]),
  },
  // preload：只能碰 electron 與 schema
  {
    files: ['apps/desktop/src/preload/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: pkgPatterns(PACKAGES.filter((p) => p !== 'schema')),
        message: 'preload 只能 import @svs/schema。',
      },
    ]),
  },
]
