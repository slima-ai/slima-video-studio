// 擋掉「寫死的中文字串」：字串、樣板字串、JSX 文字裡只要有中文字就報錯（註解不算）。
// 用法：eslint.config.mjs 加上 `...hanConfigs()`；例外清單在 han-exceptions.mjs（每條有理由）。
// 測試：tools/i18n/no-hard-coded-han.test.ts。
import { HAN_EXCEPTIONS } from './han-exceptions.mjs'

const HAN = '[\\u3400-\\u9fff]'
const MESSAGE =
  '寫死的中文字串：給人看的字請改用 t()／msg()（docs/i18n.md）。若是送給模型的提示詞、開發者工具、或比對資料用的字，才把檔案加進 tools/i18n/han-exceptions.mjs 並寫明理由。'

/**
 * @param {typeof HAN_EXCEPTIONS} [exceptions]
 * @returns {import('eslint').Linter.Config[]}
 */
export function hanConfigs(exceptions = HAN_EXCEPTIONS) {
  return [
    {
      files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: `Literal[value=/${HAN}/]`, message: MESSAGE },
          { selector: `TemplateElement[value.raw=/${HAN}/]`, message: MESSAGE },
          { selector: `JSXText[value=/${HAN}/]`, message: MESSAGE },
        ],
      },
    },
    ...exceptions.map(({ files }) => ({ files, rules: { 'no-restricted-syntax': 'off' } })),
  ]
}
