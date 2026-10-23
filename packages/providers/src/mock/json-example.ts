import { msg, t, type MessageRef } from '@svs/schema'

type JsonSchema = Record<string, unknown>

/**
 * 常見欄位的範例（示範模式給人看的文字用介面語言，不能出現「示範description」這種欄位名）。
 * 陣列裡的第 N 個元素名字後面帶數字（例如 `names2`），查表時拿掉數字、顯示時加回「2」。
 */
const SAMPLE_TEXT: Readonly<Record<string, MessageRef>> = {
  title: msg('mock.demoShortFilm'),
  name: msg('mock.demoCharacter'),
  names: msg('mock.demoCharacter'),
  characters: msg('mock.demoCharacter'),
  description: msg('mock.demoPictureTheMainCharacter'),
  summary: msg('mock.demoSummaryWhatHappensIn'),
  synopsis: msg('mock.demoSummaryWhatHappensIn'),
  appearance: msg('mock.demoLookShortBlackHair'),
  personality: msg('mock.demoPersonalityQuietCareful'),
  outfit: msg('mock.demoOutfitNavyJacket'),
  anchorText: msg('mock.demoFixedLookShortBlack'),
  text: msg('mock.demoText'),
  prompt: msg('mock.demoPictureDescription'),
  mood: msg('mock.quiet'),
  dialogue: msg('mock.noDialogue'),
  location: msg('mock.demoLocationStreetCorner'),
  locations: msg('mock.demoLocation'),
  setting: msg('mock.demoLocationStreetCorner'),
  timeOfDay: msg('mock.night'),
  lighting: msg('mock.warmLightFromTheStreet'),
}

/** 欄位名對應的範例（跟著介面語言）；查不到就用「示範文字」。陣列元素保留編號。 */
function sampleText(name: string): string {
  const match = /^(.*?)(\d+)$/.exec(name)
  const base = match?.[1] ?? name
  const sample = t(SAMPLE_TEXT[base] ?? msg('mock.demoText'))
  return match?.[2] === undefined ? sample : `${sample} ${match[2]}`
}

function firstType(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  const list: unknown[] = raw
  return list.find((t) => t !== 'null') ?? list[0]
}

const asSchema = (value: unknown): JsonSchema =>
  typeof value === 'object' && value !== null ? (value as JsonSchema) : {}

/**
 * 依 JSON Schema 產生一份固定、符合結構的範例資料（示範模式的 LLM 用）。
 * 同樣的 schema 永遠得到同樣的結果。支援 object / array / string / number / integer / boolean / null /
 * enum / const / default / anyOf / oneOf / allOf；看不懂的 schema 回傳 null。
 */
export function exampleFromJsonSchema(schema: unknown, name = 'value'): unknown {
  const s = asSchema(schema)
  if ('const' in s) return s.const
  if ('default' in s) return s.default
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = s[key]
    if (Array.isArray(options) && options.length > 0) {
      const list: unknown[] = options
      // 優先挑非 null 的選項
      const pick = list.find((o) => asSchema(o).type !== 'null') ?? list[0]
      return exampleFromJsonSchema(pick, name)
    }
  }
  if (Array.isArray(s.allOf)) {
    const parts: unknown[] = s.allOf
    return Object.assign({}, ...parts.map((part) => exampleFromJsonSchema(part, name) as object))
  }

  const type = firstType(s.type)
  switch (type) {
    case 'object': {
      const properties = asSchema(s.properties)
      return Object.fromEntries(
        Object.entries(properties).map(([key, sub]) => [key, exampleFromJsonSchema(sub, key)]),
      )
    }
    case 'array': {
      const min = typeof s.minItems === 'number' ? s.minItems : 0
      const max = typeof s.maxItems === 'number' ? s.maxItems : Infinity
      const count = Math.min(max, Math.max(min, 3))
      return Array.from({ length: count }, (_, i) =>
        exampleFromJsonSchema(s.items, `${name}${String(i + 1)}`),
      )
    }
    case 'string': {
      const minLength = typeof s.minLength === 'number' ? s.minLength : 0
      return sampleText(name).padEnd(minLength, '。')
    }
    case 'integer':
    case 'number': {
      const min = typeof s.minimum === 'number' ? s.minimum : undefined
      const max = typeof s.maximum === 'number' ? s.maximum : undefined
      let value = min ?? (typeof s.exclusiveMinimum === 'number' ? s.exclusiveMinimum + 1 : 1)
      if (max !== undefined && value > max) value = max
      return type === 'integer' ? Math.ceil(value) : value
    }
    case 'boolean':
      return true
    default:
      return null
  }
}
