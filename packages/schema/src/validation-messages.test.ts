import { afterEach, describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'

import {
  CANVAS_IMPORT_MAX_BYTES,
  CanvasImportBytesSchema,
  CanvasRenameSchema,
  CanvasUpdateFreeSchema,
} from './domain/canvas'
import { CharacterEditSchema, CharacterNameSchema, TurnaroundCutsSchema } from './domain/characters'
import { OUTLINE_TEXT_MAX, OutlineTextSchema } from './domain/outline'
import { CharacterAppearanceSchema } from './domain/story'
import { DEFAULT_LOCALE, setLocale } from './i18n'
import { KeyProviderIdSchema } from './ipc'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const HAN = /[㐀-鿿]/

const hugeFile = (): Uint8Array =>
  Object.defineProperty(new Uint8Array(1), 'byteLength', { value: CANVAS_IMPORT_MAX_BYTES + 1 })

const CASES: [string, ZodType, () => unknown][] = [
  ['便條／群組改名：空的', CanvasUpdateFreeSchema, () => ({ key: 'a', patch: { title: ' ' } })],
  ['便條／群組：沒有要改的', CanvasUpdateFreeSchema, () => ({ key: 'a', patch: {} })],
  ['畫布改名：空的', CanvasRenameSchema, () => ({ key: 'a', title: '' })],
  ['畫布改名：太長', CanvasRenameSchema, () => ({ key: 'a', title: 'x'.repeat(101) })],
  [
    '拖進畫布的檔案：空的',
    CanvasImportBytesSchema,
    () => ({ name: 'a.png', mime: 'image/png', bytes: new Uint8Array(0) }),
  ],
  [
    '拖進畫布的檔案：太大',
    CanvasImportBytesSchema,
    () => ({ name: 'a.png', mime: 'image/png', bytes: hugeFile() }),
  ],
  ['角色改名：空的', CharacterEditSchema, () => ({ name: '' })],
  ['角色改名：太長', CharacterEditSchema, () => ({ name: 'x'.repeat(41) })],
  ['新角色：空的名字', CharacterNameSchema, () => ' '],
  ['三視圖切線太近', TurnaroundCutsSchema, () => ({ a: 0.5, b: 0.52 })],
  ['大綱文字：空的', OutlineTextSchema, () => ' '],
  ['大綱文字：太長', OutlineTextSchema, () => 'x'.repeat(OUTLINE_TEXT_MAX + 1)],
  ['出場角色：沒有 id 也沒有名字', CharacterAppearanceSchema, () => ({})],
  ['供應商 ID：格式不對', KeyProviderIdSchema, () => 'A!'],
]

const messagesOf = (schema: ZodType, input: unknown): string[] => {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('應該要驗證失敗')
  return result.error.issues.map((issue) => issue.message)
}

describe('驗證訊息跟著介面語言（解析的時候才翻）', () => {
  it('繁中：每一種都是中文白話', () => {
    for (const [name, schema, input] of CASES) {
      const messages = messagesOf(schema, input())
      expect(messages.length, name).toBeGreaterThan(0)
      expect(
        messages.some((m) => HAN.test(m)),
        `${name}: ${messages.join(' / ')}`,
      ).toBe(true)
    }
  })

  it('英文：同一個 schema（載入時語言還是繁中）解析時吐英文，沒有中文，字數上限帶進去', () => {
    setLocale('en')
    for (const [name, schema, input] of CASES) {
      const messages = messagesOf(schema, input())
      expect(messages.length, name).toBeGreaterThan(0)
      for (const message of messages) {
        expect(message.trim(), name).not.toBe('')
        expect(HAN.test(message), `${name}: ${message}`).toBe(false)
      }
    }
    expect(messagesOf(OutlineTextSchema, 'x'.repeat(OUTLINE_TEXT_MAX + 1))[0]).toContain(
      String(OUTLINE_TEXT_MAX),
    )
  })
})
