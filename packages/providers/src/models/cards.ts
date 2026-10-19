import { ModelSpecSchema, expandModelSpec, type ModelCard, type ModelSpec } from '@svs/schema'

import claudeOpus5_5 from '../../models/claude-opus-5.5.json'
import claudeSonnet5_5 from '../../models/claude-sonnet-5.5.json'
import gemini3ProImage from '../../models/gemini-3-pro-image.json'
import gpt5_5 from '../../models/gpt-5.5.json'
import kling3_0Pro from '../../models/kling-3.0-pro.json'
import kling3_0Standard from '../../models/kling-3.0-standard.json'
import mockImage from '../../models/mock-image.json'
import mockLlm from '../../models/mock-llm.json'
import mockTts from '../../models/mock-tts.json'
import mockVideo from '../../models/mock-video.json'
import nanoBanana2 from '../../models/nano-banana-2.json'
import seedance2_0 from '../../models/seedance-2.0.json'
import seedream5_0 from '../../models/seedream-5.0.json'
import veo3_1Lite from '../../models/veo-3.1-lite.json'

/** 內建的模型檔（一個模型一個檔，裡面列各家供應商的管道）。新增 JSON 檔後要加進這份清單（測試會檢查有沒有漏）。 */
const RAW_SPECS: readonly unknown[] = [
  claudeOpus5_5,
  claudeSonnet5_5,
  gemini3ProImage,
  gpt5_5,
  kling3_0Pro,
  kling3_0Standard,
  mockImage,
  mockLlm,
  mockTts,
  mockVideo,
  nanoBanana2,
  seedance2_0,
  seedream5_0,
  veo3_1Lite,
]

export const BUILTIN_MODEL_FILES: readonly string[] = [
  'claude-opus-5.5.json',
  'claude-sonnet-5.5.json',
  'gemini-3-pro-image.json',
  'gpt-5.5.json',
  'kling-3.0-pro.json',
  'kling-3.0-standard.json',
  'mock-image.json',
  'mock-llm.json',
  'mock-tts.json',
  'mock-video.json',
  'nano-banana-2.json',
  'seedance-2.0.json',
  'seedream-5.0.json',
  'veo-3.1-lite.json',
]

const keyOf = (item: unknown, index: number): string =>
  typeof item === 'object' && item !== null && 'key' in item
    ? String(item.key)
    : `#${String(index)}`

/** 解析並驗證模型檔；任何一個格式錯誤或 key 重複都會直接丟錯，不會悄悄略過。 */
export function parseModelSpecs(raw: readonly unknown[]): ModelSpec[] {
  const seen = new Set<string>()
  return raw.map((item, index) => {
    const result = ModelSpecSchema.safeParse(item)
    if (!result.success) {
      throw new Error(`模型 ${keyOf(item, index)} 格式錯誤：${result.error.message}`)
    }
    if (seen.has(result.data.key)) throw new Error(`模型 key 重複：${result.data.key}`)
    seen.add(result.data.key)
    return result.data
  })
}

/** 模型檔 → 每個管道一張 ModelCard；管道的 id 也不能重複。 */
export function expandModelSpecs(specs: readonly ModelSpec[]): ModelCard[] {
  const seen = new Set<string>()
  return specs.flatMap((spec) =>
    expandModelSpec(spec).map((card) => {
      if (seen.has(card.id)) throw new Error(`ModelCard id 重複：${card.id}`)
      seen.add(card.id)
      return card
    }),
  )
}

export function loadBuiltinModelCards(): ModelCard[] {
  return expandModelSpecs(parseModelSpecs(RAW_SPECS))
}
