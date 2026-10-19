type JsonSchema = Record<string, unknown>

/**
 * 常見欄位的中文範例（示範模式給人看的文字要是中文，不能出現「示範description」這種欄位名）。
 * 陣列裡的第 N 個元素名字後面帶數字（例如 `names2`），查表時拿掉數字、顯示時加回「2」。
 */
const SAMPLE_TEXT: Readonly<Record<string, string>> = {
  title: '示範短片',
  name: '示範角色',
  names: '示範角色',
  characters: '示範角色',
  description: '示範畫面：主角走進下著雨的街角',
  summary: '示範摘要：這一場發生的事',
  synopsis: '示範摘要：這一場發生的事',
  appearance: '示範外觀：短黑髮、深藍色外套',
  personality: '示範個性：安靜、細心',
  outfit: '示範服裝：深藍色外套',
  anchorText: '示範固定外觀：短黑髮、琥珀色眼睛、深藍色外套',
  text: '示範文字',
  prompt: '示範畫面描述',
  mood: '安靜',
  dialogue: '（沒有台詞）',
  location: '示範地點：街角',
  locations: '示範地點',
  setting: '示範地點：街角',
  timeOfDay: '夜晚',
  lighting: '路燈的暖光',
}

/** 欄位名對應的中文範例；查不到就用「示範文字」。陣列元素保留編號。 */
function sampleText(name: string): string {
  const match = /^(.*?)(\d+)$/.exec(name)
  const base = match?.[1] ?? name
  const sample = SAMPLE_TEXT[base] ?? '示範文字'
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
