import { createHash } from 'node:crypto'

import {
  CAMERA_MOVES,
  CHARACTER_REFERENCE_PURPOSE_LABELS,
  DEFAULT_CHARACTER_PROMPTS,
  DEFAULT_STORYBOARD_GUIDE,
  LOCATION_REFERENCE_PURPOSE_LABELS,
  QUICK_STYLE_LABELS,
  SHOT_ANGLE_LABELS,
  SHOT_SIZE_LABELS,
} from '@svs/schema'
import { describe, expect, it } from 'vitest'

import { resolveCameraMove } from './camera'
import {
  REFERENCE_PROMPT_SUFFIX,
  ShotItemSchema,
  composeConceptPrompt,
  composeConceptRefPrompt,
  composeEndFramePrompt,
  composeLocationAnglePrompt,
  composeLocationConceptPrompt,
  composeShotPrompts,
  composeTurnaroundPrompt,
  frameFillSuffix,
  referenceNoteOf,
} from './nodes'
import { QUICK_STYLES } from './styles'

const sha = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')

/**
 * 送給圖片／影片／文字模型的 Prompt 與組裝用的中文片段，每一份的輸出都用雜湊釘住。
 * 為什麼：Prompt 的文字會進節點的輸入，節點快取用輸入的雜湊當鍵；改了字，已存專案「補跑缺的」時快取全部失效、要重花錢
 * （「需要重跑」的判斷不看 Prompt 文字，所以不會亂標）。語言介面（i18n）不碰這些字：
 * 這份測試紅了，代表有人動了送給模型的字——如果是刻意的，更新雜湊並在 PR 說明寫清楚會讓哪些已存的結果重跑。
 * （另有 4 個 system prompt 的雜湊在 apps/desktop/src/main/story-language-prompts.test.ts。）
 */
const GOLDEN: Record<string, string> = {
  'shot：簡單': '6d959f112edf28ef834b0e681ec0361162b6dbd85041f1a505d2e53bfca4ec5f',
  'shot：角色、氣氛、外觀、場景':
    '8c24685f15f40b148861aba972dd95ebd61f41a4ada812eebd3169c6eef60298',
  'shot：有動作（影片 Prompt 以動作開頭，帶角色限制）':
    '529533f549cd3f626fa3cf69c00188f735887aa3338892a8512f74f40ec4074d',
  'shot：使用者改過 Prompt': 'c18d586efc48e1ef72a2f7cfcfa0212223f989b238b2aed0381884ba5d655621',
  '角色概念圖（長相與服裝）': '5edd2ad571a12c2fc05964d1d02a534260d07a7ff243c2b5ad0933c102cf1bc2',
  '角色概念圖（固定外觀）': 'd89122db743b121157ad8f934deaed30afa1b9a9434bc427cf7911e7b7d0bdf1',
  '角色概念圖（照參考圖，標了用途）':
    '06f138a08e1df7bad81ff8cc5b903ce5c3859d0cc51ab252b3ef2adc57287bd3',
  '角色概念圖（照參考圖，都是一般）':
    '0b7bac38394786a958c3a1d604207bb9c9aab03409728532bef175085b12cf4f',
  參考圖說明: 'ea3590973c070f7d5642d18673ee90fe0e8c90b30835ee0a6c8d54d3deea3770',
  角色三視圖: 'e9815f32e0a901b2eba8c55cce65dafeb5d6c8a251bca393dc56d9fd10155c41',
  場景概念圖: '8fa02ae2c40d165cf2510a1b4486c99fe60a752294c20445c8487912e2a27d51',
  '場景角度：反方向': '497b6619bd280d1c8788358004188bb3b05a97ab1f0d3c8e0b530852b211c330',
  '場景角度：拉遠': '5da7439c30a45cc05b60eca68d9beb9d5da920b3e1d5e270bfe1ef26044c9b81',
  '尾幀（英文）': '84ad32aae76f277c134a6742089299202f921b76a94ff9094ade5d3ff366b9af',
  參考圖後綴: '20da9d8b4cadead856c7a24261814553059832c5deeb0fc32f790332d5224e7e',
  '滿版後綴 16:9': '0b54512bd810add7f6a7866cb461aa9989263b7d7dc1b393085e366972880a9a',
  '滿版後綴 9:16': '3b51cb883c74b465c9baf4e8dc1a504466d576b04d9886505e7e485759329872',
  '畫風段落（5 種）': '0f5f91addf28dfb2e5ebbccec5fccfaeaf49e8f9912f8c82af4f7cc0cadd215a',
  '運鏡（id、白話名稱、說明、中英 Prompt）':
    '952630ca3ab4733257f3e12340cda15fcd85977412fe0d0009c0c9ee26936e25',
  '運鏡轉成影片 Prompt（中文模型／英文模型／原生參數）':
    'a5abc59541ca8b6c75e23d02095414ca11654f690b6b988bd142c3121ea90f92',
  '景別名稱（進 Prompt 與 MCP）':
    '475d312394cd927429f36a97292a3b4ea8926ebd27a36c415532635580c00977',
  '角度名稱（進 Prompt 與 MCP）':
    '29105b1879a4e394d423499cbfaab9c0eadb449d15de5edc904ea0eafcb8efc8',
  '畫風名稱（進 Prompt 與 MCP）':
    '73e4dc8a9ff35f2ea5972f0297f766569824960010e7bd43f39d45bbe9fd6d63',
  '角色參考圖用途（進 Prompt）': 'bb2dc55d3251a8d7fe38411eab1dd5763b94f285a17f22e85c2c6b97098dcf94',
  '場景參考圖用途（進 Prompt）': 'ecc24b002f35c030d6c92d0141282117fa72892a01badf47a6ac6e4ae46715b3',
  '角色圖範本（4 種）': '5f9b4ec3610dd41632adf093a5d64b139dd1a624a4e248a3d6f1bbf140d8105e',
  '預設分鏡準則（中文）': '4d36d37ce47c183cf6a19911682d1a4810482e9a1171047f504930d45fb2365e',
}

const shot = (patch: Record<string, unknown> = {}) =>
  ShotItemSchema.parse({
    number: 1,
    description: '阿鐵走進下著雨的巷口',
    durationSec: 3,
    characters: ['阿鐵', '小花'],
    mood: '緊張',
    locationId: 'loc1',
    ...patch,
  })
const anchors = [
  { name: '阿鐵', text: '短黑髮、深藍色雨衣，NO mouth, NO arms' },
  { name: '小花', text: '白色小貓' },
]
const scenes = [{ id: 'loc1', name: '舊倉庫', text: '潮濕的磚牆、天窗透下冷光' }]
const hero = { hash: 'a'.repeat(64), kind: 'image' as const, mime: 'image/png', bytes: 1 }

const OUTPUTS: Record<string, () => unknown> = {
  'shot：簡單': () => composeShotPrompts(shot({ characters: [], mood: '' }), 'realistic'),
  'shot：角色、氣氛、外觀、場景': () => composeShotPrompts(shot(), 'anime', anchors, scenes),
  'shot：有動作（影片 Prompt 以動作開頭，帶角色限制）': () =>
    composeShotPrompts(shot({ action: '他推開門。' }), 'watercolor', anchors, scenes),
  'shot：使用者改過 Prompt': () => composeShotPrompts(shot({ promptOverride: '自己寫的' }), '3d'),
  '角色概念圖（長相與服裝）': () =>
    composeConceptPrompt(
      { name: '阿鐵', age: '30', appearance: '瘦高', outfit: '雨衣' },
      'painted',
    ),
  '角色概念圖（固定外觀）': () =>
    composeConceptPrompt({ name: '阿鐵', anchor: '短黑髮、深藍色雨衣' }, 'realistic'),
  '角色概念圖（照參考圖，標了用途）': () =>
    composeConceptRefPrompt({ name: '阿鐵', anchor: '短黑髮' }, 'anime', undefined, ['臉', '身體']),
  '角色概念圖（照參考圖，都是一般）': () =>
    composeConceptRefPrompt({ name: '阿鐵', anchor: '短黑髮' }, 'anime', undefined, ['一般']),
  參考圖說明: () => referenceNoteOf(['臉', '一般', '服裝']),
  角色三視圖: () => composeTurnaroundPrompt({ name: '阿鐵', anchor: '短黑髮' }, 'realistic'),
  場景概念圖: () =>
    composeLocationConceptPrompt({ name: '舊倉庫', description: '潮濕', anchor: '紅磚牆' }, '3d'),
  '場景角度：反方向': () =>
    composeLocationAnglePrompt({ name: '舊倉庫', anchor: '紅磚牆', angle: 'reverse' }, 'anime'),
  '場景角度：拉遠': () =>
    composeLocationAnglePrompt({ name: '舊倉庫', description: '潮濕', angle: 'wide' }, 'anime'),
  '尾幀（英文）': () =>
    composeEndFramePrompt({
      description: 'the door is open.',
      firstFrame: hero,
      characters: [{ name: '阿鐵', ref: hero }],
    }),
  參考圖後綴: () => REFERENCE_PROMPT_SUFFIX,
  '滿版後綴 16:9': () => frameFillSuffix('16:9'),
  '滿版後綴 9:16': () => frameFillSuffix('9:16'),
  '畫風段落（5 種）': () => Object.values(QUICK_STYLES).map((s) => [s.id, s.fragment, s.fit]),
  '運鏡（id、白話名稱、說明、中英 Prompt）': () => CAMERA_MOVES,
  '運鏡轉成影片 Prompt（中文模型／英文模型／原生參數）': () => [
    resolveCameraMove({ prompt: '一個畫面', cameraMove: 'push_in' } as never, undefined),
    resolveCameraMove(
      { prompt: 'a picture', cameraMove: 'orbit' } as never,
      {
        prompt: { language: 'en' },
      } as never,
    ),
    resolveCameraMove({ prompt: '一個畫面', cameraMove: 'pan' } as never, {
      cameraParams: { pan: { type: 'horizontal', value: 5 } },
    }),
  ],
  '景別名稱（進 Prompt 與 MCP）': () => SHOT_SIZE_LABELS,
  '角度名稱（進 Prompt 與 MCP）': () => SHOT_ANGLE_LABELS,
  '畫風名稱（進 Prompt 與 MCP）': () => QUICK_STYLE_LABELS,
  '角色參考圖用途（進 Prompt）': () => CHARACTER_REFERENCE_PURPOSE_LABELS,
  '場景參考圖用途（進 Prompt）': () => LOCATION_REFERENCE_PURPOSE_LABELS,
  '角色圖範本（4 種）': () => DEFAULT_CHARACTER_PROMPTS,
  '預設分鏡準則（中文）': () => DEFAULT_STORYBOARD_GUIDE,
}

describe('送給模型的 Prompt 與中文片段：輸出用雜湊釘住', () => {
  it('每一份都有雜湊，沒有多的、沒有少的', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(OUTPUTS).sort())
  })

  for (const [name, produce] of Object.entries(OUTPUTS)) {
    it(`${name}：跟以前逐字相同`, () => {
      expect(sha(produce())).toBe(GOLDEN[name])
    })
  }
})
